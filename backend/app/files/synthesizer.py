"""Stage 4 — Synthesize: build the final file analysis prompt using Cognitive Map."""

from __future__ import annotations

from app.files.cognitive_map import build_cognitive_map, build_focused_context, CognitiveMap
from app.files.router import classify_task, get_strategy_label
from app.reasoning.engine import ReasoningStrategy

# Cache cognitive maps by file_id to avoid rebuilding
_map_cache: dict[str, CognitiveMap] = {}


def build_file_context(
    parsed_file: dict,
    user_query: str,
    file_count: int = 1,
) -> dict:
    """Build the context for LLM analysis using Document Cognitive Map.

    TRIZ #13: instead of cramming the whole document into the prompt,
    navigate to the relevant sections like a human expert would.

    Returns:
        {
            "strategy": ReasoningStrategy,
            "strategy_label": str,
            "system_prompt": str,
            "context_mode": "full" | "focused",
            "file_context": str,
            "chunk_count": int,
            "char_count": int,
            "sections_used": list[int],
            "cognitive_map": CognitiveMap,
        }
    """
    text = parsed_file["text"]
    filename = parsed_file["filename"]
    file_type = parsed_file["file_type"]
    char_count = parsed_file["char_count"]
    file_id = parsed_file.get("id", filename)

    strategy = classify_task(user_query, file_count=file_count)

    # Build or retrieve cognitive map
    if file_id in _map_cache:
        cmap = _map_cache[file_id]
    else:
        cmap = build_cognitive_map(text, filename, file_type)
        _map_cache[file_id] = cmap
        # Limit cache size
        if len(_map_cache) > 30:
            oldest = next(iter(_map_cache))
            del _map_cache[oldest]

    # Build focused context using cognitive map
    focused = build_focused_context(cmap, user_query, max_chars=8000)

    context_mode = focused["level"]
    file_context = focused["context"]
    sections_used = focused["sections_used"]

    # Build system prompt
    strategy_label = get_strategy_label(strategy)
    type_label = {
        "pdf": "PDF-документ",
        "docx": "Word-документ",
        "pptx": "презентация PowerPoint",
        "xlsx": "таблица Excel",
        "image": "изображение",
        "code": "исходный код",
        "text": "текстовый файл",
    }.get(file_type, "файл")

    n_sections = len(cmap.sections)
    n_used = len(sections_used)

    system_prompt = f"""Ты — Нейрон, ИИ-ассистент с продвинутым reasoning engine.
Тебе предоставлен {type_label} «{filename}» ({char_count:,} символов, {n_sections} секций).
{"Весь текст включён в контекст." if context_mode == "full" else f"Показаны {n_used} наиболее релевантных секций из {n_sections}. Структура всего документа видна в скелете."}

Стратегия анализа: {strategy_label}.

ПРАВИЛА:
— Отвечай на языке пользователя
— Рассуждения внутри <thinking></thinking>, финальный ответ — после тегов
— Ссылайся на конкретные секции по номеру: [0], [1], ...
— Будь точен и конкретен, не домысливай
— Если информации в показанных секциях недостаточно — скажи какая секция может содержать ответ (по скелету)

СОДЕРЖИМОЕ:
{file_context}"""

    return {
        "strategy": strategy,
        "strategy_label": strategy_label,
        "system_prompt": system_prompt,
        "context_mode": context_mode,
        "file_context": file_context,
        "chunk_count": n_sections,
        "char_count": char_count,
        "sections_used": sections_used,
        "cognitive_map": cmap,
    }
