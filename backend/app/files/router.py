"""Stage 3 — AutoStrategyRouter: pick the best reasoning strategy for a file analysis task."""

from __future__ import annotations

import logging
import re

from app.reasoning.engine import ReasoningStrategy

logger = logging.getLogger(__name__)

# Keyword-based classification (fast, no LLM call)
_STRATEGY_KEYWORDS: dict[ReasoningStrategy, list[str]] = {
    ReasoningStrategy.COT: [
        "суммаризируй", "суммаризация", "резюме", "краткое содержание",
        "объясни", "перескажи", "расскажи", "опиши", "обзор",
        "summarize", "summary", "explain", "describe", "overview",
    ],
    ReasoningStrategy.TREE_OF_THOUGHTS: [
        "риск", "анализ", "договор", "контракт", "сравни секции",
        "найди проблемы", "аудит", "уязвимост", "слабые места",
        "проанализируй", "оцени", "выдели ключевые",
        "risk", "analyze", "audit", "vulnerabilit", "issues", "contract",
    ],
    ReasoningStrategy.BEST_OF_N: [
        "сравни", "сравнение", "какой лучше", "выбери лучший",
        "кросс-документ", "несколько файлов", "между файлами",
        "compare", "which is better", "cross-document", "versus",
    ],
}

# Broader fallback patterns
_ANALYSIS_PATTERNS = re.compile(
    r"(?:анализ|найди|проверь|оцени|audit|analyz|check|review|assess)",
    re.IGNORECASE,
)
_SUMMARY_PATTERNS = re.compile(
    r"(?:суммар|кратк|резюм|обзор|перескаж|summar|brief|overview|recap)",
    re.IGNORECASE,
)


def classify_task(user_query: str, file_count: int = 1) -> ReasoningStrategy:
    """Classify the user's file analysis task into a reasoning strategy.

    Uses keyword matching (fast, deterministic, no LLM call).
    """
    query_lower = user_query.lower()

    # Multi-file → Best-of-N for comparison
    if file_count > 1:
        return ReasoningStrategy.BEST_OF_N

    # Check keyword matches
    scores: dict[ReasoningStrategy, int] = {}
    for strategy, keywords in _STRATEGY_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in query_lower)
        if score > 0:
            scores[strategy] = score

    if scores:
        return max(scores, key=scores.get)  # type: ignore[arg-type]

    # Fallback patterns
    if _ANALYSIS_PATTERNS.search(user_query):
        return ReasoningStrategy.TREE_OF_THOUGHTS
    if _SUMMARY_PATTERNS.search(user_query):
        return ReasoningStrategy.COT

    # Default: CoT is safest for general file questions
    return ReasoningStrategy.COT


def get_strategy_label(strategy: ReasoningStrategy) -> str:
    """Human-readable label for the chosen strategy."""
    labels = {
        ReasoningStrategy.COT: "Цепочка рассуждений (суммаризация / объяснение)",
        ReasoningStrategy.BUDGET_FORCING: "Углублённый итеративный анализ",
        ReasoningStrategy.TREE_OF_THOUGHTS: "Дерево мыслей (поиск рисков / глубокий анализ)",
        ReasoningStrategy.BEST_OF_N: "Сравнение вариантов (кросс-документный анализ)",
    }
    return labels.get(strategy, strategy.value)
