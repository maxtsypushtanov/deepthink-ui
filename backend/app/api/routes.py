"""API routes for chat, conversations, and settings."""

from __future__ import annotations

import json
import logging
from fastapi import APIRouter, HTTPException
from sse_starlette.sse import EventSourceResponse

logger = logging.getLogger(__name__)

from app.api.schemas import (
    ChatRequest,
    ConversationCreate,
    ConversationMoveRequest,
    ConversationUpdate,
    FolderCreate,
    FolderMoveRequest,
    FolderUpdate,
    ProviderSettingsRequest,
)
from app.db import database as db
from app.providers.base import LLMMessage
from app.providers.registry import get_provider
from app.reasoning.engine import ReasoningEngine, ReasoningStrategy, SessionContext

router = APIRouter()

# In-memory session context storage keyed by conversation_id
_session_contexts: dict[str, SessionContext] = {}


# ── Calendar action parser ──

async def _parse_calendar_action(text: str) -> dict | None:
    """Extract and execute calendar action from LLM response text."""
    import re
    from app.db import calendar as cal_db

    try:
        # Try 1: find JSON with calendar_action key
        match = re.search(r'\{[^{}]*"calendar_action"\s*:\s*"[^"]*"[^{}]*\}', text)
        if match:
            data = json.loads(match.group())
            return await _execute_calendar_action(data, cal_db)

        # Try 2: find any JSON with title + start_time (model may use different key names)
        for m in re.finditer(r'\{[^{}]+\}', text):
            try:
                data = json.loads(m.group())
                if data.get("title") and data.get("start_time") and data.get("end_time"):
                    data["calendar_action"] = data.get("calendar_action", "create")
                    return await _execute_calendar_action(data, cal_db)
            except json.JSONDecodeError:
                continue

        # Try 3: regex extract title and ISO datetime from text
        title_match = re.search(r'"title"\s*:\s*"([^"]+)"', text)
        start_match = re.search(r'"start_time"\s*:\s*"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})"', text)
        end_match = re.search(r'"end_time"\s*:\s*"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})"', text)

        if title_match and start_match and end_match:
            ev = await cal_db.create_event(
                title=title_match.group(1),
                start_time=start_match.group(1),
                end_time=end_match.group(1),
            )
            return {"action": "created", "event": ev}

    except Exception:
        pass
    return None


async def _execute_calendar_action(data: dict, cal_db) -> dict | None:
    action = data.get("calendar_action", "create")
    if action == "create" and data.get("title") and data.get("start_time") and data.get("end_time"):
        ev = await cal_db.create_event(
            title=data["title"],
            start_time=data["start_time"],
            end_time=data["end_time"],
            description=data.get("description", ""),
        )
        return {"action": "created", "event": ev}
    elif action == "delete" and data.get("event_id"):
        ok = await cal_db.delete_event(data["event_id"])
        return {"action": "deleted", "event_id": data["event_id"], "ok": ok}
    elif action == "update" and data.get("event_id"):
        ev = await cal_db.update_event(
            data["event_id"],
            title=data.get("title"),
            start_time=data.get("start_time"),
            end_time=data.get("end_time"),
            description=data.get("description"),
        )
        return {"action": "updated", "event": ev}
    return None


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
        max_tokens=max(req.max_tokens, 2048),  # Calendar needs more tokens for reasoning models
        stream=True,
    )

    full_content = ""
    try:
        async for chunk in provider.stream(llm_req):
            if chunk.content:
                full_content += chunk.content
                yield {
                    "event": "content_delta",
                    "data": json.dumps({"content": chunk.content}, ensure_ascii=False),
                }
    except Exception as e:
        yield {"event": "error", "data": json.dumps({"error": str(e)})}
        return

    yield {
        "event": "thinking_end",
        "data": json.dumps({"strategy": "calendar", "steps": [], "total_duration_ms": 0}),
    }

    # Save assistant message
    await db.add_message(
        conversation_id, "assistant", full_content,
        model=req.model, provider=req.provider,
        reasoning_strategy="calendar",
    )

    # Parse calendar actions from response
    calendar_result = await _parse_calendar_action(full_content)

    done_data: dict = {}
    if calendar_result:
        done_data["calendar_result"] = calendar_result

    yield {"event": "done", "data": json.dumps(done_data, ensure_ascii=False)}


# ── Chat (SSE streaming) ──

@router.post("/api/chat")
async def chat(req: ChatRequest):
    """Stream a chat response with optional reasoning."""

    # Resolve provider API key
    api_key = await db.get_provider_key(req.provider)
    if not api_key:
        raise HTTPException(status_code=400, detail=f"No API key configured for provider: {req.provider}")

    # Get provider settings for base_url
    all_settings = await db.get_provider_settings()
    base_url = None
    for s in all_settings:
        if s["provider"] == req.provider and s.get("base_url"):
            base_url = s["base_url"]

    provider = get_provider(req.provider, api_key, base_url)

    # Create or get conversation
    if req.conversation_id:
        conv = await db.get_conversation(req.conversation_id)
        if not conv:
            raise HTTPException(status_code=404, detail="Conversation not found")
        conversation_id = req.conversation_id
    else:
        conv = await db.create_conversation(title=req.message[:50])
        conversation_id = conv["id"]

    # Save user message
    await db.add_message(conversation_id, "user", req.message)

    # Auto-rename if title is still default
    conv_data = await db.get_conversation(conversation_id)
    if conv_data and conv_data.get("title") in ("New Chat", "Новый чат"):
        new_title = req.message[:50].strip()
        if new_title:
            await db.update_conversation_title(conversation_id, new_title)

    # Build message history
    history = await db.get_messages(conversation_id)
    messages = [LLMMessage(role=m["role"], content=m["content"]) for m in history if m["role"] in ("user", "assistant")]

    # If clarification context is provided, append as system message
    if req.clarification_context:
        messages.append(LLMMessage(role="system", content=req.clarification_context))

    # Calendar mode: inject full calendar context and tool instructions
    if req.calendar_mode:
        from app.db import calendar as cal_db
        from datetime import datetime, timedelta
        today = datetime.now().strftime("%Y-%m-%d")
        tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        week_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        week_start -= timedelta(days=week_start.weekday())
        week_end = week_start + timedelta(days=14)
        existing = await cal_db.list_events(week_start.isoformat(), week_end.isoformat())
        free_today = await cal_db.find_free_slots(today)
        free_tomorrow = await cal_db.find_free_slots(tomorrow)

        events_text = "\n".join(
            f"- [{e['id']}] {e['title']}: {e['start_time']} — {e['end_time']}" + (f" ({e['description']})" if e.get('description') else "")
            for e in existing
        ) or "Нет встреч"

        cal_context = (
            f"Ты ассистент календаря. Сегодня: {today}\n"
            f"Встречи: {events_text}\n"
            f"Свободно сегодня: " + (", ".join(f"{s['start'][-8:-3]}—{s['end'][-8:-3]}" for s in free_today) or "весь день")
            + f"\nСвободно завтра: " + (", ".join(f"{s['start'][-8:-3]}—{s['end'][-8:-3]}" for s in free_tomorrow) or "весь день")
            + '\n\nКогда нужно создать/удалить/изменить встречу, ОБЯЗАТЕЛЬНО включи в ответ JSON:'
            '\nСоздать: {"calendar_action":"create","title":"...","start_time":"YYYY-MM-DDTHH:MM:SS","end_time":"YYYY-MM-DDTHH:MM:SS","description":"..."}'
            '\nУдалить: {"calendar_action":"delete","event_id":"..."}'
            '\nИзменить: {"calendar_action":"update","event_id":"...","title":"...","start_time":"...","end_time":"..."}'
            '\n\nСначала напиши JSON действия, потом краткий ответ пользователю.'
            '\nОтвечай на русском, максимально кратко (2-3 предложения).'
        )
        messages.insert(0, LLMMessage(role="system", content=cal_context))

    # Calendar mode: bypass reasoning engine, use direct streaming
    if req.calendar_mode:
        return EventSourceResponse(_calendar_event_stream(messages, provider, req, conversation_id))

    strategy = ReasoningStrategy(req.reasoning_strategy)
    engine = ReasoningEngine(provider, req.model)

    # Get or create session context for this conversation
    if conversation_id not in _session_contexts:
        _session_contexts[conversation_id] = SessionContext()
    session_context = _session_contexts[conversation_id]

    # Detect/cache domain for this turn
    await engine.retune_if_needed(messages, session_context)
    # Persona injection happens inside engine.run() after strategy resolution

    async def event_stream():
        full_content = ""
        reasoning_trace = []
        content_buffer = ""
        in_thinking = False

        yield {
            "event": "conversation",
            "data": json.dumps({"conversation_id": conversation_id}),
        }

        try:
            async for event in engine.run(
                messages,
                strategy,
                budget_rounds=req.budget_rounds,
                best_of_n=req.best_of_n,
                tree_breadth=req.tree_breadth,
                tree_depth=req.tree_depth,
                session_context=session_context,
            ):
                evt_type = event["event"]
                evt_data = event["data"]

                if evt_type == "content_delta":
                    raw = evt_data["content"]
                    content_buffer += raw
                    while True:
                        if not in_thinking:
                            think_start = content_buffer.find("<thinking>")
                            lt_pos = content_buffer.find("<")
                            if think_start != -1:
                                # Found complete <thinking> tag
                                before = content_buffer[:think_start]
                                if before:
                                    full_content += before
                                    yield {"event": "content_delta", "data": json.dumps({"content": before}, ensure_ascii=False)}
                                content_buffer = content_buffer[think_start + len("<thinking>"):]
                                in_thinking = True
                            elif lt_pos != -1 and lt_pos >= len(content_buffer) - len("<thinking>") + 1:
                                # Found '<' near end of buffer — could be start of partial <thinking> tag
                                # Emit everything before it, hold the rest
                                before = content_buffer[:lt_pos]
                                if before:
                                    full_content += before
                                    yield {"event": "content_delta", "data": json.dumps({"content": before}, ensure_ascii=False)}
                                content_buffer = content_buffer[lt_pos:]
                                break
                            else:
                                # No '<' or '<' is early enough that it's clearly not <thinking>
                                # Safe to emit everything
                                if content_buffer:
                                    full_content += content_buffer
                                    yield {"event": "content_delta", "data": json.dumps({"content": content_buffer}, ensure_ascii=False)}
                                content_buffer = ""
                                break
                        else:
                            think_end = content_buffer.find("</thinking>")
                            if think_end == -1:
                                break  # Wait for more data
                            else:
                                content_buffer = content_buffer[think_end + len("</thinking>"):]
                                in_thinking = False
                elif evt_type == "thinking_end":
                    reasoning_trace = evt_data.get("steps", [])
                    yield {
                        "event": evt_type,
                        "data": json.dumps(evt_data, ensure_ascii=False),
                    }
                else:
                    yield {
                        "event": evt_type,
                        "data": json.dumps(evt_data, ensure_ascii=False),
                    }

        except Exception as e:
            yield {
                "event": "error",
                "data": json.dumps({"error": str(e)}),
            }
            return

        # Flush remaining buffer
        if content_buffer and not in_thinking:
            remaining = content_buffer.replace("<thinking>", "").replace("</thinking>", "")
            if remaining:
                full_content += remaining
                yield {"event": "content_delta", "data": json.dumps({"content": remaining}, ensure_ascii=False)}
        content_buffer = ""

        # Guard against None content
        full_content = full_content or ""

        # Strip any remaining thinking tags from full_content
        full_content = ReasoningEngine._strip_thinking_tags(full_content)

        # Check for clarification request in the response
        needs_clarification, clarification_question = ReasoningEngine._check_clarification(full_content)
        if needs_clarification:
            yield {
                "event": "clarification_needed",
                "data": json.dumps({"question": clarification_question}, ensure_ascii=False),
            }

        # Save assistant message
        await db.add_message(
            conversation_id,
            "assistant",
            full_content,
            model=req.model,
            provider=req.provider,
            reasoning_strategy=strategy.value,
            reasoning_trace=json.dumps(reasoning_trace, ensure_ascii=False) if reasoning_trace else None,
        )

        # Auto-detect calendar actions in response
        calendar_result = None
        if req.calendar_mode:
            calendar_result = await _parse_calendar_action(full_content)

        done_data: dict = {}
        if calendar_result:
            done_data["calendar_result"] = calendar_result

        yield {"event": "done", "data": json.dumps(done_data, ensure_ascii=False)}

    return EventSourceResponse(event_stream())


# ── Conversations ──

@router.get("/api/conversations")
async def list_conversations():
    return await db.list_conversations()


@router.post("/api/conversations")
async def create_conversation(req: ConversationCreate):
    return await db.create_conversation(req.title)


@router.get("/api/conversations/{cid}")
async def get_conversation(cid: str):
    conv = await db.get_conversation(cid)
    if not conv:
        raise HTTPException(status_code=404, detail="Not found")
    return conv


@router.get("/api/conversations/{cid}/messages")
async def get_messages(cid: str):
    return await db.get_messages(cid)


@router.patch("/api/conversations/{cid}")
async def update_conversation(cid: str, req: ConversationUpdate):
    await db.update_conversation_title(cid, req.title)
    return {"ok": True}


@router.delete("/api/conversations/{cid}")
async def delete_conversation(cid: str):
    await db.delete_conversation(cid)
    return {"ok": True}


@router.put("/api/conversations/{cid}/folder")
async def move_conversation(cid: str, req: ConversationMoveRequest):
    conv = await db.get_conversation(cid)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    await db.move_conversation_to_folder(cid, req.folder_id)
    return {"ok": True}


# ── Folders ──

@router.get("/api/folders")
async def list_folders():
    return await db.list_folders()


@router.post("/api/folders")
async def create_folder(req: FolderCreate):
    return await db.create_folder(req.name, req.parent_folder_id)


@router.put("/api/folders/{fid}")
async def rename_folder(fid: str, req: FolderUpdate):
    folder = await db.get_folder(fid)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    await db.rename_folder(fid, req.name)
    return {"ok": True}


@router.delete("/api/folders/{fid}")
async def delete_folder(fid: str):
    folder = await db.get_folder(fid)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    await db.delete_folder(fid)
    return {"ok": True}


@router.put("/api/folders/{fid}/move")
async def move_folder(fid: str, req: FolderMoveRequest):
    folder = await db.get_folder(fid)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    # Prevent circular reference
    if req.parent_folder_id == fid:
        raise HTTPException(status_code=400, detail="Cannot move folder into itself")
    await db.move_folder(fid, req.parent_folder_id)
    return {"ok": True}


# ── Settings ──

@router.get("/api/settings/providers")
async def get_providers():
    settings = await db.get_provider_settings()
    # Mask API keys for security
    for s in settings:
        if s.get("api_key"):
            key = s["api_key"]
            s["api_key_preview"] = key[:8] + "..." + key[-4:] if len(key) > 12 else "***"
    return settings


@router.post("/api/settings/providers")
async def save_provider(req: ProviderSettingsRequest):
    await db.save_provider_settings(
        provider=req.provider,
        api_key=req.api_key,
        base_url=req.base_url,
        enabled=req.enabled,
    )
    return {"ok": True}


# ── Models list (per provider) ──

KNOWN_MODELS = {
    "custom": [
        {"id": "openai/gpt-oss-120b", "name": "GPT-OSS 120B", "context": 131072},
        {"id": "zai-org/GLM-4.7", "name": "GLM-4.7", "context": 131072},
        {"id": "zai-org/GLM-4.7-Flash", "name": "GLM-4.7 Flash", "context": 131072},
        {"id": "zai-org/GLM-4.6", "name": "GLM-4.6", "context": 131072},
    ],
}


async def _fetch_models_from_api(provider: str, api_key: str) -> list[dict]:
    """Try to fetch model list from provider API."""
    import httpx

    all_settings = await db.get_provider_settings()
    base_url = None
    for s in all_settings:
        if s["provider"] == provider and s.get("base_url"):
            base_url = s["base_url"]

    if not base_url:
        from app.providers.registry import PROVIDERS
        cls = PROVIDERS.get(provider)
        if cls:
            base_url = cls.base_url

    if not base_url:
        return []

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if provider == "openrouter":
        headers["HTTP-Referer"] = "https://deepthink-ui.local"
        headers["X-Title"] = "DeepThink UI"

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{base_url}/models", headers=headers)
        resp.raise_for_status()
        data = resp.json()

    models = []
    raw_models = data.get("data", data if isinstance(data, list) else [])
    for m in raw_models[:50]:  # Limit to 50 models
        model_id = m.get("id", "")
        model_name = m.get("name") or m.get("id", "").split("/")[-1]
        context = m.get("context_length") or m.get("context_window") or 4096
        models.append({"id": model_id, "name": model_name, "context": context})

    return models


@router.get("/api/models/{provider}")
async def list_models(provider: str):
    # Try dynamic fetch for providers that support it
    if provider in ("openrouter", "cloudru", "custom"):
        api_key = await db.get_provider_key(provider)
        if api_key:
            try:
                fetched = await _fetch_models_from_api(provider, api_key)
                if fetched:
                    return fetched
            except Exception as e:
                logger.warning(f"Failed to fetch models for {provider}: {e}")
    return KNOWN_MODELS.get(provider, [])
