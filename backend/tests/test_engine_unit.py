"""Unit tests for the ReasoningEngine — strategy selection, heuristics, edge cases.

Tests the engine WITHOUT real LLM calls by mocking the provider.
"""

from __future__ import annotations

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from dataclasses import dataclass

from app.reasoning.engine import (
    ReasoningEngine,
    ReasoningStrategy,
    SessionContext,
    VALID_DOMAINS,
)
from app.providers.base import LLMMessage, LLMRequest, LLMResponse, LLMChunk


# ── Helpers ──

def make_provider(complete_content: str = "general", stream_chunks: list[str] | None = None):
    """Create a mock LLM provider."""
    provider = AsyncMock()
    provider.complete = AsyncMock(return_value=LLMResponse(content=complete_content))
    if stream_chunks is None:
        stream_chunks = ["Hello", " world"]

    async def fake_stream(req):
        for c in stream_chunks:
            yield LLMChunk(content=c)

    provider.stream = fake_stream
    return provider


def engine(complete_content="general", stream_chunks=None):
    provider = make_provider(complete_content, stream_chunks)
    return ReasoningEngine(provider=provider, model="test-model"), provider


async def collect_events(gen) -> list[dict]:
    events = []
    async for ev in gen:
        events.append(ev)
    return events


# ── 1. Heuristic Complexity Scoring ──

class TestHeuristicComplexity:
    def test_short_question_score_1(self):
        score, hints = ReasoningEngine._heuristic_complexity("Привет")
        assert score == 1
        assert not hints

    def test_medium_question_score_2(self):
        """Fixed: 6-word Russian question now correctly scores 2 (threshold lowered to < 8)."""
        score, _ = ReasoningEngine._heuristic_complexity("Как работает фотосинтез у растений?")
        assert score == 2

    def test_long_multi_question_score_3(self):
        """Fixed: Multi-question with 3+ question marks now correctly scores >= 3."""
        msg = "Объясни как работает фотосинтез? Какие стадии есть? Как это связано с дыханием? " * 3
        score, _ = ReasoningEngine._heuristic_complexity(msg)
        assert score >= 3

    def test_code_bumps_to_4(self):
        msg = "Исправь этот код:\n```python\ndef foo():\n  pass\n```\nОн не работает"
        score, _ = ReasoningEngine._heuristic_complexity(msg)
        assert score >= 4

    def test_triz_keyword_detected(self):
        _, hints = ReasoningEngine._heuristic_complexity("Как решить противоречие между скоростью и надёжностью?")
        assert "triz" in hints

    def test_compare_keyword_detected(self):
        _, hints = ReasoningEngine._heuristic_complexity("Сравни React и Vue для большого проекта")
        assert "best_of_n" in hints

    def test_debug_keyword_detected(self):
        """Fixed: 'отладить' now matches via regex stem 'отлад'."""
        _, hints = ReasoningEngine._heuristic_complexity("Помоги отладить эту функцию, она падает")
        assert "rubber_duck" in hints

    def test_experts_keyword_detected(self):
        _, hints = ReasoningEngine._heuristic_complexity("Какие мнения экспертов по поводу ИИ в медицине?")
        assert "persona_council" in hints

    def test_why_keyword_detected(self):
        _, hints = ReasoningEngine._heuristic_complexity("Почему небо голубое?")
        assert "socratic" in hints

    def test_empty_message_score_1(self):
        score, hints = ReasoningEngine._heuristic_complexity("")
        assert score == 1
        assert not hints

    def test_prove_keyword_bumps_score(self):
        msg = "Докажи что сумма углов треугольника равна 180 градусов"
        _, hints = ReasoningEngine._heuristic_complexity(msg)
        assert "tree_of_thoughts" in hints


# ── 2. Strategy Classification (with mocked LLM) ──

class TestClassifyComplexity:
    @pytest.mark.asyncio
    async def test_simple_returns_none(self):
        eng_inst, _ = engine()
        msgs = [LLMMessage(role="user", content="Привет")]
        result = await eng_inst._classify_complexity(msgs)
        assert result == ReasoningStrategy.NONE

    @pytest.mark.asyncio
    async def test_medium_returns_none(self):
        """8-word question scores 2, correctly classified as NONE (simple enough)."""
        eng_inst, _ = engine()
        msgs = [LLMMessage(role="user", content="Как работает фотосинтез у растений в тропических лесах?")]
        result = await eng_inst._classify_complexity(msgs)
        assert result == ReasoningStrategy.NONE

    @pytest.mark.asyncio
    async def test_complex_uses_llm(self):
        eng_inst, prov = engine(complete_content="persona_council")
        msg = "Вот мой код:\n```python\ndef a():\n  pass\n```\n```python\ndef b():\n  pass\n```\nПочему не работает?"
        msgs = [LLMMessage(role="user", content=msg)]
        result = await eng_inst._classify_complexity(msgs)
        assert result == ReasoningStrategy.PERSONA_COUNCIL

    @pytest.mark.asyncio
    async def test_triz_via_keyword_hint(self):
        eng_inst, _ = engine(complete_content="triz")
        msg = "Нужен ТРИЗ-анализ: как уменьшить вес конструкции не теряя прочности?\n```\nstruct A {}\n```\n```\nstruct B {}\n```"
        msgs = [LLMMessage(role="user", content=msg)]
        result = await eng_inst._classify_complexity(msgs)
        assert result == ReasoningStrategy.TRIZ

    @pytest.mark.asyncio
    async def test_llm_failure_fallback(self):
        eng_inst, prov = engine()
        prov.complete = AsyncMock(side_effect=Exception("LLM down"))
        msg = "Вот мой код:\n```python\ndef a():\n  pass\n```\n```python\ndef b():\n  pass\n```\nОбъясни"
        msgs = [LLMMessage(role="user", content=msg)]
        result = await eng_inst._classify_complexity(msgs)
        assert result in (ReasoningStrategy.BUDGET_FORCING, ReasoningStrategy.TREE_OF_THOUGHTS)

    @pytest.mark.asyncio
    async def test_empty_messages_no_crash(self):
        eng_inst, _ = engine()
        result = await eng_inst._classify_complexity([])
        assert result == ReasoningStrategy.NONE


# ── 3. Domain Detection ──

class TestDomainDetection:
    @pytest.mark.asyncio
    async def test_valid_domain_returned(self):
        eng_inst, _ = engine(complete_content="software_engineering")
        msgs = [LLMMessage(role="user", content="Напиши функцию сортировки")]
        domain = await eng_inst._detect_domain(msgs)
        assert domain == "software_engineering"

    @pytest.mark.asyncio
    async def test_unknown_domain_fallback_general(self):
        eng_inst, _ = engine(complete_content="cooking")
        msgs = [LLMMessage(role="user", content="Как приготовить борщ")]
        domain = await eng_inst._detect_domain(msgs)
        assert domain == "general"

    @pytest.mark.asyncio
    async def test_llm_failure_returns_general(self):
        eng_inst, prov = engine()
        prov.complete = AsyncMock(side_effect=Exception("timeout"))
        msgs = [LLMMessage(role="user", content="anything")]
        domain = await eng_inst._detect_domain(msgs)
        assert domain == "general"

    @pytest.mark.asyncio
    async def test_empty_messages(self):
        eng_inst, _ = engine(complete_content="general")
        domain = await eng_inst._detect_domain([])
        assert domain == "general"


# ── 4. Full run() Pipeline ──

class TestRunPipeline:
    @pytest.mark.asyncio
    async def test_auto_strategy_yields_events(self):
        eng_inst, _ = engine(complete_content="general", stream_chunks=["Ответ"])
        msgs = [LLMMessage(role="user", content="Привет")]
        events = await collect_events(eng_inst.run(msgs, strategy=ReasoningStrategy.AUTO))

        event_types = [e["event"] for e in events]
        assert "strategy_selected" in event_types
        assert "thinking_start" in event_types
        assert "content_delta" in event_types
        assert "thinking_end" in event_types

    @pytest.mark.asyncio
    async def test_none_strategy_passthrough(self):
        eng_inst, _ = engine(stream_chunks=["Прямой", " ответ"])
        msgs = [LLMMessage(role="user", content="2+2")]
        events = await collect_events(eng_inst.run(msgs, strategy=ReasoningStrategy.NONE))

        content_events = [e for e in events if e["event"] == "content_delta"]
        assert len(content_events) == 2
        assert content_events[0]["data"]["content"] == "Прямой"

    @pytest.mark.asyncio
    async def test_cot_strategy_buffers_and_streams(self):
        response = "<thinking>Анализ задачи</thinking>Финальный ответ"
        eng_inst, _ = engine(stream_chunks=[response])
        msgs = [LLMMessage(role="user", content="тест")]
        events = await collect_events(eng_inst.run(msgs, strategy=ReasoningStrategy.COT))

        event_types = [e["event"] for e in events]
        assert "thinking_step" in event_types
        assert "content_delta" in event_types

    @pytest.mark.asyncio
    async def test_prefill_domain_and_strategy_skips_classification(self):
        eng_inst, prov = engine(stream_chunks=["Ok"])
        msgs = [LLMMessage(role="user", content="тест")]
        events = await collect_events(eng_inst.run(
            msgs,
            strategy=ReasoningStrategy.AUTO,
            pre_domain="mathematics",
            pre_strategy="cot",
        ))

        # LLM complete should NOT be called for classification (only for ambiguity if called)
        strategy_ev = next(e for e in events if e["event"] == "strategy_selected")
        assert strategy_ev["data"]["strategy"] == "cot"
        assert strategy_ev["data"]["domain"] == "mathematics"

    @pytest.mark.asyncio
    async def test_messages_not_mutated(self):
        eng_inst, _ = engine(stream_chunks=["Ok"])
        original = [LLMMessage(role="user", content="тест")]
        original_copy = list(original)
        await collect_events(eng_inst.run(original, strategy=ReasoningStrategy.NONE))
        assert len(original) == len(original_copy)

    @pytest.mark.asyncio
    async def test_session_context_updated(self):
        eng_inst, _ = engine(complete_content="software_engineering", stream_chunks=["Ok"])
        ctx = SessionContext()
        msgs = [LLMMessage(role="user", content="тест")]
        await collect_events(eng_inst.run(msgs, strategy=ReasoningStrategy.NONE, session_context=ctx))
        assert len(ctx.user_expertise_signals) > 0


# ── 5. SessionContext ──

class TestSessionContext:
    def test_initial_state(self):
        ctx = SessionContext()
        assert ctx.dominant_domain == "general"
        assert ctx.conversation_turn == 0

    def test_update_tracks_domain(self):
        ctx = SessionContext()
        ctx.update("mathematics")
        ctx.update("mathematics")
        ctx.update("science")
        assert ctx.dominant_domain == "mathematics"

    def test_needs_retune_interval(self):
        ctx = SessionContext()
        assert not ctx.needs_retune()
        ctx.conversation_turn = 2
        assert ctx.needs_retune()

    def test_detected_domains_grow(self):
        ctx = SessionContext()
        for i in range(50):
            ctx.update("general")
        assert len(ctx.detected_domains) == 50  # BUG: unbounded growth


# ── 6. Ambiguity Detection ──

class TestAmbiguityDetection:
    @pytest.mark.asyncio
    async def test_short_message_not_ambiguous(self):
        eng_inst, _ = engine()
        msgs = [LLMMessage(role="user", content="Привет")]
        is_amb, _ = await eng_inst._check_ambiguity(msgs)
        assert not is_amb

    @pytest.mark.asyncio
    async def test_with_history_short_not_ambiguous(self):
        eng_inst, _ = engine()
        msgs = [
            LLMMessage(role="user", content="Расскажи про Python"),
            LLMMessage(role="assistant", content="Python - язык программирования"),
            LLMMessage(role="user", content="А как с этим?"),
        ]
        is_amb, _ = await eng_inst._check_ambiguity(msgs)
        assert not is_amb  # word_count < 20 with history = skip

    @pytest.mark.asyncio
    async def test_empty_messages_not_ambiguous(self):
        eng_inst, _ = engine()
        is_amb, _ = await eng_inst._check_ambiguity([])
        assert not is_amb


# ── 7. Prefill Cache ──

from app.reasoning.prefill_cache import PrefillCache, PrefillEntry, compare_queries


class TestCompareQueries:
    def test_identical_queries(self):
        assert compare_queries("hello world", "hello world") == 1.0

    def test_completely_different(self):
        assert compare_queries("hello world", "foo bar") == 0.0

    def test_partial_overlap(self):
        sim = compare_queries("how to write python code", "how to write java code")
        assert 0.5 < sim < 1.0  # 4/5 words match

    def test_empty_both(self):
        assert compare_queries("", "") == 1.0

    def test_empty_one(self):
        assert compare_queries("hello", "") == 0.0
        assert compare_queries("", "hello") == 0.0

    def test_case_insensitive(self):
        assert compare_queries("Hello World", "hello world") == 1.0

    def test_single_word_identical(self):
        assert compare_queries("python", "python") == 1.0

    def test_single_word_different(self):
        assert compare_queries("python", "java") == 0.0


class TestPrefillCache:
    def test_put_get(self):
        cache = PrefillCache(max_size=5)
        entry = PrefillEntry(session_id="s1", partial_query="test")
        cache.put(entry)
        assert cache.get("s1") is entry

    def test_get_nonexistent(self):
        cache = PrefillCache()
        assert cache.get("nonexistent") is None

    def test_remove(self):
        cache = PrefillCache()
        entry = PrefillEntry(session_id="s1", partial_query="test")
        cache.put(entry)
        removed = cache.remove("s1")
        assert removed is entry
        assert cache.get("s1") is None

    def test_eviction(self):
        cache = PrefillCache(max_size=3)
        for i in range(5):
            cache.put(PrefillEntry(session_id=f"s{i}", partial_query=f"q{i}"))
        assert cache.size == 3
        assert cache.get("s0") is None
        assert cache.get("s1") is None
        assert cache.get("s4") is not None

    def test_lru_order(self):
        cache = PrefillCache(max_size=3)
        for i in range(3):
            cache.put(PrefillEntry(session_id=f"s{i}", partial_query=f"q{i}"))
        cache.get("s0")  # Access s0 to make it recently used
        cache.put(PrefillEntry(session_id="s3", partial_query="q3"))
        assert cache.get("s0") is not None  # s0 should survive
        assert cache.get("s1") is None  # s1 should be evicted


# ── 8. Chunker ──

from app.files.chunker import chunk_text, search_chunks, should_chunk


class TestChunker:
    def test_short_text_single_chunk(self):
        chunks = chunk_text("Hello world", chunk_size=100, overlap=20)
        assert len(chunks) == 1
        assert chunks[0]["text"] == "Hello world"

    def test_chunking_produces_overlapping_chunks(self):
        text = "A" * 100
        chunks = chunk_text(text, chunk_size=30, overlap=10)
        assert len(chunks) > 1
        # Check overlap exists
        for i in range(len(chunks) - 1):
            end1 = chunks[i]["end"]
            start2 = chunks[i + 1]["start"]
            assert start2 < end1  # Overlap

    def test_empty_text(self):
        chunks = chunk_text("", chunk_size=100, overlap=10)
        assert chunks == []

    def test_whitespace_only_text(self):
        """Regression: whitespace-only text should not cause O(n²) loop."""
        text = " " * 500
        chunks = chunk_text(text, chunk_size=100, overlap=10)
        assert chunks == []  # All whitespace, nothing to chunk

    def test_should_chunk_threshold(self):
        assert not should_chunk(1000)
        assert should_chunk(100_001)

    def test_search_chunks_keyword_match(self):
        chunks = [
            {"index": 0, "text": "Python is a programming language", "start": 0, "end": 30},
            {"index": 1, "text": "Java is used for enterprise", "start": 30, "end": 60},
            {"index": 2, "text": "Python frameworks include Django", "start": 60, "end": 90},
        ]
        results = search_chunks(chunks, "Python Django", top_k=2)
        assert len(results) == 2
        assert "Python" in results[0]["text"]

    def test_search_chunks_empty_query(self):
        chunks = [{"index": 0, "text": "Hello", "start": 0, "end": 5}]
        results = search_chunks(chunks, "", top_k=5)
        assert len(results) == 1


# ── 9. Python Sandbox ──

from app.tools.python_sandbox import should_use_python

try:
    import pandas  # noqa: F401
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False

if HAS_PANDAS:
    from app.tools.python_sandbox import execute_python


@pytest.mark.skipif(not HAS_PANDAS, reason="pandas not installed")
class TestPythonSandbox:
    def test_simple_print(self):
        result = execute_python("print(2 + 2)")
        assert result["success"] is True
        assert "4" in result["output"]

    def test_pandas_available(self):
        result = execute_python("import pandas as pd\nprint(pd.DataFrame({'a': [1,2,3]}).shape)")
        assert result["success"] is True
        assert "(3, 1)" in result["output"]

    def test_numpy_available(self):
        result = execute_python("import numpy as np\nprint(np.array([1,2,3]).sum())")
        assert result["success"] is True
        assert "6" in result["output"]

    def test_blocked_import_os(self):
        result = execute_python("import os\nos.system('echo hacked')")
        assert result["success"] is False
        assert "недоступен" in result["error"] or "not allowed" in result["error"].lower() or "Import" in result["error"]

    def test_blocked_import_subprocess(self):
        result = execute_python("import subprocess\nsubprocess.run(['ls'])")
        assert result["success"] is False

    def test_blocked_open(self):
        result = execute_python("f = open('/etc/passwd')")
        assert result["success"] is False

    def test_result_variable(self):
        result = execute_python("result = 42")
        assert result["success"] is True
        assert "42" in result["output"]

    def test_output_truncated(self):
        result = execute_python("print('x' * 20000)")
        assert result["success"] is True
        assert len(result["output"]) <= 8000

    def test_syntax_error(self):
        result = execute_python("def foo(:\n  pass")
        assert result["success"] is False

    def test_runtime_error(self):
        result = execute_python("print(1/0)")
        assert result["success"] is False
        assert "ZeroDivision" in result["error"]


class TestShouldUsePython:
    def test_calculation_detected(self):
        assert should_use_python("Посчитай среднее значение списка")

    def test_chart_detected(self):
        assert should_use_python("Построй график зависимости x от y")

    def test_table_detected(self):
        assert should_use_python("Создай таблицу с данными")

    def test_regular_question_not_detected(self):
        assert not should_use_python("Что такое машинное обучение?")

    def test_math_detected(self):
        assert should_use_python("Найди факториал числа 20")
