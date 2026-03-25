"""Stage 4 — Synthesize: build the final file analysis prompt and format result."""

from __future__ import annotations

from app.files.chunker import should_chunk, chunk_text, search_chunks
from app.files.router import classify_task, get_strategy_label
from app.reasoning.engine import ReasoningStrategy


def build_file_context(
    parsed_file: dict,
    user_query: str,
    file_count: int = 1,
) -> dict:
    """Build the context for LLM analysis of a file.

    Returns:
        {
            "strategy": ReasoningStrategy,
            "strategy_label": str,
            "system_prompt": str,
            "context_mode": "full" | "chunked",
            "file_context": str,         # text injected into messages
            "chunk_count": int,           # 0 if full context
            "char_count": int,
        }
    """
    text = parsed_file["text"]
    filename = parsed_file["filename"]
    file_type = parsed_file["file_type"]
    char_count = parsed_file["char_count"]

    strategy = classify_task(user_query, file_count=file_count)

    if should_chunk(char_count):
        # Large file: chunk and retrieve relevant parts
        chunks = chunk_text(text)
        relevant = search_chunks(chunks, user_query, top_k=8)
        file_context = "\n\n---\n\n".join(
            f"[Фрагмент {c['index'] + 1}, символы {c['start']}-{c['end']}]\n{c['text']}"
            for c in relevant
        )
        context_mode = "chunked"
        chunk_count = len(chunks)
    else:
        # Small file: full context
        file_context = text
        context_mode = "full"
        chunk_count = 0

    # Build system prompt for file analysis
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

    system_prompt = f"""Ты — DeepThink, ИИ-ассистент с продвинутым reasoning engine.
Тебе предоставлен {type_label} «{filename}» ({char_count:,} символов).
{"Показаны наиболее релевантные фрагменты (" + str(len(relevant)) + " из " + str(chunk_count) + " чанков)." if context_mode == "chunked" else "Весь текст файла включён в контекст."}

Стратегия анализа: {strategy_label}.

ПРАВИЛА:
— Отвечай на языке пользователя
— Рассуждения внутри <thinking></thinking>, финальный ответ — после тегов
— Ссылайся на конкретные места в документе (номера страниц, секции, строки кода)
— Будь точен и конкретен, не домысливай то, чего нет в тексте
— Если информации недостаточно для ответа — скажи прямо

СОДЕРЖИМОЕ ФАЙЛА «{filename}»:
{file_context}"""

    return {
        "strategy": strategy,
        "strategy_label": strategy_label,
        "system_prompt": system_prompt,
        "context_mode": context_mode,
        "file_context": file_context,
        "chunk_count": chunk_count,
        "char_count": char_count,
    }
