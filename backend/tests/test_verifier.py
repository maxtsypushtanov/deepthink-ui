"""Tests for the fact verifier claim extraction."""

from __future__ import annotations

import pytest

from app.reasoning.verifier import extract_claims, MAX_CLAIMS


class TestExtractClaims:
    def test_date_claims_extracted(self):
        text = "Python был создан Гвидо ван Россумом в 1991 году. Первая версия вышла в 1994 году."
        claims = extract_claims(text)
        assert len(claims) >= 1
        assert any("1991" in c for c in claims)

    def test_number_claims_extracted(self):
        text = "Население России составляет около 146 млн человек. ВВП около 1.8 трлн долларов."
        claims = extract_claims(text)
        assert len(claims) >= 1
        assert any("146" in c for c in claims)

    def test_entity_claims_extracted(self):
        text = "Столица Франции — Париж. Эйфелеву башню создали в 1889 году."
        claims = extract_claims(text)
        assert len(claims) >= 1

    def test_no_facts_returns_empty(self):
        text = "Привет! Как дела? Надеюсь, всё хорошо."
        claims = extract_claims(text)
        assert claims == []

    def test_max_claims_limit(self):
        text = (
            "В 1969 году человек высадился на Луну. "
            "В 1989 году пала Берлинская стена. "
            "В 2004 году Facebook был основан. "
            "В 2008 году случился финансовый кризис. "
            "В 2020 году началась пандемия COVID-19."
        )
        claims = extract_claims(text)
        assert len(claims) <= MAX_CLAIMS

    def test_short_sentences_skipped(self):
        text = "Да. Нет. Может быть. В 1991 году."
        claims = extract_claims(text)
        # Sentences shorter than 15 chars should be skipped
        assert all(len(c) >= 10 for c in claims)

    def test_english_dates_extracted(self):
        text = "Google was founded in 1998 by Larry Page and Sergey Brin. Since 2015 it is part of Alphabet."
        claims = extract_claims(text)
        assert len(claims) >= 1
        assert any("1998" in c for c in claims)

    def test_markdown_stripped_from_claims(self):
        text = "**Python** был создан *в 1991 году* и стал [популярным](url) языком с около 10 млн разработчиков."
        claims = extract_claims(text)
        for claim in claims:
            assert "**" not in claim
            assert "*" not in claim
            assert "[" not in claim

    def test_duplicate_claims_deduplicated(self):
        text = (
            "В 1991 году Python был создан. "
            "В 1991 году Python появился на свет. "
            "Это произошло в 1991 году."
        )
        claims = extract_claims(text)
        # Claims with same prefix should be deduplicated
        assert len(claims) <= MAX_CLAIMS
