"""SQLite database layer using aiosqlite."""

from __future__ import annotations

import asyncio
import aiosqlite
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import settings

logger = logging.getLogger(__name__)

DB_PATH = settings.db_path

_db_connection: aiosqlite.Connection | None = None
_db_lock = asyncio.Lock()

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
    # Add index on conversations.updated_at for faster sorting
    "CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at)",
]


async def get_db() -> aiosqlite.Connection:
    global _db_connection
    if _db_connection is None:
        async with _db_lock:
            if _db_connection is None:
                _db_connection = await aiosqlite.connect(DB_PATH)
                _db_connection.row_factory = aiosqlite.Row
                await _db_connection.execute("PRAGMA journal_mode=WAL")
                await _db_connection.execute("PRAGMA foreign_keys=ON")
    return _db_connection


async def init_db():
    db = await get_db()
    await db.executescript(SCHEMA)
    # Run migrations for existing databases
    for migration in MIGRATIONS:
        try:
            await db.execute(migration)
        except Exception as e:
            err_msg = str(e).lower()
            if "already exists" in err_msg or "duplicate column" in err_msg:
                pass  # Column/table already exists
            else:
                logger.warning("Unexpected migration error: %s — SQL: %s", e, migration)
    await db.commit()


# ── Folders ──

async def create_folder(name: str, parent_folder_id: str | None = None) -> dict:
    db = await get_db()
    fid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        "INSERT INTO folders (id, name, parent_folder_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (fid, name, parent_folder_id, now, now),
    )
    await db.commit()
    return {"id": fid, "name": name, "parent_folder_id": parent_folder_id, "created_at": now, "updated_at": now}


async def list_folders() -> list[dict]:
    db = await get_db()
    cursor = await db.execute("SELECT * FROM folders ORDER BY name ASC")
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


async def get_folder(fid: str) -> dict | None:
    db = await get_db()
    cursor = await db.execute("SELECT * FROM folders WHERE id = ?", (fid,))
    row = await cursor.fetchone()
    return dict(row) if row else None


async def rename_folder(fid: str, name: str):
    db = await get_db()
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        "UPDATE folders SET name = ?, updated_at = ? WHERE id = ?",
        (name, now, fid),
    )
    await db.commit()


async def delete_folder(fid: str):
    """Delete folder and move its children (subfolders + conversations) to its parent."""
    db = await get_db()
    # Check existence first
    cursor = await db.execute("SELECT parent_folder_id FROM folders WHERE id = ?", (fid,))
    row = await cursor.fetchone()
    if row is None:
        raise ValueError(f"Folder not found: {fid}")
    parent_id = row["parent_folder_id"]
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


async def move_folder(fid: str, new_parent_id: str | None):
    """Move a folder to a different parent (or root if None)."""
    db = await get_db()
    # Circular reference check: walk parent chain from new_parent_id
    if new_parent_id is not None:
        current = new_parent_id
        while current is not None:
            if current == fid:
                raise ValueError(f"Circular reference: folder {fid} is an ancestor of {new_parent_id}")
            cursor = await db.execute("SELECT parent_folder_id FROM folders WHERE id = ?", (current,))
            row = await cursor.fetchone()
            current = row["parent_folder_id"] if row else None
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        "UPDATE folders SET parent_folder_id = ?, updated_at = ? WHERE id = ?",
        (new_parent_id, now, fid),
    )
    await db.commit()


async def move_conversation_to_folder(cid: str, folder_id: str | None):
    """Move conversation to a folder (or root if None)."""
    db = await get_db()
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        "UPDATE conversations SET folder_id = ?, updated_at = ? WHERE id = ?",
        (folder_id, now, cid),
    )
    await db.commit()


# ── Conversations ──

async def create_conversation(title: str = "New Chat") -> dict:
    db = await get_db()
    cid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
        (cid, title, now, now),
    )
    await db.commit()
    return {"id": cid, "title": title, "folder_id": None, "created_at": now, "updated_at": now}


async def list_conversations() -> list[dict]:
    db = await get_db()
    cursor = await db.execute(
        "SELECT * FROM conversations ORDER BY updated_at DESC"
    )
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


async def get_conversation(cid: str) -> dict | None:
    db = await get_db()
    cursor = await db.execute("SELECT * FROM conversations WHERE id = ?", (cid,))
    row = await cursor.fetchone()
    return dict(row) if row else None


async def update_conversation_title(cid: str, title: str):
    db = await get_db()
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
        (title, now, cid),
    )
    await db.commit()


async def delete_conversation(cid: str):
    db = await get_db()
    await db.execute("DELETE FROM conversations WHERE id = ?", (cid,))
    await db.commit()


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


async def get_messages(conversation_id: str) -> list[dict]:
    db = await get_db()
    cursor = await db.execute(
        "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
        (conversation_id,),
    )
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


# ── Provider Settings ──

async def save_provider_settings(provider: str, api_key: str, base_url: str = "", enabled: bool = True, extra: dict | None = None):
    db = await get_db()
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


async def get_provider_settings() -> list[dict]:
    db = await get_db()
    cursor = await db.execute("SELECT * FROM provider_settings")
    rows = await cursor.fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["enabled"] = bool(d["enabled"])
        try:
            d["extra"] = json.loads(d.get("extra", "{}"))
        except (json.JSONDecodeError, TypeError):
            logger.warning("Invalid JSON in provider_settings.extra for %s", d.get("provider"))
            d["extra"] = {}
        result.append(d)
    return result


async def search_conversations(query: str) -> list[dict]:
    """Search conversations by title or message content."""
    db = await get_db()
    pattern = f"%{query}%"
    cursor = await db.execute(
        """SELECT DISTINCT c.id, c.title, c.created_at, c.updated_at
           FROM conversations c
           LEFT JOIN messages m ON c.id = m.conversation_id
           WHERE c.title LIKE ? OR m.content LIKE ?
           ORDER BY c.updated_at DESC
           LIMIT 20""",
        (pattern, pattern),
    )
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


async def get_provider_key(provider: str) -> str | None:
    db = await get_db()
    cursor = await db.execute(
        "SELECT api_key FROM provider_settings WHERE provider = ? AND enabled = 1",
        (provider,),
    )
    row = await cursor.fetchone()
    return row["api_key"] if row else None
