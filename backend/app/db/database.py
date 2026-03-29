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
    dominant_domain TEXT DEFAULT 'general',
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

CREATE TABLE IF NOT EXISTS user_memory (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    confidence REAL DEFAULT 0.5,
    source_conversation TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    decay_at TEXT
);

CREATE TABLE IF NOT EXISTS conversation_summaries (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    keywords TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS model_tiers (
    tier TEXT PRIMARY KEY,
    model TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS neuron_identity (
    layer TEXT PRIMARY KEY,
    content TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS neuron_episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT,
    episode TEXT NOT NULL DEFAULT '',
    self_insight TEXT NOT NULL DEFAULT '',
    user_insight TEXT NOT NULL DEFAULT '',
    emotional_valence REAL DEFAULT 0.0,
    importance REAL DEFAULT 0.5,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_folder ON conversations(folder_id);
CREATE INDEX IF NOT EXISTS idx_user_memory_category ON user_memory(category);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_memory_key ON user_memory(category, key);
CREATE INDEX IF NOT EXISTS idx_conversation_summaries_conv ON conversation_summaries(conversation_id);
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


async def update_conversation_domain(cid: str, domain: str):
    """Update the dominant domain for smart folder grouping."""
    db = await get_db()
    try:
        await db.execute(
            "UPDATE conversations SET dominant_domain = ? WHERE id = ?",
            (domain, cid),
        )
        await db.commit()
    except Exception:
        pass  # Column may not exist in older DBs


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


async def get_model_tiers() -> dict[str, str]:
    """Get model tier configuration."""
    db = await get_db()
    cursor = await db.execute("SELECT tier, model FROM model_tiers")
    rows = await cursor.fetchall()
    return {r["tier"]: r["model"] for r in rows}


async def set_model_tier(tier: str, model: str) -> None:
    """Set model for a tier."""
    db = await get_db()
    await db.execute(
        "INSERT INTO model_tiers (tier, model) VALUES (?, ?) ON CONFLICT(tier) DO UPDATE SET model = ?",
        (tier, model, model),
    )
    await db.commit()


async def get_provider_base_url(provider: str) -> str | None:
    """Get base URL for a specific provider."""
    db = await get_db()
    cursor = await db.execute(
        "SELECT base_url FROM provider_settings WHERE provider = ? AND enabled = 1",
        (provider,),
    )
    row = await cursor.fetchone()
    return row["base_url"] if row and row["base_url"] else None


# ── Conversation Summaries (RAG) ──

async def save_conversation_summary(conversation_id: str, summary: str, keywords: str = "") -> dict:
    """Save or update a conversation summary for RAG retrieval."""
    _db = await get_db()
    sid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    # Upsert: one summary per conversation
    cursor = await _db.execute(
        "SELECT id FROM conversation_summaries WHERE conversation_id = ?",
        (conversation_id,),
    )
    existing = await cursor.fetchone()
    if existing:
        sid = existing["id"]
        await _db.execute(
            "UPDATE conversation_summaries SET summary = ?, keywords = ?, created_at = ? WHERE id = ?",
            (summary, keywords, now, sid),
        )
    else:
        await _db.execute(
            "INSERT INTO conversation_summaries (id, conversation_id, summary, keywords, created_at) VALUES (?, ?, ?, ?, ?)",
            (sid, conversation_id, summary, keywords, now),
        )
    await _db.commit()
    return {"id": sid, "conversation_id": conversation_id, "summary": summary, "keywords": keywords, "created_at": now}


async def get_all_conversation_summaries() -> list[dict]:
    """Get all conversation summaries for building the vector index."""
    _db = await get_db()
    cursor = await _db.execute(
        "SELECT cs.id, cs.conversation_id, cs.summary, cs.keywords, cs.created_at, c.title "
        "FROM conversation_summaries cs LEFT JOIN conversations c ON cs.conversation_id = c.id "
        "ORDER BY cs.created_at DESC LIMIT 500"
    )
    rows = await cursor.fetchall()
    return [dict(row) for row in rows]


# ── Neuron Identity ──

async def get_neuron_layer(layer: str) -> dict | None:
    conn = await get_db()
    cursor = await conn.execute("SELECT content FROM neuron_identity WHERE layer = ?", (layer,))
    row = await cursor.fetchone()
    if row:
        try:
            return json.loads(row["content"])
        except (json.JSONDecodeError, TypeError):
            return None
    return None


async def get_all_neuron_layers() -> dict[str, dict]:
    conn = await get_db()
    cursor = await conn.execute("SELECT layer, content FROM neuron_identity")
    rows = await cursor.fetchall()
    result = {}
    for r in rows:
        try:
            result[r["layer"]] = json.loads(r["content"])
        except (json.JSONDecodeError, TypeError):
            result[r["layer"]] = {}
    return result


async def upsert_neuron_layer(layer: str, data: dict) -> None:
    conn = await get_db()
    data_json = json.dumps(data, ensure_ascii=False)
    await conn.execute(
        "INSERT INTO neuron_identity (layer, content, updated_at) VALUES (?, ?, datetime('now')) "
        "ON CONFLICT(layer) DO UPDATE SET content = ?, updated_at = datetime('now')",
        (layer, data_json, data_json),
    )
    await conn.commit()


async def add_neuron_episode(conversation_id: str, episode: str, self_insight: str, user_insight: str, valence: float = 0.0, importance: float = 0.5) -> None:
    conn = await get_db()
    await conn.execute(
        "INSERT INTO neuron_episodes (conversation_id, episode, self_insight, user_insight, emotional_valence, importance) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (conversation_id, episode, self_insight, user_insight, valence, importance),
    )
    await conn.commit()


async def get_episode_count() -> int:
    conn = await get_db()
    cursor = await conn.execute("SELECT COUNT(*) FROM neuron_episodes")
    row = await cursor.fetchone()
    return row[0] if row else 0


async def get_recent_episodes(limit: int = 10) -> list[dict]:
    conn = await get_db()
    cursor = await conn.execute(
        "SELECT * FROM neuron_episodes ORDER BY created_at DESC LIMIT ?", (limit,)
    )
    return [dict(r) for r in await cursor.fetchall()]


async def get_self_insights(limit: int = 20) -> list[str]:
    conn = await get_db()
    cursor = await conn.execute(
        "SELECT self_insight FROM neuron_episodes WHERE self_insight != '' ORDER BY created_at DESC LIMIT ?",
        (limit,),
    )
    return [r["self_insight"] for r in await cursor.fetchall()]


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


# ── User Memory (Cognitive Profile) ──

async def get_user_memory(category: str | None = None) -> list[dict]:
    """Get all memory entries, optionally filtered by category."""
    db = await get_db()
    if category:
        cursor = await db.execute(
            "SELECT * FROM user_memory WHERE category = ? ORDER BY confidence DESC, updated_at DESC",
            (category,),
        )
    else:
        cursor = await db.execute(
            "SELECT * FROM user_memory ORDER BY category, confidence DESC"
        )
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


async def upsert_memory(category: str, key: str, value: str,
                        confidence: float = 0.5,
                        source_conversation: str | None = None) -> dict:
    """Insert or update a memory entry. If key exists in category, update it."""
    db = await get_db()
    now = datetime.now(timezone.utc).isoformat()
    mid = str(uuid.uuid4())

    # Try update first
    cursor = await db.execute(
        "SELECT id, confidence FROM user_memory WHERE category = ? AND key = ?",
        (category, key),
    )
    existing = await cursor.fetchone()

    if existing:
        # Strengthen confidence on update (EWMA)
        new_confidence = min(1.0, existing["confidence"] * 0.7 + confidence * 0.3)
        await db.execute(
            "UPDATE user_memory SET value = ?, confidence = ?, updated_at = ?, source_conversation = ? WHERE id = ?",
            (value, new_confidence, now, source_conversation, existing["id"]),
        )
        mid = existing["id"]
    else:
        await db.execute(
            """INSERT INTO user_memory (id, category, key, value, confidence, source_conversation, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (mid, category, key, value, confidence, source_conversation, now, now),
        )
    await db.commit()
    return {"id": mid, "category": category, "key": key, "value": value, "confidence": confidence}


"""
TRIZ #3 "Local Quality" — each memory type decays at its own rate.
TRIZ #35 "Parameter Changes" — compress instead of delete.
"""

# Category-based decay: identity is permanent, context is ephemeral
DECAY_RATES: dict[str, float] = {
    "personal": 1.0,       # NEVER decays — name, age, city are permanent
    "role": 0.995,         # Very slow — job/company changes rarely
    "expertise": 0.99,     # Slow — skills don't disappear overnight
    "preferences": 0.98,   # Medium — preferences evolve
    "style": 0.99,         # Slow — communication style is stable
    "interests": 0.96,     # Faster — interests shift
    "goals": 0.93,         # Fast — goals are time-bound
    "topics": 0.90,        # Fastest — conversation topics are ephemeral
    "context": 0.93,       # Fast — context changes
}

# Confidence floor per category — below this, entry is deleted
CONFIDENCE_FLOOR: dict[str, float] = {
    "personal": 0.3,       # Keep personal info even at low confidence
    "role": 0.1,
    "expertise": 0.08,
    "preferences": 0.05,
    "style": 0.05,
    "interests": 0.05,
    "goals": 0.05,
    "topics": 0.05,
    "context": 0.05,
}

# Max entries per category — prevents bloat
MAX_PER_CATEGORY: dict[str, int] = {
    "personal": 10,
    "role": 5,
    "expertise": 15,
    "preferences": 8,
    "style": 5,
    "interests": 10,
    "goals": 8,
    "topics": 8,
    "context": 5,
}

# Hard limit on total snapshot size (tokens)
MAX_SNAPSHOT_TOKENS = 250


async def decay_memories(factor: float = 0.97):
    """Smart decay: each category decays at its own rate.

    TRIZ #3: personal info is permanent, topics are ephemeral.
    Also enforces per-category limits and removes stale entries.
    """
    _db = await get_db()

    # Phase 1: Category-specific decay
    for category, rate in DECAY_RATES.items():
        effective_rate = rate * factor  # combine with global factor
        if effective_rate < 1.0:
            await _db.execute(
                "UPDATE user_memory SET confidence = confidence * ? WHERE category = ? AND confidence > ?",
                (effective_rate, category, CONFIDENCE_FLOOR.get(category, 0.05)),
            )

    # Phase 2: Remove entries below their category floor
    for category, floor in CONFIDENCE_FLOOR.items():
        await _db.execute(
            "DELETE FROM user_memory WHERE category = ? AND confidence < ?",
            (category, floor),
        )

    # Phase 3: Enforce per-category limits (keep highest confidence)
    for category, max_count in MAX_PER_CATEGORY.items():
        cursor = await _db.execute(
            "SELECT id FROM user_memory WHERE category = ? ORDER BY confidence DESC",
            (category,),
        )
        rows = await cursor.fetchall()
        if len(rows) > max_count:
            excess_ids = [r["id"] for r in rows[max_count:]]
            placeholders = ",".join("?" * len(excess_ids))
            await _db.execute(f"DELETE FROM user_memory WHERE id IN ({placeholders})", excess_ids)

    await _db.commit()


async def get_memory_snapshot() -> str:
    """Build a compact, prioritized snapshot of user memory.

    TRIZ #35: compress representation to fit ~250 tokens.
    Higher-confidence entries go first. Each category limited by importance.
    """
    memories = await get_user_memory()
    if not memories:
        return ""

    CATEGORY_LABELS = {
        "personal": "Пользователь",
        "role": "Роль",
        "expertise": "Экспертиза",
        "preferences": "Предпочтения",
        "style": "Стиль общения",
        "goals": "Цели",
        "interests": "Интересы",
        "context": "Контекст",
        "topics": "Темы",
    }

    CATEGORY_ORDER = ["personal", "role", "expertise", "preferences", "goals", "interests", "style", "context", "topics"]

    # Group by category, sort each group by confidence (highest first)
    sections: dict[str, list[dict]] = {}
    for m in memories:
        sections.setdefault(m["category"], []).append(m)
    for cat in sections:
        sections[cat].sort(key=lambda x: x.get("confidence", 0), reverse=True)

    # Build snapshot with token budget
    parts = []
    total_tokens = 0
    ordered_cats = [c for c in CATEGORY_ORDER if c in sections] + [c for c in sections if c not in CATEGORY_ORDER]

    for cat in ordered_cats:
        items = sections[cat]
        label = CATEGORY_LABELS.get(cat, cat)

        # Budget: personal gets more space, topics get less
        max_items = {"personal": 8, "expertise": 6, "role": 4}.get(cat, 3)
        top = items[:max_items]

        lines = [f"- {m['key']}: {m['value']}" for m in top]
        section_text = f"{label}:\n" + "\n".join(lines)
        section_tokens = len(section_text.split())

        if total_tokens + section_tokens > MAX_SNAPSHOT_TOKENS:
            # Budget exhausted — include partial or skip
            remaining = MAX_SNAPSHOT_TOKENS - total_tokens
            if remaining > 10 and lines:
                # Include at least first item
                parts.append(f"{label}:\n{lines[0]}")
            break

        parts.append(section_text)
        total_tokens += section_tokens

    return "\n\n".join(parts)
