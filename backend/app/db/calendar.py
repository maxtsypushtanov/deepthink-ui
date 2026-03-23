"""Calendar database layer — events stored in SQLite."""

from __future__ import annotations

import aiosqlite
import uuid
from datetime import datetime, timedelta, timezone

from app.core.config import settings

DB_PATH = settings.db_path

CALENDAR_SCHEMA = """
CREATE TABLE IF NOT EXISTS calendar_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#3b82f6',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calendar_start ON calendar_events(start_time);
CREATE INDEX IF NOT EXISTS idx_calendar_end ON calendar_events(end_time);
"""


async def init_calendar_db() -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(CALENDAR_SCHEMA)
        await db.commit()


async def _get_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    return db


# ── CRUD ──

async def create_event(
    title: str,
    start_time: str,
    end_time: str,
    description: str = "",
    color: str = "#3b82f6",
) -> dict:
    eid = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).isoformat()
    db = await _get_db()
    try:
        await db.execute(
            "INSERT INTO calendar_events (id, title, description, start_time, end_time, color, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (eid, title, description, start_time, end_time, color, now),
        )
        await db.commit()
        return {"id": eid, "title": title, "description": description,
                "start_time": start_time, "end_time": end_time, "color": color}
    finally:
        await db.close()


async def list_events(start: str, end: str) -> list[dict]:
    """List events overlapping [start, end] range."""
    db = await _get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM calendar_events WHERE start_time < ? AND end_time > ? ORDER BY start_time",
            (end, start),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


async def get_event(eid: str) -> dict | None:
    db = await _get_db()
    try:
        cursor = await db.execute("SELECT * FROM calendar_events WHERE id = ?", (eid,))
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def update_event(eid: str, **kwargs: str) -> dict | None:
    allowed = {"title", "description", "start_time", "end_time", "color"}
    fields = {k: v for k, v in kwargs.items() if k in allowed and v is not None}
    if not fields:
        return await get_event(eid)
    sets = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [eid]
    db = await _get_db()
    try:
        await db.execute(f"UPDATE calendar_events SET {sets} WHERE id = ?", vals)
        await db.commit()
        return await get_event(eid)
    finally:
        await db.close()


async def delete_event(eid: str) -> bool:
    db = await _get_db()
    try:
        cursor = await db.execute("DELETE FROM calendar_events WHERE id = ?", (eid,))
        await db.commit()
        return cursor.rowcount > 0
    finally:
        await db.close()


# ── Free slots finder ──

async def find_free_slots(
    date: str,
    duration_minutes: int = 60,
    work_start: int = 9,
    work_end: int = 18,
) -> list[dict]:
    """Find free time slots on a given date.

    Args:
        date: ISO date string (YYYY-MM-DD)
        duration_minutes: Desired meeting duration
        work_start: Work day start hour (24h)
        work_end: Work day end hour (24h)

    Returns list of {"start": ISO, "end": ISO} free slots.
    """
    day_start = f"{date}T{work_start:02d}:00:00"
    day_end = f"{date}T{work_end:02d}:00:00"

    events = await list_events(day_start, day_end)

    # Build occupied intervals
    occupied: list[tuple[datetime, datetime]] = []
    for ev in events:
        s = datetime.fromisoformat(ev["start_time"])
        e = datetime.fromisoformat(ev["end_time"])
        occupied.append((s, e))
    occupied.sort(key=lambda x: x[0])

    # Scan for gaps
    slots: list[dict] = []
    current = datetime.fromisoformat(day_start)
    end_dt = datetime.fromisoformat(day_end)
    duration = timedelta(minutes=duration_minutes)

    for occ_start, occ_end in occupied:
        if current + duration <= occ_start:
            slots.append({
                "start": current.isoformat(),
                "end": (current + duration).isoformat(),
            })
        current = max(current, occ_end)

    # Check remaining time after last event
    if current + duration <= end_dt:
        slots.append({
            "start": current.isoformat(),
            "end": (current + duration).isoformat(),
        })

    return slots
