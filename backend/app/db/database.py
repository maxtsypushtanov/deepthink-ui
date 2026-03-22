"""SQLite database layer using aiosqlite."""

from __future__ import annotations

import aiosqlite
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import settings

DB_PATH = settings.db_path

SCHEMA = """
CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_folder_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (parent_folder_id) REFERENCES folders(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'New Chat',
    folder_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    model TEXT,
    provider TEXT,
    reasoning_strategy TEXT,
    reasoning_trace TEXT,
    tokens_used INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS provider_settings (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL UNIQUE,
    api_key TEXT NOT NULL DEFAULT '',
    base_url TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    extra TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_folder ON conversations(folder_id);
"""

MIGRATIONS = [
    # Add folder_id column to existing conversations table
    "ALTER TABLE conversations ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL",
]


async def get_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    return db


async def init_db():
    db = await get_db()
    try:
        await db.executescript(SCHEMA)
        # Run migrations for existing databases
        for migration in MIGRATIONS:
            try:
                await db.execute(migration)
            except Exception:
                pass  # Column/table already exists
        await db.commit()
    finally:
        await db.close()


# ── Folders ──

async def create_folder(name: str, parent_folder_id: str | None = None) -> dict:
    db = await get_db()
    try:
        fid = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        await db.execute(
            "INSERT INTO folders (id, name, parent_folder_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (fid, name, parent_folder_id, now, now),
        )
        await db.commit()
        return {"id": fid, "name": name, "parent_folder_id": parent_folder_id, "created_at": now, "updated_at": now}
    finally:
        await db.close()


async def list_folders() -> list[dict]:
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM folders ORDER BY name ASC")
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


async def get_folder(fid: str) -> dict | None:
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM folders WHERE id = ?", (fid,))
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def rename_folder(fid: str, name: str):
    db = await get_db()
    try:
        now = datetime.now(timezone.utc).isoformat()
        await db.execute(
            "UPDATE folders SET name = ?, updated_at = ? WHERE id = ?",
            (name, now, fid),
        )
        await db.commit()
    finally:
        await db.close()


async def delete_folder(fid: str):
    """Delete folder and move its children (subfolders + conversations) to its parent."""
    db = await get_db()
    try:
        # Get folder's parent
        cursor = await db.execute("SELECT parent_folder_id FROM folders WHERE id = ?", (fid,))
        row = await cursor.fetchone()
        parent_id = row["parent_folder_id"] if row else None
        # Move child folders to parent
        await db.execute(
            "UPDATE folders SET parent_folder_id = ? WHERE parent_folder_id = ?",
            (parent_id, fid),
        )
        # Move conversations to parent
        await db.execute(
            "UPDATE conversations SET folder_id = ? WHERE folder_id = ?",
            (parent_id, fid),
        )
        # Delete the folder
        await db.execute("DELETE FROM folders WHERE id = ?", (fid,))
        await db.commit()
    finally:
        await db.close()


async def move_folder(fid: str, new_parent_id: str | None):
    """Move a folder to a different parent (or root if None)."""
    db = await get_db()
    try:
        now = datetime.now(timezone.utc).isoformat()
        await db.execute(
            "UPDATE folders SET parent_folder_id = ?, updated_at = ? WHERE id = ?",
            (new_parent_id, now, fid),
        )
        await db.commit()
    finally:
        await db.close()


async def move_conversation_to_folder(cid: str, folder_id: str | None):
    """Move conversation to a folder (or root if None)."""
    db = await get_db()
    try:
        now = datetime.now(timezone.utc).isoformat()
        await db.execute(
            "UPDATE conversations SET folder_id = ?, updated_at = ? WHERE id = ?",
            (folder_id, now, cid),
        )
        await db.commit()
    finally:
        await db.close()


# ── Conversations ──

async def create_conversation(title: str = "New Chat") -> dict:
    db = await get_db()
    try:
        cid = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        await db.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (cid, title, now, now),
        )
        await db.commit()
        return {"id": cid, "title": title, "folder_id": None, "created_at": now, "updated_at": now}
    finally:
        await db.close()


async def list_conversations() -> list[dict]:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM conversations ORDER BY updated_at DESC"
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


async def get_conversation(cid: str) -> dict | None:
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM conversations WHERE id = ?", (cid,))
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def update_conversation_title(cid: str, title: str):
    db = await get_db()
    try:
        now = datetime.now(timezone.utc).isoformat()
        await db.execute(
            "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
            (title, now, cid),
        )
        await db.commit()
    finally:
        await db.close()


async def delete_conversation(cid: str):
    db = await get_db()
    try:
        await db.execute("DELETE FROM conversations WHERE id = ?", (cid,))
        await db.commit()
    finally:
        await db.close()


# ── Messages ──

async def add_message(
    conversation_id: str,
    role: str,
    content: str,
    model: str | None = None,
    provider: str | None = None,
    reasoning_strategy: str | None = None,
    reasoning_trace: str | None = None,
    tokens_used: int = 0,
) -> dict:
    db = await get_db()
    try:
        mid = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        await db.execute(
            """INSERT INTO messages
               (id, conversation_id, role, content, model, provider,
                reasoning_strategy, reasoning_trace, tokens_used, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (mid, conversation_id, role, content, model, provider,
             reasoning_strategy, reasoning_trace, tokens_used, now),
        )
        await db.execute(
            "UPDATE conversations SET updated_at = ? WHERE id = ?",
            (now, conversation_id),
        )
        await db.commit()
        return {
            "id": mid,
            "conversation_id": conversation_id,
            "role": role,
            "content": content,
            "model": model,
            "provider": provider,
            "reasoning_strategy": reasoning_strategy,
            "reasoning_trace": reasoning_trace,
            "tokens_used": tokens_used,
            "created_at": now,
        }
    finally:
        await db.close()


async def get_messages(conversation_id: str) -> list[dict]:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
            (conversation_id,),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


# ── Provider Settings ──

async def save_provider_settings(provider: str, api_key: str, base_url: str = "", enabled: bool = True, extra: dict | None = None):
    db = await get_db()
    try:
        pid = str(uuid.uuid4())
        extra_json = json.dumps(extra or {})
        await db.execute(
            """INSERT INTO provider_settings (id, provider, api_key, base_url, enabled, extra)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(provider) DO UPDATE SET
                 api_key = excluded.api_key,
                 base_url = excluded.base_url,
                 enabled = excluded.enabled,
                 extra = excluded.extra""",
            (pid, provider, api_key, base_url, int(enabled), extra_json),
        )
        await db.commit()
    finally:
        await db.close()


async def get_provider_settings() -> list[dict]:
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM provider_settings")
        rows = await cursor.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["enabled"] = bool(d["enabled"])
            d["extra"] = json.loads(d.get("extra", "{}"))
            result.append(d)
        return result
    finally:
        await db.close()


async def get_provider_key(provider: str) -> str | None:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT api_key FROM provider_settings WHERE provider = ? AND enabled = 1",
            (provider,),
        )
        row = await cursor.fetchone()
        return row["api_key"] if row else None
    finally:
        await db.close()
