"""Calendar REST API — CRUD for events and free-slot finder."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.db import calendar as cal_db

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


# ── Endpoints ──

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
