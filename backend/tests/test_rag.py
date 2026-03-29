"""Tests for RAG vector index and tokenization."""

from __future__ import annotations

import pytest

from app.reasoning.rag import SimpleVectorIndex


@pytest.fixture
def index():
    return SimpleVectorIndex()


class TestTokenize:
    def test_filters_short_words(self, index):
        tokens = index._tokenize("я и он тест для python asyncio")
        assert "я" not in tokens
        assert "он" not in tokens
        assert "python" in tokens
        assert "asyncio" in tokens

    def test_filters_stop_words(self, index):
        tokens = index._tokenize("это только можно тест также проверки очень важных слов")
        assert "это" not in tokens
        assert "только" not in tokens
        assert "также" not in tokens
        assert "очень" not in tokens
        assert "тест" in tokens

    def test_empty_string(self, index):
        assert index._tokenize("") == []

    def test_english_stop_words(self, index):
        tokens = index._tokenize("the quick brown fox uses python framework")
        assert "the" not in tokens
        assert "python" in tokens

    def test_meaningful_words_kept(self, index):
        tokens = index._tokenize("микросервисы JWT авторизация kubernetes")
        assert "микросервисы" in tokens
        assert "jwt" in tokens
        assert "авторизация" in tokens
        assert "kubernetes" in tokens


class TestVectorIndex:
    def test_add_and_search(self, index):
        index.add_document("1", "Python asyncio FastAPI микросервисы", {"conversation_id": "c1"})
        index.add_document("2", "React компоненты TypeScript фронтенд", {"conversation_id": "c2"})
        index.add_document("3", "PostgreSQL индексы база данных миграция", {"conversation_id": "c3"})

        results = index.search("FastAPI бэкенд Python")
        assert len(results) > 0
        assert results[0]["conversation_id"] == "c1"

    def test_exclude_conversation(self, index):
        index.add_document("1", "Python asyncio FastAPI", {"conversation_id": "c1"})
        index.add_document("2", "Python Django REST API", {"conversation_id": "c2"})

        results = index.search("Python API", exclude_conv_id="c1")
        assert all(r["conversation_id"] != "c1" for r in results)

    def test_empty_index(self, index):
        results = index.search("anything")
        assert results == []

    def test_irrelevant_query(self, index):
        index.add_document("1", "Python asyncio FastAPI", {"conversation_id": "c1"})
        results = index.search("абракадабра несуществующее слово")
        assert len(results) == 0

    def test_top_k_limit(self, index):
        for i in range(10):
            index.add_document(str(i), f"Python тема номер {i} разработка", {"conversation_id": f"c{i}"})
        results = index.search("Python разработка", top_k=3)
        assert len(results) <= 3
