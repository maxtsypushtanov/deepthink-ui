"""Calendar chat mode — direct LLM streaming with calendar context."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel

from app.db import calendar as cal_db
from app.db import database as db
from app.providers.base import LLMMessage
from app.providers.registry import get_provider
from app.reasoning.engine import ReasoningEngine

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Helpers ──

async def _get_provider_base_url(provider: str) -> str | None:
    """Look up the custom base_url for a provider from saved settings."""
    return await db.get_provider_base_url(provider)


def _extract_calendar_data(text: str) -> dict | None:
    """Extract calendar action data from LLM response WITHOUT executing."""
    try:
        # Try 1: JSON with calendar_action key
        match = re.search(r'\{[^{}]*"calendar_action"\s*:\s*"[^"]*"[^{}]*\}', text)
        if match:
            return json.loads(match.group())

        # Try 2: JSON with title + start_time
        for m in re.finditer(r'\{[^{}]+\}', text):
            try:
                data = json.loads(m.group())
                if data.get("title") and data.get("start_time") and data.get("end_time"):
                    data["calendar_action"] = data.get("calendar_action", "create")
                    return data
            except json.JSONDecodeError:
                continue

        # Try 3: regex fields
        action_match = re.search(r'"calendar_action"\s*:\s*"([^"]+)"', text)
        action_type = action_match.group(1) if action_match else "create"

        if action_type == "delete":
            eid_match = re.search(r'"event_id"\s*:\s*"([^"]+)"', text)
            if eid_match:
                return {"calendar_action": "delete", "event_id": eid_match.group(1)}
        elif action_type == "update":
            eid_match = re.search(r'"event_id"\s*:\s*"([^"]+)"', text)
            if eid_match:
                result: dict = {"calendar_action": "update", "event_id": eid_match.group(1)}
                title_match = re.search(r'"title"\s*:\s*"([^"]+)"', text)
                start_match = re.search(r'"start_time"\s*:\s*"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})"', text)
                end_match = re.search(r'"end_time"\s*:\s*"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})"', text)
                if title_match:
                    result["title"] = title_match.group(1)
                if start_match:
                    result["start_time"] = start_match.group(1)
                if end_match:
                    result["end_time"] = end_match.group(1)
                return result
        elif action_type == "create":
            title_match = re.search(r'"title"\s*:\s*"([^"]+)"', text)
            start_match = re.search(r'"start_time"\s*:\s*"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})"', text)
            end_match = re.search(r'"end_time"\s*:\s*"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})"', text)
            if title_match and start_match and end_match:
                return {"calendar_action": "create", "title": title_match.group(1), "start_time": start_match.group(1), "end_time": end_match.group(1)}
    except Exception:
        logger.exception("Failed to extract calendar data from LLM response")
    return None


async def _execute_calendar_action(data: dict) -> dict | None:
    from datetime import datetime as _dt
    action = data.get("calendar_action", "create")
    if action == "create" and data.get("title") and data.get("start_time") and data.get("end_time"):
        # Validate end > start
        if _dt.fromisoformat(data["end_time"]) <= _dt.fromisoformat(data["start_time"]):
            logger.warning("Calendar create: end_time <= start_time, skipping")
            return {"action": "error", "error": "end_time must be after start_time"}
        # Check for conflicts before creating
        conflicts = await cal_db.check_conflicts(data["start_time"], data["end_time"])
        if conflicts:
            titles = ", ".join(c["title"] for c in conflicts[:3])
            return {"action": "conflict", "conflicts": conflicts, "message": f"Конфликт с: {titles}"}
        ev = await cal_db.create_event(
            title=data["title"],
            start_time=data["start_time"],
            end_time=data["end_time"],
            description=data.get("description", ""),
            color=data.get("color", "#3b82f6"),
        )
        return {"action": "created", "event": ev}
    elif action == "delete" and data.get("event_id"):
        ok = await cal_db.delete_event(data["event_id"])
        if not ok:
            # Fallback: try to find by title
            title = data.get("title")
            if title:
                now = datetime.now()
                week_start = now - timedelta(days=now.weekday(), hours=now.hour, minutes=now.minute)
                week_end = week_start + timedelta(days=14)
                events = await cal_db.list_events(week_start.isoformat(), week_end.isoformat())
                for ev in events:
                    if title.lower() in ev.get("title", "").lower():
                        ok = await cal_db.delete_event(ev["id"])
                        return {"action": "deleted", "event_id": ev["id"], "ok": ok}
        return {"action": "deleted", "event_id": data["event_id"], "ok": ok}
    elif action == "update" and data.get("event_id"):
        # Validate end > start if both provided
        if data.get("start_time") and data.get("end_time") and _dt.fromisoformat(data["end_time"]) <= _dt.fromisoformat(data["start_time"]):
            logger.warning("Calendar update: end_time <= start_time, skipping")
            return {"action": "error", "error": "end_time must be after start_time"}
        ev = await cal_db.update_event(
            data["event_id"],
            title=data.get("title"),
            start_time=data.get("start_time"),
            end_time=data.get("end_time"),
            description=data.get("description"),
            color=data.get("color"),
        )
        if ev is None:
            return {"action": "error", "error": "event not found"}
        return {"action": "updated", "event": ev}
    else:
        logger.warning("Unknown calendar action: %s", action)
    return None


async def build_calendar_context() -> str:
    """Build the calendar system prompt with current events and free slots."""
    now = datetime.now()
    today = now.strftime("%Y-%m-%d")
    tomorrow = (now + timedelta(days=1)).strftime("%Y-%m-%d")
    weekday_ru = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"][now.weekday()]
    week_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start -= timedelta(days=week_start.weekday())
    week_end = week_start + timedelta(days=14)
    existing = await cal_db.list_events(week_start.isoformat(), week_end.isoformat())
    free_today = await cal_db.find_free_slots(today)
    free_tomorrow = await cal_db.find_free_slots(tomorrow)

    # Calculate free slots for next 5 weekdays
    free_slots_context = []
    current_day = now
    weekday_names = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
    for _ in range(5):
        current_day += timedelta(days=1)
        if current_day.weekday() >= 5:  # Skip weekends
            current_day += timedelta(days=(7 - current_day.weekday()))
        day_str = current_day.strftime("%Y-%m-%d")
        slots = await cal_db.find_free_slots(day_str)
        if slots:
            slot_strs = ", ".join(f"{s['start'][-8:-3]}—{s['end'][-8:-3]}" for s in slots[:5])
            wd = weekday_names[current_day.weekday()]
            free_slots_context.append(f"  {wd} {current_day.strftime('%d.%m')}: {slot_strs}")
    free_slots_context_str = "\n".join(free_slots_context) if free_slots_context else "  Нет данных"

    # Format events for LLM context — include IDs for actions but instruct not to show them
    events_internal = "\n".join(
        f"- id={e['id']} | {e['title']} | {e['start_time']} — {e['end_time']}" + (f" | {e['description']}" if e.get('description') else "")
        for e in existing
    ) or "Нет встреч"

    free_today_str = ", ".join(f"{s['start'][-8:-3]}—{s['end'][-8:-3]}" for s in free_today) or "весь день"
    free_tomorrow_str = ", ".join(f"{s['start'][-8:-3]}—{s['end'][-8:-3]}" for s in free_tomorrow) or "весь день"

    cal_context = (
        f"Ты — ассистент со встроенным календарём. Сегодня: {today} ({weekday_ru}). Завтра: {tomorrow}.\n\n"
        "ВАЖНО: Календарь ВСТРОЕН в платформу DeepThink. Ты УЖЕ имеешь полный доступ ко всем событиям пользователя. "
        "НЕ спрашивай «к какому календарю подключиться», «какой аккаунт», «дай доступ». "
        "Данные пользователя уже загружены ниже. Просто работай с ними.\n\n"
        "ОТНОСИТЕЛЬНЫЕ ДАТЫ: когда пользователь говорит «завтра», «послезавтра», «в пятницу», «через неделю» и т.п., "
        "ты ОБЯЗАН вычислить конкретную дату в формате ISO (YYYY-MM-DDTHH:MM:SS) и использовать её в JSON-действии. "
        "Никогда не оставляй относительные даты в JSON.\n\n"
        "УМНОЕ ПЛАНИРОВАНИЕ:\n"
        "— Если пользователь хочет создать встречу на занятое время — НЕ создавай. Вместо этого "
        "предложи 2-3 ближайших свободных слота в формате: «Это время занято ({conflict_title}). "
        "Свободные слоты: 15:00–16:00, 16:30–17:30. Какой подходит?»\n"
        "— Если пользователь говорит «найди время» / «когда свободно» — проанализируй свободные "
        "слоты и предложи лучшие варианты\n"
        "— Определяй длительность по типу встречи:\n"
        "  · Стендап/standup/дейли → 15 минут\n"
        "  · Созвон/звонок/синк → 30 минут\n"
        "  · Встреча/совещание/обсуждение → 60 минут\n"
        "  · Ревью/review/ретро → 90 минут\n"
        "  · Воркшоп/workshop/планирование → 120 минут\n"
        "  Если пользователь не указал длительность — используй эти шаблоны\n"
        "— Цвета по типу: стендап=#10b981 (зелёный), встреча=#3b82f6 (синий), "
        "ревью=#8b5cf6 (фиолетовый), дедлайн=#ef4444 (красный), личное=#f59e0b (жёлтый)\n\n"
        f"[ВНУТРЕННИЕ ДАННЫЕ — НЕ ПОКАЗЫВАЙ ПОЛЬЗОВАТЕЛЮ]\n"
        f"Текущие встречи:\n{events_internal}\n"
        f"Свободно сегодня: {free_today_str}\n"
        f"Свободно завтра: {free_tomorrow_str}\n"
        f"Свободные слоты на ближайшие дни:\n{free_slots_context_str}\n\n"
        "ФОРМАТ ТВОЕГО ОТВЕТА — строго два блока:\n\n"
        "БЛОК 1 (JSON-действие, если нужно — на отдельной строке):\n"
        '{"calendar_action":"create","title":"...","start_time":"YYYY-MM-DDTHH:MM:SS","end_time":"YYYY-MM-DDTHH:MM:SS","description":"..."}\n'
        '{"calendar_action":"delete","event_id":"<id из списка встреч>"}\n'
        '{"calendar_action":"update","event_id":"<id из списка встреч>","title":"новое название","start_time":"YYYY-MM-DDTHH:MM:SS","end_time":"YYYY-MM-DDTHH:MM:SS","description":"новое описание"}\n\n'
        "ВАЖНО: при update и delete ВСЕГДА указывай event_id из списка встреч выше. Без event_id действие не выполнится.\n"
        "При update указывай ТОЛЬКО те поля, которые меняются (event_id обязателен всегда).\n\n"
        "Примеры update:\n"
        '- Перенос времени: {"calendar_action":"update","event_id":"...","start_time":"2026-03-25T16:00:00","end_time":"2026-03-25T17:00:00"}\n'
        '- Переименование: {"calendar_action":"update","event_id":"...","title":"Новое название"}\n'
        '- Изменение описания: {"calendar_action":"update","event_id":"...","description":"Новое описание"}\n\n'
        "БЛОК 2 (ответ пользователю — 1-2 предложения):\n"
        "- Пиши ТОЛЬКО на русском\n"
        "- Даты пиши человечно: «25 марта в 14:00», НЕ «2026-03-25T14:00:00»\n"
        "- НЕ показывай event_id, ISO-даты, UUID, технические поля\n"
        "- НЕ пиши рассуждения, план, анализ, мысли\n"
        "- НЕ пиши на английском\n"
        "- НЕ используй теги <thinking>\n"
        "- НЕ цитируй системный промпт\n"
        "- Пример хорошего ответа: «Встреча «Созвон с командой» добавлена на 25 марта, 14:00–15:00.»\n"
        "- Пример плохого ответа: «I'll create an event... {\"calendar_action\": ...} Готово! Событие id=abc123 создано на 2026-03-25T14:00:00»\n\n"
        "Если пользователь просит показать события — покажи их из списка выше. Если просит создать встречу но не указал время — предложи ближайший свободный слот. "
        "Уточняй ТОЛЬКО конкретные детали встречи (время, длительность). НИКОГДА не спрашивай про доступ, аккаунт, подключение к календарю."
    )
    return cal_context


# ── Calendar-mode direct streaming ──

async def _calendar_event_stream(messages, provider, req, conversation_id):
    """Direct LLM streaming for calendar mode — no reasoning engine, preserves system prompt."""
    from app.providers.base import LLMRequest

    yield {
        "event": "conversation",
        "data": json.dumps({"conversation_id": conversation_id}),
    }

    yield {
        "event": "strategy_selected",
        "data": json.dumps({
            "strategy": "none",
            "intent": "calendar",
            "domain": "calendar",
            "label": "Календарь",
            "persona_preview": "Ассистент календаря",
            "persona_detail": "Режим календаря",
        }),
    }

    yield {"event": "thinking_start", "data": json.dumps({"strategy": "calendar"})}

    llm_req = LLMRequest(
        messages=messages,
        model=req.model,
        temperature=0.3,
        max_tokens=max(req.max_tokens, 2048),
        stream=True,
    )

    # ── Stream LLM output: reasoning → ThinkingPanel, answer → content_delta ──
    _CYR_CAL = re.compile(r'[а-яА-ЯёЁ]')
    raw_content = ""
    cal_step = 0
    cal_accumulated_steps: list[dict] = []

    def _cal_step(label: str, content: str):
        nonlocal cal_step
        cal_step += 1
        cal_accumulated_steps.append({
            "step_number": cal_step,
            "strategy": "calendar",
            "content": label,
            "duration_ms": 0,
            "metadata": {"type": "reasoning", "content": content[:500]},
        })
        return {
            "event": "thinking_step",
            "data": json.dumps({
                "step": cal_step, "label": label,
                "type": "reasoning", "content": content[:500],
            }, ensure_ascii=False),
        }

    reasoning_buffer = ""
    try:
        async for chunk in provider.stream(llm_req):
            # Native reasoning_content → buffer and emit batched
            if hasattr(chunk, "reasoning_content") and chunk.reasoning_content:
                raw_content += chunk.reasoning_content
                reasoning_buffer += chunk.reasoning_content
                # Emit batched every 200+ chars
                if len(reasoning_buffer) >= 200:
                    yield _cal_step("Размышление", reasoning_buffer)
                    reasoning_buffer = ""
                continue
            content = chunk.content or ""
            if content:
                raw_content += content
    except Exception as e:
        yield {"event": "error", "data": json.dumps({"error": str(e)})}
        return

    # Flush remaining reasoning buffer
    if reasoning_buffer:
        yield _cal_step("Анализирую запрос", reasoning_buffer)

    # ── Split raw content into reasoning (→ panel) and answer (→ bubble) ──
    # 1. Strip <thinking> blocks → send to panel
    thinking_blocks = re.findall(r'<thinking>(.*?)</thinking>', raw_content, flags=re.DOTALL)
    for block in thinking_blocks:
        if block.strip():
            yield _cal_step("Обрабатываю данные календаря", block.strip())

    stripped = re.sub(r'<thinking>.*?</thinking>', '', raw_content, flags=re.DOTALL)
    stripped = stripped.replace('<thinking>', '').replace('</thinking>', '').strip()

    # 2. Extract answer from raw content using two strategies:
    #    A) Find quoted Russian sentences (model often embeds answer in English reasoning)
    #    B) Find standalone Cyrillic lines
    #    All English text goes to reasoning panel.

    # Extract calendar action JSON first (before any cleaning)
    # Keep raw_content for _extract_calendar_data later

    # Send all raw content to reasoning panel
    all_text_for_panel = re.sub(r'\{[^{}]*"calendar_action"[^{}]*\}', '', stripped)
    all_text_for_panel = re.sub(r'\{[^{}]*"title"[^{}]*\}', '', all_text_for_panel).strip()
    if all_text_for_panel:
        yield _cal_step("Обрабатываю запрос", all_text_for_panel[:500])

    # Strategy: extract ALL Cyrillic sentence fragments from the full text.
    # The model often embeds the Russian answer inside English reasoning like:
    # "... So the response is: «Встреча создана на 25 марта» ..."

    # First, strip all JSON objects (they may contain Cyrillic titles)
    text_no_json = re.sub(r'\{[^{}]*\}', '', stripped)
    # Also strip code blocks
    text_no_json = re.sub(r'```[\s\S]*?```', '', text_no_json)

    cyrillic_fragments: list[str] = []

    # A) Find Cyrillic sentences: must be >40% Cyrillic characters and contain 3+ Cyrillic words
    for m in re.finditer(
        r'[А-ЯЁа-яё](?:[А-ЯЁа-яё\w\s«»""\'.,!?:;\-–—\d/:()\[\]°+])*[.!?»"…]',
        text_no_json,
    ):
        frag = m.group(0).strip()
        cyr_chars = len(re.findall(r'[а-яА-ЯёЁ]', frag))
        cyr_words = re.findall(r'[а-яА-ЯёЁ]{2,}', frag)
        # Fragment must be predominantly Cyrillic and have 3+ real words
        if len(cyr_words) >= 3 and len(frag) > 15 and cyr_chars / max(len(frag), 1) > 0.35:
            cyrillic_fragments.append(frag)

    # B) Extract quoted Cyrillic text from English context: "Встреча..." or «Встреча...»
    for m in re.finditer(r'[""«]([А-ЯЁа-яё][^""»]*[.!?])[""»]', text_no_json):
        frag = m.group(1).strip()
        cyr_words = re.findall(r'[а-яА-ЯёЁ]{2,}', frag)
        if len(cyr_words) >= 3 and len(frag) > 15:
            if not any(frag in f for f in cyrillic_fragments):
                cyrillic_fragments.append(frag)

    # C) Also check full lines that are majority Cyrillic
    for line in text_no_json.split('\n'):
        sl = line.strip()
        if not sl or len(sl) < 5:
            continue
        cyr_count = len(re.findall(r'[а-яА-ЯёЁ]', sl))
        if cyr_count > len(sl) * 0.5:
            # Check it's not already a substring of an existing fragment
            if not any(sl in f for f in cyrillic_fragments):
                cyrillic_fragments.append(sl)

    # Deduplicate: prefer longer fragments, remove substrings
    unique_fragments: list[str] = []
    for frag in sorted(cyrillic_fragments, key=len, reverse=True):
        if not any(frag in existing for existing in unique_fragments):
            unique_fragments.append(frag)
    # Restore original order
    ordered = [f for f in cyrillic_fragments if f in unique_fragments]
    # Remove duplicates preserving order
    seen_set: set[str] = set()
    final_fragments: list[str] = []
    for f in ordered:
        if f not in seen_set:
            seen_set.add(f)
            final_fragments.append(f)

    answer_text = ' '.join(final_fragments) if final_fragments else ''

    yield {
        "event": "thinking_end",
        "data": json.dumps({
            "strategy": "calendar",
            "steps": cal_accumulated_steps,
            "total_duration_ms": 0,
        }, ensure_ascii=False),
    }

    # Extract calendar action data from full raw content
    calendar_data = _extract_calendar_data(raw_content)

    # Clean answer for display
    display_content = answer_text

    # 1. Strip any remaining JSON or technical artifacts
    display_content = re.sub(r'\{[^{}]*\}', '', display_content)
    display_content = re.sub(r'\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b', '', display_content)
    display_content = re.sub(r'event_id\s*[:=]\s*"?[0-9a-f-]+"?', '', display_content)

    # 2. Humanize any remaining ISO dates
    def _humanize_iso_date(m: re.Match) -> str:
        try:
            from datetime import datetime as _dt
            dt = _dt.fromisoformat(m.group(0).rstrip('Z'))
            _months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                       'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
            return f"{dt.day} {_months[dt.month - 1]} в {dt.hour}:{dt.minute:02d}"
        except Exception:
            return m.group(0)

    display_content = re.sub(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z?', _humanize_iso_date, display_content)

    # 3. Final cleanup
    # Strip leading/trailing English fragments from extracted Cyrillic
    display_content = re.sub(r'^[A-Za-z][A-Za-z\s.,;:!?\'"-]*\.\s*', '', display_content)  # leading English sentence
    display_content = re.sub(r'\s*["\']?\s*[A-Za-z][A-Za-z\s.,;:!?]*\.?\s*$', '', display_content)  # trailing English
    display_content = re.sub(r'\s{2,}', ' ', display_content).strip()
    display_content = display_content.strip(' "\'\n')

    # Stream clean answer to user
    if display_content:
        yield {
            "event": "content_delta",
            "data": json.dumps({"content": display_content}, ensure_ascii=False),
        }

    # Save clean message
    await db.add_message(
        conversation_id, "assistant", display_content or "",
        model=req.model, provider=req.provider,
        reasoning_strategy="calendar",
    )

    done_data: dict = {}
    if calendar_data:
        # Enrich draft with event details for delete/update so the UI shows
        # human-readable info instead of raw IDs
        if calendar_data.get("event_id"):
            try:
                existing_ev = await cal_db.get_event(calendar_data["event_id"])
                if existing_ev:
                    calendar_data["_event_title"] = existing_ev.get("title", "")
                    calendar_data["_event_start"] = existing_ev.get("start_time", "")
                    calendar_data["_event_end"] = existing_ev.get("end_time", "")
            except Exception:
                pass
        done_data["calendar_draft"] = calendar_data

    yield {"event": "done", "data": json.dumps(done_data, ensure_ascii=False)}


# ── Calendar confirm endpoint ──

class CalendarConfirmRequest(BaseModel):
    calendar_action: str = "create"
    title: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    description: str | None = None
    event_id: str | None = None
    color: str | None = None

@router.post("/api/calendar/confirm")
async def confirm_calendar_action(req: CalendarConfirmRequest):
    """Execute a previously drafted calendar action after user confirmation."""
    result = await _execute_calendar_action(req.model_dump(exclude_none=True))
    if not result:
        raise HTTPException(status_code=400, detail="Invalid action data")
    if result.get("action") == "error":
        raise HTTPException(status_code=400, detail=result.get("error", "Action failed"))
    return result


# ── Daily briefing endpoint ──

BRIEFING_PROMPT = """Ты — весёлый офисный секретарь-ассистент с отличным чувством юмора.
Вот расписание на сегодня ({date}, {weekday}):

{events_list}

Свободное время: {free_time}

Напиши короткую повестку дня в стиле дружелюбного секретаря:

1. **Обзор дня** (1-2 предложения, общая картина — лёгкий юмор)
2. **Встречи** — по каждой встрече:
   - Время и название
   - Краткий юмористический инсайт или совет (1 предложение)
3. **Рекомендация** — один полезный совет по тайм-менеджменту на этот день
4. **Мотивация** — одна смешная/мотивирующая фраза дня

Пиши ТОЛЬКО на русском. Будь кратким, остроумным, не пошлым. Используй эмодзи умеренно.
НЕ используй <thinking> теги. Формат: markdown."""

@router.post("/api/calendar/briefing")
async def daily_briefing(req: dict = Body(...)):
    """Generate an AI daily briefing with humor and insights."""
    from datetime import datetime as _dt, timedelta

    provider_name = req.get("provider", "custom")
    model = req.get("model", "openai/gpt-oss-120b")

    api_key = await db.get_provider_key(provider_name)
    if not api_key:
        raise HTTPException(status_code=400, detail=f"No API key for {provider_name}")

    base_url = await _get_provider_base_url(provider_name)
    provider = get_provider(provider_name, api_key, base_url)

    today = _dt.now()
    today_str = today.strftime("%Y-%m-%d")
    weekday_names = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"]
    weekday = weekday_names[today.weekday()]

    # Fetch today's events
    start = today.replace(hour=0, minute=0, second=0).isoformat()
    end = (today.replace(hour=0, minute=0, second=0) + timedelta(days=1)).isoformat()
    events = await cal_db.list_events(start, end)

    if not events:
        events_list = "Нет встреч — свободный день!"
    else:
        events_list = "\n".join(
            f"- {e['start_time'][-8:-3]}–{e['end_time'][-8:-3]}: {e['title']}"
            + (f" ({e['description']})" if e.get("description") else "")
            for e in sorted(events, key=lambda x: x["start_time"])
        )

    free_slots = await cal_db.find_free_slots(today_str)
    free_time = ", ".join(
        f"{s['start'][-8:-3]}–{s['end'][-8:-3]}" for s in free_slots
    ) if free_slots else "весь день свободен"

    prompt = BRIEFING_PROMPT.format(
        date=today.strftime("%d.%m.%Y"),
        weekday=weekday,
        events_list=events_list,
        free_time=free_time,
    )

    from app.providers.base import LLMMessage as _Msg, LLMRequest as _Req
    llm_req = _Req(
        messages=[_Msg(role="user", content=prompt)],
        model=model,
        temperature=0.7,
        max_tokens=1024,
    )

    resp = await provider.complete(llm_req)
    content = resp.content or ""
    # Strip thinking tags if any
    content = re.sub(r'<thinking>.*?</thinking>', '', content, flags=re.DOTALL)
    content = content.replace('<thinking>', '').replace('</thinking>', '').strip()

    return {"briefing": content, "event_count": len(events), "date": today_str}
