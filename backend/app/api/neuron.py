"""Neuron identity, memory, and proactive agent endpoints."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.db import database as db
from app.providers.registry import get_provider

router = APIRouter()


# ── Helpers ──

async def _get_provider_base_url(provider: str) -> str | None:
    """Look up the custom base_url for a provider from saved settings."""
    return await db.get_provider_base_url(provider)


# ── Neuron Identity ──

@router.get("/api/neuron/identity")
async def get_neuron_identity():
    """Return all three layers of Neuron's identity (debug & future UI)."""
    from app.reasoning.neuron_identity import identity_manager
    return await identity_manager.load_full_identity()


# ── User Memory ──

@router.get("/api/memory")
async def get_memory(category: str | None = None):
    """Get user cognitive profile."""
    return await db.get_user_memory(category)


@router.get("/api/memory/snapshot")
async def get_memory_snapshot():
    """Get compact text snapshot of user memory."""
    snapshot = await db.get_memory_snapshot()
    return {"snapshot": snapshot, "token_estimate": len(snapshot.split())}


@router.get("/api/neuron/knowledge-graph")
async def knowledge_graph():
    """Generate Neuron's knowledge graph about the user — pure DB, no LLM calls."""
    db_conn = await db.get_db()

    # 1. Load all memory entries
    cursor = await db_conn.execute(
        "SELECT category, key, value, confidence FROM user_memory ORDER BY confidence DESC"
    )
    memories = [dict(r) for r in await cursor.fetchall()]

    # 2. Load conversation summaries (last 50)
    cursor = await db_conn.execute(
        "SELECT cs.summary, cs.keywords, c.title FROM conversation_summaries cs "
        "LEFT JOIN conversations c ON cs.conversation_id = c.id "
        "ORDER BY cs.created_at DESC LIMIT 50"
    )
    summaries = [dict(r) for r in await cursor.fetchall()]

    # 3. Build nodes & edges
    nodes: list[dict] = []
    edges: list[dict] = []

    # Central node: the user
    user_name = None
    for m in memories:
        if m["category"] == "personal" and m["key"] == "name":
            user_name = m["value"]
            break

    nodes.append({
        "id": "user",
        "type": "user",
        "title": user_name or "Пользователь",
        "content": "",
    })

    # Filter out low-confidence memories (decay threshold)
    MIN_CONFIDENCE = 0.3
    memories = [m for m in memories if (m["confidence"] or 0.5) >= MIN_CONFIDENCE]

    # Category clusters
    cat_labels = {
        "personal": "Личное",
        "role": "Роль",
        "expertise": "Экспертиза",
        "preferences": "Предпочтения",
        "style": "Стиль",
        "goals": "Цели",
        "interests": "Интересы",
        "context": "Контекст",
        "topics": "Темы",
    }
    categories: dict[str, str] = {}
    for m in memories:
        cat = m["category"]
        if cat not in categories:
            cat_id = f"cat_{cat}"
            nodes.append({
                "id": cat_id,
                "type": "category",
                "title": cat_labels.get(cat, cat),
                "content": "",
                "confidence": 1.0,
            })
            edges.append({"source": "user", "target": cat_id})
            categories[cat] = cat_id

        # Memory item node — confidence controls visibility
        mem_id = f"mem_{cat}_{m['key']}"
        confidence = m["confidence"] or 0.5
        nodes.append({
            "id": mem_id,
            "type": "memory",
            "title": m["key"].replace("_", " "),
            "content": str(m["value"]),
            "confidence": round(confidence, 2),
        })
        edges.append({"source": categories[cat], "target": mem_id})

    # Topic nodes from conversation summaries (recurring themes)
    topic_counts: dict[str, int] = {}
    for s in summaries:
        keywords = (s["keywords"] or "").split(",")
        for kw in keywords:
            kw = kw.strip().lower()
            if kw and len(kw) > 2:
                topic_counts[kw] = topic_counts.get(kw, 0) + 1

    # Only topics that appear 2+ times
    for topic, count in sorted(topic_counts.items(), key=lambda x: -x[1])[:15]:
        if count >= 2:
            topic_id = f"topic_{topic}"
            nodes.append({
                "id": topic_id,
                "type": "topic",
                "title": topic,
                "content": f"Упоминается в {count} беседах",
                "weight": count,
            })
            # Connect topics to relevant memory nodes
            connected = False
            for m in memories:
                if topic in str(m["value"]).lower() or topic in m["key"].lower():
                    mem_id = f"mem_{m['category']}_{m['key']}"
                    edges.append({"source": mem_id, "target": topic_id})
                    connected = True
            if not connected:
                edges.append({"source": "user", "target": topic_id})

    # Cross-connect related expertise items
    expertise_nodes = [n for n in nodes if n["id"].startswith("mem_expertise_")]
    stop_words = {"expert", "intermediate", "beginner", "advanced", "и", "в", "с", "на"}
    for i, a in enumerate(expertise_nodes):
        for b in expertise_nodes[i + 1:]:
            a_words = set(a["title"].lower().split() + a["content"].lower().split()) - stop_words
            b_words = set(b["title"].lower().split() + b["content"].lower().split()) - stop_words
            if a_words & b_words:
                edges.append({"source": a["id"], "target": b["id"], "label": "связано"})

    # Deduplicate edges
    seen: set[str] = set()
    unique_edges: list[dict] = []
    for e in edges:
        key = f"{e['source']}-{e['target']}"
        rev = f"{e['target']}-{e['source']}"
        if key not in seen and rev not in seen:
            seen.add(key)
            unique_edges.append(e)

    return {
        "nodes": nodes,
        "edges": unique_edges,
        "user_name": user_name,
        "memory_count": len(memories),
        "topic_count": len([n for n in nodes if n.get("type") == "topic"]),
    }


@router.delete("/api/memory")
async def clear_memory():
    """Clear all user memory (GDPR-friendly reset)."""
    _db = await db.get_db()
    await _db.execute("DELETE FROM user_memory")
    await _db.commit()
    return {"ok": True}


# ── Proactive Agent ──

@router.get("/api/proactive/check")
async def check_proactive():
    """Check if the proactive agent wants to say something."""
    from app.reasoning.proactive import check_proactive

    api_key = await db.get_provider_key("openrouter")
    if not api_key:
        return {"message": None}

    base_url = await _get_provider_base_url("openrouter")
    provider = get_provider("openrouter", api_key, base_url)

    result = await check_proactive(provider=provider, model="google/gemini-2.0-flash-lite-001")
    return result or {"message": None}


# ── Python Tool ──

class PythonExecRequest(BaseModel):
    code: str = Field(max_length=10000)

@router.post("/api/tools/python")
async def run_python(req: PythonExecRequest):
    """Execute Python code in sandbox. Returns output + images."""
    from app.tools.python_sandbox import execute_python
    result = execute_python(req.code)
    return result
