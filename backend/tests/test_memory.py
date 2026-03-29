"""Tests for cognitive memory signal extraction."""

from __future__ import annotations

import pytest

from app.providers.base import LLMMessage
from app.reasoning.memory import (
    extract_expertise_signals,
    extract_style_signals,
    extract_personal_signals,
    extract_topic_signals,
    extract_context_signals,
)


def _msgs(*texts: str) -> list[LLMMessage]:
    """Helper to create user messages."""
    return [LLMMessage(role="user", content=t) for t in texts]


# ── extract_expertise_signals ──


class TestExtractExpertiseSignals:
    def test_python_keywords_detected(self):
        msgs = _msgs(
            "I use python with fastapi and pydantic for my backend. "
            "Also pytest for testing and asyncio for async operations."
        )
        signals = extract_expertise_signals(msgs)
        assert "python" in signals
        assert signals["python"] in ("intermediate", "advanced")

    def test_ml_keywords_detected(self):
        msgs = _msgs(
            "Training the transformer model on a large dataset. "
            "Using pytorch with gpu for fine-tune the neural network. "
            "The embedding layer needs optimization."
        )
        signals = extract_expertise_signals(msgs)
        assert "ml" in signals

    def test_empty_messages_return_empty(self):
        signals = extract_expertise_signals([])
        assert signals == {}

    def test_short_text_returns_empty(self):
        msgs = _msgs("hi there")
        signals = extract_expertise_signals(msgs)
        assert signals == {}

    def test_devops_keywords_detected(self):
        msgs = _msgs(
            "Deploy to kubernetes cluster using docker containers. "
            "Nginx as reverse proxy. CI/CD pipeline with terraform and AWS."
        )
        signals = extract_expertise_signals(msgs)
        assert "devops" in signals

    def test_database_keywords_detected(self):
        msgs = _msgs(
            "The SQL query on postgres is slow. Need to add an index. "
            "Also migrate the schema and update the ORM models. Redis for cache."
        )
        signals = extract_expertise_signals(msgs)
        assert "database" in signals


# ── extract_style_signals ──


class TestExtractStyleSignals:
    def test_terse_style_detected(self):
        msgs = _msgs("fix this", "show code", "run it", "next step", "ok done")
        signals = extract_style_signals(msgs)
        assert signals.get("verbosity") == "terse"

    def test_detailed_style_detected(self):
        """Verbosity='detailed' triggers at avg > 50 words per message."""
        long_text = (
            "Could you please explain in great detail how the garbage collector works "
            "in Python, including the generational approach, reference counting mechanism, "
            "and how circular references are detected and collected? I would also appreciate "
            "a comparison with Java's garbage collection strategies and how they differ "
            "from Python's approach in terms of performance, memory overhead, and latency "
            "implications for real-time systems and high-throughput applications."
        )
        msgs = _msgs(long_text)
        signals = extract_style_signals(msgs)
        assert signals.get("verbosity") == "detailed"

    def test_code_in_messages_detected(self):
        msgs = _msgs(
            "Here is my code:\n```python\ndef foo(): pass\n```",
            "Another snippet:\n```\nconst x = 1\n```",
            "And this: def bar(): return 42",
        )
        signals = extract_style_signals(msgs)
        assert signals.get("includes_code") == "often"

    def test_empty_messages_return_empty(self):
        signals = extract_style_signals([])
        assert signals == {}

    def test_russian_language_detected(self):
        msgs = _msgs("Привет, расскажи как работает Python", "Спасибо за объяснение")
        signals = extract_style_signals(msgs)
        assert signals.get("language") == "Russian"

    def test_english_language_detected(self):
        msgs = _msgs("Hello, explain how Python works", "Thanks for the explanation")
        signals = extract_style_signals(msgs)
        assert signals.get("language") == "English"

    def test_interrogative_style_detected(self):
        msgs = _msgs("How does this work?", "Why is it slow?", "What should I use?")
        signals = extract_style_signals(msgs)
        assert signals.get("question_style") == "interrogative"


# ── extract_personal_signals ──


class TestExtractPersonalSignals:
    def test_russian_name_extracted(self):
        msgs = _msgs("Привет! Меня зовут Максим, помоги с проектом")
        signals = extract_personal_signals(msgs)
        assert signals.get("name") == "Максим"

    def test_english_name_extracted(self):
        msgs = _msgs("My name is John, I need help with React")
        signals = extract_personal_signals(msgs)
        # The regex captures "Firstname Lastname" pattern; "John" should be in the result
        assert "name" in signals
        assert "John" in signals["name"]

    def test_company_extracted(self):
        msgs = _msgs("Я работаю в Яндексе, нужна помощь с сервисом")
        signals = extract_personal_signals(msgs)
        assert "company" in signals
        assert "Яндекс" in signals["company"]

    def test_no_personal_info_returns_empty(self):
        msgs = _msgs("Как работает фотосинтез?")
        signals = extract_personal_signals(msgs)
        assert "name" not in signals
        assert "company" not in signals

    def test_role_extracted(self):
        msgs = _msgs("Я работаю как backend разработчик, нужна помощь с API")
        signals = extract_personal_signals(msgs)
        assert "role" in signals

    def test_empty_messages_return_empty(self):
        signals = extract_personal_signals([])
        assert signals == {}


# ── extract_topic_signals ──


class TestExtractTopicSignals:
    def test_repeated_topics_extracted(self):
        msgs = _msgs(
            "machine learning model",
            "train the machine learning model",
            "fine tune the machine learning algorithm",
        )
        topics = extract_topic_signals(msgs)
        assert any("machine" in t and "learning" in t for t in topics)

    def test_short_text_returns_empty_or_few(self):
        msgs = _msgs("hi")
        topics = extract_topic_signals(msgs)
        assert len(topics) <= 5

    def test_max_five_topics(self):
        msgs = _msgs(" ".join(f"topic{i} data{i}" * 5 for i in range(20)))
        topics = extract_topic_signals(msgs)
        assert len(topics) <= 5


# ── extract_context_signals ──


class TestExtractContextSignals:
    def test_urgency_detected(self):
        msgs = _msgs("Срочно нужно исправить баг в продакшене!")
        signals = extract_context_signals(msgs)
        assert signals.get("urgency") == "high"

    def test_no_urgency_when_absent(self):
        msgs = _msgs("Расскажи про алгоритмы сортировки")
        signals = extract_context_signals(msgs)
        assert "urgency" not in signals
