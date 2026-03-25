"""Calendar REST API — CRUD for events and free-slot finder."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator

from app.db import calendar as cal_db

router = APIRouter(prefix="/api/calendar", tags=["calendar"])


# ── Schemas ──

def _validate_iso_datetime(value: str) -> str:
    """Validate that a string is a valid ISO 8601 datetime."""
    try:
        datetime.fromisoformat(value)
    except (ValueError, TypeError):
        raise ValueError(f"Invalid ISO 8601 datetime: {value!r}")
    return value


class EventCreate(BaseModel):
    title: str = Field(max_length=500)
    start_time: str
    end_time: str
    description: str = Field(default="", max_length=5000)
    color: str = "#3b82f6"

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_datetime(cls, v: str) -> str:
        return _validate_iso_datetime(v)

    @model_validator(mode="after")
    def end_after_start(self) -> "EventCreate":
        start = datetime.fromisoformat(self.start_time)
        end = datetime.fromisoformat(self.end_time)
        if end <= start:
            raise ValueError("end_time must be after start_time")
        return self


class EventUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=500)
    start_time: str | None = None
    end_time: str | None = None
    description: str | None = Field(default=None, max_length=5000)
    color: str | None = None

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_datetime(cls, v: str | None) -> str | None:
        if v is not None:
            _validate_iso_datetime(v)
        return v

    @model_validator(mode="after")
    def end_after_start(self) -> "EventUpdate":
        if self.start_time is not None and self.end_time is not None:
            start = datetime.fromisoformat(self.start_time)
            end = datetime.fromisoformat(self.end_time)
            if end <= start:
                raise ValueError("end_time must be after start_time")
        return self


class FreeSlotsRequest(BaseModel):
    date: str  # YYYY-MM-DD
    duration_minutes: int = Field(default=60, ge=1, le=1440)

    @field_validator("date")
    @classmethod
    def validate_date_format(cls, v: str) -> str:
        import re as _re
        if not _re.match(r"^\d{4}-\d{2}-\d{2}$", v):
            raise ValueError(f"Invalid date format: {v!r}, expected YYYY-MM-DD")
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError:
            raise ValueError(f"Invalid date: {v!r}")
        return v


# ── Endpoints ──

@router.get("/events")
async def list_events(start: str, end: str) -> list[dict]:
    try:
        datetime.fromisoformat(start)
    except (ValueError, TypeError):
        raise HTTPException(400, f"Invalid start datetime: {start!r}")
    try:
        datetime.fromisoformat(end)
    except (ValueError, TypeError):
        raise HTTPException(400, f"Invalid end datetime: {end!r}")
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


class ConflictCheckRequest(BaseModel):
    start_time: str
    end_time: str
    exclude_id: str | None = None

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_datetime(cls, v: str) -> str:
        return _validate_iso_datetime(v)

    @model_validator(mode="after")
    def end_after_start(self) -> "ConflictCheckRequest":
        start = datetime.fromisoformat(self.start_time)
        end = datetime.fromisoformat(self.end_time)
        if end <= start:
            raise ValueError("end_time must be after start_time")
        return self


@router.post("/free-slots")
async def free_slots(req: FreeSlotsRequest) -> list[dict]:
    return await cal_db.find_free_slots(req.date, req.duration_minutes)


@router.post("/conflicts")
async def check_conflicts(req: ConflictCheckRequest) -> list[dict]:
    return await cal_db.check_conflicts(req.start_time, req.end_time, req.exclude_id)
