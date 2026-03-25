"""WebSocket endpoint for Predictive Reasoning (prefill while user types)."""

from __future__ import annotations

import asyncio
import json
import logging
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.db import database as db
from app.providers.base import LLMMessage, LLMRequest
from app.providers.registry import get_provider
from app.reasoning.engine import ReasoningEngine, ReasoningStrategy, COT_SYSTEM_PROMPT
from app.reasoning.prefill_cache import (
    PREFILL_TIMEOUT,
    SIMILARITY_THRESHOLD,
    PrefillCache,
    PrefillEntry,
    compare_queries,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# Single global cache shared across all connections
prefill_cache = PrefillCache()


# ── Helpers ──

async def _resolve_provider(provider_name: str, base_url: str | None = None):
    """Resolve an LLM provider by name, reading key from DB."""
    api_key = await db.get_provider_key(provider_name)
    if not api_key:
        return None
    if base_url is None:
        all_settings = await db.get_provider_settings()
        for s in all_settings:
            if s["provider"] == provider_name and s.get("base_url"):
                base_url = s["base_url"]
                break
    return get_provider(provider_name, api_key, base_url)


async def _send_json(ws: WebSocket, event: str, data: dict | None = None) -> None:
    """Send a typed JSON message over the WebSocket."""
    payload: dict = {"type": event}
    if data is not None:
        payload["data"] = data
    try:
        await ws.send_text(json.dumps(payload, ensure_ascii=False))
    except Exception:
        pass  # connection already closed


async def _run_prefill(
    entry: PrefillEntry,
    engine: ReasoningEngine,
    messages: list[LLMMessage],
    ws: WebSocket,
) -> None:
    """Background task: detect domain, classify complexity, run draft CoT.

    Results are written into *entry* in-place so the final_query handler
    can consume them.
    """
    try:
        # Step 1 — domain + complexity in parallel
        domain_coro = engine._detect_domain(messages)
        complexity_coro = engine._classify_complexity(messages)
        domain, strategy = await asyncio.gather(domain_coro, complexity_coro)

        entry.domain = domain
        entry.strategy = strategy

        await _send_json(ws, "prefill_started", {
            "domain": domain,
            "strategy": strategy.value,
        })

        # Step 2 — skip draft CoT to save LLM calls
        # Domain + strategy classification is enough for prefill speedup

        await _send_json(ws, "prefill_ready", {
            "domain": entry.domain,
            "strategy": entry.strategy.value if entry.strategy else None,
            "has_draft": entry.draft_reasoning is not None,
        })

    except asyncio.CancelledError:
        logger.debug("Prefill cancelled for session %s", entry.session_id)
        raise
    except Exception as exc:
        entry.error = str(exc)
        logger.warning("Prefill failed for session %s: %s", entry.session_id, exc)
        await _send_json(ws, "error", {"message": f"Prefill error: {exc}"})


# ── WebSocket endpoint ──

@router.websocket("/api/chat/ws/{session_id}")
async def predictive_reasoning_ws(ws: WebSocket, session_id: str):
    await ws.accept()
    logger.info("WS connected: session=%s", session_id)

    # Connection-scoped state
    provider_name: str = "openrouter"
    model: str = "openai/gpt-4o-mini"

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await _send_json(ws, "error", {"message": "Invalid JSON"})
                continue

            msg_type = msg.get("type")

            # ── partial_query ──
            if msg_type == "partial_query":
                content = (msg.get("content") or "").strip()
                if not content:
                    continue

                # Update provider/model if supplied
                provider_name = msg.get("provider", provider_name)
                model = msg.get("model", model)

                # Cancel previous prefill for this session
                prefill_cache.cancel(session_id)

                provider = await _resolve_provider(provider_name)
                if provider is None:
                    await _send_json(ws, "error", {"message": f"No API key for {provider_name}"})
                    continue

                engine = ReasoningEngine(provider, model)
                messages = [LLMMessage(role="user", content=content)]

                entry = PrefillEntry(session_id=session_id, partial_query=content)
                prefill_cache.put(entry)

                async def _prefill_with_timeout(e=entry, eng=engine, m=messages, w=ws):
                    try:
                        await asyncio.wait_for(
                            _run_prefill(e, eng, m, w),
                            timeout=PREFILL_TIMEOUT,
                        )
                    except asyncio.TimeoutError:
                        e.error = "timeout"
                        logger.warning("Prefill timed out for session %s", e.session_id)
                        await _send_json(w, "error", {"message": "Prefill timed out"})
                    except asyncio.CancelledError:
                        pass

                entry.task = asyncio.create_task(_prefill_with_timeout())

            # ── final_query ──
            elif msg_type == "final_query":
                content = (msg.get("content") or "").strip()
                if not content:
                    continue

                entry = prefill_cache.get(session_id)

                if entry is not None:
                    # Wait for the prefill task to finish (up to remaining timeout)
                    if entry.task is not None and not entry.task.done():
                        elapsed = time.monotonic() - entry.created_at
                        remaining = max(0.0, PREFILL_TIMEOUT - elapsed)
                        try:
                            await asyncio.wait_for(
                                asyncio.shield(entry.task),
                                timeout=remaining,
                            )
                        except (asyncio.TimeoutError, asyncio.CancelledError):
                            pass

                    # Check similarity
                    sim = compare_queries(entry.partial_query, content)
                    if sim >= SIMILARITY_THRESHOLD and entry.error is None:
                        # Prefill is usable
                        await _send_json(ws, "done", {
                            "reused": True,
                            "similarity": round(sim, 3),
                            "domain": entry.domain,
                            "strategy": entry.strategy.value if entry.strategy else None,
                            "has_draft": entry.draft_reasoning is not None,
                        })
                    else:
                        # Query changed too much — discard prefill
                        prefill_cache.cancel(session_id)
                        await _send_json(ws, "done", {
                            "reused": False,
                            "similarity": round(sim, 3),
                            "reason": "query_diverged" if sim < SIMILARITY_THRESHOLD else "prefill_error",
                        })
                else:
                    # No prefill available
                    await _send_json(ws, "done", {"reused": False, "reason": "no_prefill"})

                # Clean up
                prefill_cache.remove(session_id)

            # ── cancel ──
            elif msg_type == "cancel":
                prefill_cache.cancel(session_id)
                prefill_cache.remove(session_id)
                await _send_json(ws, "done", {"cancelled": True})

            else:
                await _send_json(ws, "error", {"message": f"Unknown type: {msg_type}"})

    except WebSocketDisconnect:
        logger.info("WS disconnected: session=%s", session_id)
    except Exception as exc:
        logger.exception("WS error: session=%s", session_id)
        try:
            await _send_json(ws, "error", {"message": str(exc)})
            await ws.close(code=1011)
        except Exception:
            pass
    finally:
        # Cleanup on disconnect
        prefill_cache.cancel(session_id)
        prefill_cache.remove(session_id)
