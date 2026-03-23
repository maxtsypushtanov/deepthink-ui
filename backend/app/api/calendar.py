"""Calendar REST API endpoints."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.db import calendar as cal_db
from app.providers.base import LLMMessage, LLMRequest

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/calendar", tags=["calendar"])


# ── Schemas ──

class EventCreate(BaseModel):
    title: str
    start_time: str
    end_time: str
    description: str = ""
    color: str = "#3b82f6"


class EventUpdate(BaseModel):
    title: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    description: str | None = None
    color: str | None = None


class FreeSlotsRequest(BaseModel):
    date: str  # YYYY-MM-DD
    duration_minutes: int = 60


class CalendarAgentRequest(BaseModel):
    message: str
    conversation_id: str | None = None


# ── CRUD endpoints ──

@router.get("/events")
async def list_events(start: str, end: str) -> list[dict]:
    return await cal_db.list_events(start, end)


@router.post("/events")
async def create_event(req: EventCreate) -> dict:
    return await cal_db.create_event(
        title=req.title,
        start_time=req.start_time,
        end_time=req.end_time,
        description=req.description,
        color=req.color,
    )


@router.get("/events/{event_id}")
async def get_event(event_id: str) -> dict:
    ev = await cal_db.get_event(event_id)
    if not ev:
        raise HTTPException(404, "Event not found")
    return ev


@router.patch("/events/{event_id}")
async def update_event(event_id: str, req: EventUpdate) -> dict:
    ev = await cal_db.update_event(event_id, **req.model_dump(exclude_none=True))
    if not ev:
        raise HTTPException(404, "Event not found")
    return ev


@router.delete("/events/{event_id}")
async def delete_event(event_id: str) -> dict:
    ok = await cal_db.delete_event(event_id)
    if not ok:
        raise HTTPException(404, "Event not found")
    return {"ok": True}


@router.post("/free-slots")
async def free_slots(req: FreeSlotsRequest) -> list[dict]:
    return await cal_db.find_free_slots(req.date, req.duration_minutes)


# ── Calendar Agent (chat-style, SSE) ──

CALENDAR_AGENT_SYSTEM = """\
Ты — ассистент календаря DeepThink. Ты помогаешь пользователю управлять \
расписанием: добавлять, перемещать и удалять встречи.

У тебя есть доступ к календарю через функции. Когда пользователь просит \
добавить встречу, ты:
1. Определяешь дату (если не указана — используй сегодня или ближайший рабочий день)
2. Определяешь длительность (по умолчанию 60 минут)
3. Ищешь свободные слоты через find_free_slots
4. Предлагаешь 2-3 варианта времени
5. После подтверждения создаёшь встречу через create_event

Отвечай на русском. Будь кратким.

Текущая дата: {today}

Свободные слоты на запрошенную дату:
{free_slots}

Существующие встречи на эту неделю:
{existing_events}

Отвечай пользователю. Если он выбрал слот, ответь JSON:
{{"action": "create_event", "title": "...", "start_time": "ISO", "end_time": "ISO", "description": "..."}}

Если нужно уточнить — просто задай вопрос текстом.
"""


@router.post("/agent")
async def calendar_agent(req: CalendarAgentRequest):
    """Calendar agent — streams response via SSE, auto-creates events."""
    from app.core.config import settings
    from app.providers.registry import get_provider

    today = datetime.now().strftime("%Y-%m-%d")

    # Get this week's events
    week_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    week_start -= timedelta(days=week_start.weekday())
    week_end = week_start + timedelta(days=7)
    existing = await cal_db.list_events(week_start.isoformat(), week_end.isoformat())
    existing_text = "\n".join(
        f"- {e['title']}: {e['start_time']} — {e['end_time']}"
        for e in existing
    ) or "Нет встреч"

    # Find free slots for today and tomorrow
    free_today = await cal_db.find_free_slots(today)
    tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
    free_tomorrow = await cal_db.find_free_slots(tomorrow)

    slots_text = f"Сегодня ({today}):\n"
    slots_text += "\n".join(f"  {s['start']} — {s['end']}" for s in free_today) or "  Нет свободных слотов"
    slots_text += f"\n\nЗавтра ({tomorrow}):\n"
    slots_text += "\n".join(f"  {s['start']} — {s['end']}" for s in free_tomorrow) or "  Нет свободных слотов"

    system_prompt = CALENDAR_AGENT_SYSTEM.format(
        today=today,
        free_slots=slots_text,
        existing_events=existing_text,
    )

    provider = get_provider("custom", settings.custom_api_key, settings.custom_base_url)

    llm_req = LLMRequest(
        messages=[
            LLMMessage(role="system", content=system_prompt),
            LLMMessage(role="user", content=req.message),
        ],
        model=settings.architect_model,
        temperature=0.3,
        max_tokens=1024,
        stream=True,
    )

    async def event_stream():
        full_content = ""
        async for chunk in provider.stream(llm_req):
            if chunk.content:
                full_content += chunk.content
                yield {
                    "event": "content_delta",
                    "data": json.dumps({"content": chunk.content}),
                }

        # Check if response contains a create_event action
        created_event = None
        try:
            # Find JSON in the response
            import re
            match = re.search(r'\{[\s\S]*"action"\s*:\s*"create_event"[\s\S]*\}', full_content)
            if match:
                data = json.loads(match.group())
                if data.get("action") == "create_event":
                    ev = await cal_db.create_event(
                        title=data["title"],
                        start_time=data["start_time"],
                        end_time=data["end_time"],
                        description=data.get("description", ""),
                    )
                    created_event = ev
        except Exception:
            logger.debug("No calendar action in response")

        yield {
            "event": "done",
            "data": json.dumps({
                "content": full_content,
                "created_event": created_event,
            }),
        }

    return EventSourceResponse(event_stream())
