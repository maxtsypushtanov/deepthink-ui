"""Predictive Reasoning — PrefillCache and query similarity."""

from __future__ import annotations

import asyncio
import logging
import time
from collections import OrderedDict
from dataclasses import dataclass, field

from app.reasoning.engine import ReasoningStrategy

logger = logging.getLogger(__name__)

MAX_CACHE_SIZE = 100
SIMILARITY_THRESHOLD = 0.7
PREFILL_TIMEOUT = 10.0


def compare_queries(a: str, b: str) -> float:
    """Jaccard similarity over word-level tokens (case-insensitive)."""
    words_a = set(a.lower().split())
    words_b = set(b.lower().split())
    if not words_a and not words_b:
        return 1.0
    if not words_a or not words_b:
        return 0.0
    intersection = words_a & words_b
    union = words_a | words_b
    return len(intersection) / len(union)


@dataclass
class PrefillEntry:
    """Cached result of predictive reasoning for a partial query."""

    session_id: str
    partial_query: str
    domain: str | None = None
    strategy: ReasoningStrategy | None = None
    draft_reasoning: str | None = None
    task: asyncio.Task | None = field(default=None, repr=False)
    created_at: float = field(default_factory=time.monotonic)
    error: str | None = None


class PrefillCache:
    """LRU cache of predictive reasoning results keyed by session_id.

    Thread-safety: all access happens on the asyncio event loop,
    so a plain OrderedDict is sufficient (no locks needed).
    """

    def __init__(self, max_size: int = MAX_CACHE_SIZE) -> None:
        self._store: OrderedDict[str, PrefillEntry] = OrderedDict()
        self._max_size = max_size

    # ── Public API ──

    def get(self, session_id: str) -> PrefillEntry | None:
        entry = self._store.get(session_id)
        if entry is not None:
            self._store.move_to_end(session_id)
        return entry

    def put(self, entry: PrefillEntry) -> None:
        sid = entry.session_id
        # Cancel old task if replacing
        old = self._store.get(sid)
        if old is not None and old.task is not None and not old.task.done():
            old.task.cancel()
        self._store[sid] = entry
        self._store.move_to_end(sid)
        self._evict()

    def remove(self, session_id: str) -> PrefillEntry | None:
        entry = self._store.pop(session_id, None)
        if entry is not None and entry.task is not None and not entry.task.done():
            entry.task.cancel()
        return entry

    def cancel(self, session_id: str) -> None:
        """Cancel any running prefill task for a session without removing the entry."""
        entry = self._store.get(session_id)
        if entry is not None and entry.task is not None and not entry.task.done():
            entry.task.cancel()
            logger.debug("Cancelled prefill task for session %s", session_id)

    @property
    def size(self) -> int:
        return len(self._store)

    # ── Internal ──

    def _evict(self) -> None:
        while len(self._store) > self._max_size:
            _, evicted = self._store.popitem(last=False)
            if evicted.task is not None and not evicted.task.done():
                evicted.task.cancel()
            logger.debug("Evicted prefill entry for session %s", evicted.session_id)
