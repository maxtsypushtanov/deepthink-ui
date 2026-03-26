"""Proactive Agent — a living assistant that initiates conversations.

Not a notification system. A thoughtful colleague who drops a message when relevant.

Triggers:
1. Morning briefing (09:00) — plan the day
2. Meeting prep (30 min before) — context + recommendations
3. Follow-up (next day after important conversation) — "How did it go?"
4. Goal check-in (weekly) — progress on stated goals
5. Insight (when idle) — share an observation based on user's interests
6. End of day (18:00) — summary + tomorrow preview
"""

from __future__ import annotations

import logging
import random
from datetime import datetime, timedelta, timezone

from app.db import calendar as cal_db
from app.db import database as db
from app.providers.base import LLMMessage, LLMRequest

logger = logging.getLogger(__name__)

# State tracking — prevents duplicate messages
_state = {
    "last_morning": None,      # date string
    "last_evening": None,      # date string
    "last_reminder_id": None,  # event id
    "last_reminder_at": None,  # datetime
    "last_followup": None,     # date string
    "last_insight": None,      # datetime
    "last_check": None,        # datetime (prevents rapid polling)
}


async def check_proactive(provider=None, model: str | None = None) -> dict | None:
    """Main entry point. Returns a proactive message or None.

    Called by frontend every 5 minutes via /api/proactive/check.
    """
    now = datetime.now()

    # Rate limit: max once per 3 minutes
    if _state["last_check"] and (now - _state["last_check"]).total_seconds() < 180:
        return None
    _state["last_check"] = now

    today = now.strftime("%Y-%m-%d")

    if not provider or not model:
        return None

    # Priority order — first match wins

    # 1. Morning briefing: 8:30–10:00, once per day
    if 8 <= now.hour < 10 and _state["last_morning"] != today:
        msg = await _morning_briefing(now, provider, model)
        if msg:
            _state["last_morning"] = today
            return msg

    # 2. Meeting reminder: 15-35 min before next event
    if _state["last_reminder_at"] is None or (now - _state["last_reminder_at"]).total_seconds() > 1500:
        msg = await _meeting_reminder(now, provider, model)
        if msg:
            return msg

    # 3. End of day summary: 17:30–19:00, once per day
    if 17 <= now.hour < 19 and _state["last_evening"] != today:
        msg = await _evening_summary(now, provider, model)
        if msg:
            _state["last_evening"] = today
            return msg

    # 4. Follow-up on yesterday's conversations (once per day, 10:00-12:00)
    if 10 <= now.hour < 12 and _state["last_followup"] != today:
        msg = await _conversation_followup(now, provider, model)
        if msg:
            _state["last_followup"] = today
            return msg

    # 5. Insight (when idle, max once per 3 hours, 10:00-20:00)
    if 10 <= now.hour < 20:
        if _state["last_insight"] is None or (now - _state["last_insight"]).total_seconds() > 10800:
            msg = await _idle_insight(now, provider, model)
            if msg:
                _state["last_insight"] = now
                return msg

    return None


# ── Trigger Implementations ──

async def _morning_briefing(now: datetime, provider, model: str) -> dict | None:
    today = now.strftime("%Y-%m-%d")
    events = await cal_db.list_events(f"{today}T00:00:00", f"{today}T23:59:59")
    free = await cal_db.find_free_slots(today)
    profile = await _get_profile()

    events_text = "\n".join(
        f"- {e['start_time'][11:16]}–{e['end_time'][11:16]}: {e['title']}"
        for e in events
    ) if events else "Нет запланированных встреч"

    free_text = ", ".join(f"{s['start'][11:16]}–{s['end'][11:16]}" for s in free[:4]) if free else "Нет"

    prompt = f"""Составь короткое утреннее сообщение (3-4 предложения).
{profile}
Расписание на сегодня:\n{events_text}
Свободные слоты: {free_text}

Тон: как умный друг-секретарь. Поприветствуй по имени если знаешь. Упомяни ключевые встречи. Если день свободный — предложи запланировать.
Пиши ТОЛЬКО финальное сообщение, без тегов."""

    text = await _gen(prompt, provider, model)
    return {"type": "morning", "icon": "sun", "message": text} if text else None


async def _meeting_reminder(now: datetime, provider, model: str) -> dict | None:
    upcoming = await _upcoming_events(now, 35)
    if not upcoming:
        return None

    ev = upcoming[0]
    if ev["id"] == _state["last_reminder_id"]:
        return None

    try:
        minutes = int((datetime.fromisoformat(ev["start_time"]) - now).total_seconds() / 60)
    except ValueError:
        minutes = 30

    profile = await _get_profile()
    desc = ev.get("description", "")

    prompt = f"""Через {minutes} мин встреча: «{ev['title']}» ({ev['start_time'][11:16]}–{ev['end_time'][11:16]}).
{f'Описание: {desc}' if desc else ''}
{profile}
Напиши 1-2 предложения: напомни + если есть описание, дай совет по подготовке. Тон ненавязчивый, полезный.
Пиши ТОЛЬКО финальное сообщение."""

    text = await _gen(prompt, provider, model)
    if text:
        _state["last_reminder_id"] = ev["id"]
        _state["last_reminder_at"] = now
        return {"type": "reminder", "icon": "calendar", "message": text}
    return None


async def _evening_summary(now: datetime, provider, model: str) -> dict | None:
    today = now.strftime("%Y-%m-%d")
    events = await cal_db.list_events(f"{today}T00:00:00", f"{today}T23:59:59")
    tomorrow = (now + timedelta(days=1)).strftime("%Y-%m-%d")
    tomorrow_events = await cal_db.list_events(f"{tomorrow}T00:00:00", f"{tomorrow}T23:59:59")
    profile = await _get_profile()

    today_text = "\n".join(f"- {e['title']}" for e in events) if events else "Ничего"
    tomorrow_text = "\n".join(
        f"- {e['start_time'][11:16]}: {e['title']}" for e in tomorrow_events
    ) if tomorrow_events else "Пока пусто"

    # Count today's conversations
    convs = await db.list_conversations()
    today_convs = [c for c in convs if c.get("updated_at", "").startswith(today)]

    prompt = f"""Составь короткое вечернее сообщение (2-3 предложения).
{profile}
Сегодня было: {len(events)} встреч, {len(today_convs)} диалогов.
Встречи сегодня: {today_text}
Завтра: {tomorrow_text}

Тон: тёплый, завершающий день. Подведи итог, упомяни что завтра. Если завтра пусто — предложи запланировать.
Пиши ТОЛЬКО финальное сообщение."""

    text = await _gen(prompt, provider, model)
    return {"type": "evening", "icon": "moon", "message": text} if text else None


async def _conversation_followup(now: datetime, provider, model: str) -> dict | None:
    """Follow up on yesterday's important conversations."""
    yesterday = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    convs = await db.list_conversations()
    yesterday_convs = [c for c in convs if c.get("updated_at", "").startswith(yesterday)]

    if not yesterday_convs:
        return None

    # Pick the longest/most important conversation from yesterday
    best = max(yesterday_convs, key=lambda c: len(c.get("title", "")))
    title = best.get("title", "")
    if len(title) < 10:
        return None

    profile = await _get_profile()

    prompt = f"""Вчера пользователь обсуждал тему: «{title[:80]}».
{profile}
Напиши 1 предложение — дружеский follow-up: спроси как дела с этой темой, или предложи продолжить.
Тон: как коллега, который помнит вчерашний разговор. Естественно, не формально.
Пиши ТОЛЬКО финальное сообщение."""

    text = await _gen(prompt, provider, model)
    return {"type": "followup", "icon": "message", "message": text} if text else None


async def _idle_insight(now: datetime, provider, model: str) -> dict | None:
    """Share an insight based on user's interests. Random 30% chance."""
    if random.random() > 0.3:
        return None

    profile = await _get_profile()
    if not profile or len(profile) < 50:
        return None  # Not enough data about user

    memories = await db.get_user_memory("interests")
    if not memories:
        memories = await db.get_user_memory("expertise")
    if not memories:
        return None

    topic = random.choice(memories)
    topic_text = f"{topic['key']}: {topic['value']}"

    prompt = f"""Пользователь интересуется: {topic_text}
{profile}
Поделись одним коротким интересным фактом, наблюдением или вопросом по этой теме (1-2 предложения).
Не будь навязчивым. Как будто вспомнил что-то любопытное и решил поделиться.
Пиши ТОЛЬКО финальное сообщение."""

    text = await _gen(prompt, provider, model)
    return {"type": "insight", "icon": "sparkle", "message": text} if text else None


# ── Helpers ──

async def _get_profile() -> str:
    from app.reasoning.memory import get_user_profile_prompt
    p = await get_user_profile_prompt()
    return p or ""


async def _upcoming_events(now: datetime, minutes: int) -> list[dict]:
    start = now.isoformat()
    end = (now + timedelta(minutes=minutes)).isoformat()
    events = await cal_db.list_events(start, end)
    return [e for e in events if datetime.fromisoformat(e["start_time"]) > now]


async def _gen(prompt: str, provider, model: str) -> str | None:
    try:
        req = LLMRequest(
            messages=[LLMMessage(role="user", content=prompt)],
            model=model, temperature=0.7, max_tokens=200,
        )
        resp = await provider.complete(req)
        return resp.content.strip() if resp.content else None
    except Exception as e:
        logger.warning("Proactive gen failed: %s", e)
        return None
