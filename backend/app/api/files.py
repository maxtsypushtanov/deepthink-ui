"""File upload and analysis API."""

from __future__ import annotations

import json
import logging
import os
import tempfile

from typing import List
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from sse_starlette.sse import EventSourceResponse

from app.db import database as db
from app.files.parser import parse_file, SUPPORTED_EXTENSIONS
from app.files.synthesizer import build_file_context
from app.providers.base import LLMMessage
from app.providers.registry import get_provider
from app.reasoning.engine import ReasoningEngine, ReasoningStrategy

logger = logging.getLogger(__name__)

router = APIRouter()

# In-memory file storage with TTL
import time as _time

_file_cache: dict[str, dict] = {}
MAX_CACHED_FILES = 30
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
FILE_CACHE_TTL = 3600  # 1 hour


def _evict_stale_files() -> None:
    """Remove expired entries and enforce size limit."""
    now = _time.monotonic()
    expired = [k for k, v in _file_cache.items() if now - v.get("_cached_at", 0) > FILE_CACHE_TTL]
    for k in expired:
        del _file_cache[k]
    while len(_file_cache) > MAX_CACHED_FILES:
        oldest_key = next(iter(_file_cache))
        del _file_cache[oldest_key]


@router.post("/api/files/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload and parse a file. Returns file metadata and parsed text info."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Неподдерживаемый формат: {ext}. Поддерживаются: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail=f"Файл слишком большой (макс. {MAX_FILE_SIZE // 1024 // 1024} МБ)")

    # Write to temp file for parsing
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        parsed = parse_file(tmp_path)
    finally:
        os.unlink(tmp_path)

    if parsed.get("error"):
        raise HTTPException(status_code=400, detail=parsed["error"])

    if parsed["char_count"] == 0 and parsed["file_type"] != "image":
        raise HTTPException(status_code=400, detail="Файл пуст или не содержит извлекаемого текста.")

    # Cache parsed result
    import uuid
    file_id = str(uuid.uuid4())
    parsed["id"] = file_id

    # Evict stale/overflow entries
    _evict_stale_files()

    parsed["_cached_at"] = _time.monotonic()
    _file_cache[file_id] = parsed

    return {
        "id": file_id,
        "filename": parsed["filename"],
        "file_type": parsed["file_type"],
        "char_count": parsed["char_count"],
        "preview": parsed["text"][:500] + ("..." if parsed["char_count"] > 500 else ""),
    }


@router.post("/api/files/analyze")
async def analyze_file(
    file_ids: List[str] = Form(...),
    query: str = Form(...),
    conversation_id: str = Form(None),
    model: str = Form("google/gemini-3.1-flash-lite-preview"),
    provider: str = Form("openrouter"),
):
    """Analyze one or more uploaded files using the reasoning engine. Returns SSE stream."""
    # Resolve all files from cache
    parsed_files = []
    for fid in file_ids:
        parsed = _file_cache.get(fid)
        if not parsed:
            raise HTTPException(status_code=404, detail=f"Файл не найден (id={fid[:8]}…). Загрузите его заново.")
        parsed_files.append(parsed)

    api_key = await db.get_provider_key(provider)
    if not api_key:
        raise HTTPException(status_code=400, detail=f"API-ключ не настроен для провайдера: {provider}")

    base_url = None
    all_settings = await db.get_provider_settings()
    for s in all_settings:
        if s["provider"] == provider and s.get("base_url"):
            base_url = s["base_url"]
            break

    llm_provider = get_provider(provider, api_key, base_url)

    # Build context for each file and combine
    n_files = len(parsed_files)
    contexts = [build_file_context(p, query, file_count=n_files) for p in parsed_files]
    # Use the most complex strategy among all files
    strategy = max((c["strategy"] for c in contexts), key=lambda s: s.value, default=contexts[0]["strategy"])
    engine = ReasoningEngine(llm_provider, model)

    total_chars = sum(c["char_count"] for c in contexts)
    filenames = [p["filename"] for p in parsed_files]
    filenames_str = ", ".join(filenames)

    # Create or use conversation
    if conversation_id:
        conv = await db.get_conversation(conversation_id)
        if not conv:
            raise HTTPException(status_code=404, detail="Conversation not found")
    else:
        title = f"Анализ: {filenames[0][:40]}" if len(filenames) == 1 else f"Анализ {len(filenames)} файлов"
        conv = await db.create_conversation(title=title)
        conversation_id = conv["id"]

    # Save user message
    file_labels = ", ".join(filenames)
    user_content = f"[Файлы: {file_labels}]\n\n{query}"
    await db.add_message(conversation_id, "user", user_content)

    # Build combined user message with all file contents
    file_sections = []
    for parsed, ctx in zip(parsed_files, contexts):
        is_image = parsed.get("file_type") == "image" and parsed.get("image_base64")
        if is_image:
            mime = parsed.get("image_mime", "image/png")
            b64 = parsed["image_base64"]
            file_sections.append(
                f"### Изображение «{parsed['filename']}»\n\n"
                f"![{parsed['filename']}](data:{mime};base64,{b64})"
            )
        else:
            file_sections.append(
                f"### Файл «{parsed['filename']}» ({ctx['char_count']:,} символов, {ctx['context_mode']})\n\n"
                f"---\n{ctx['file_context']}\n---"
            )

    user_with_file = "\n\n".join(file_sections) + f"\n\nВопрос пользователя: {query}"

    messages = [
        LLMMessage(role="user", content=user_with_file),
    ]

    strategy_label = contexts[0]["strategy_label"]

    async def event_stream():
        yield {
            "event": "conversation",
            "data": json.dumps({"conversation_id": conversation_id}),
        }

        yield {
            "event": "strategy_selected",
            "data": json.dumps({
                "strategy": strategy.value,
                "intent": "file_analysis",
                "domain": "file_analysis",
                "label": strategy_label,
                "persona_preview": f"Анализ: {filenames_str[:60]}",
                "persona_detail": f"{len(parsed_files)} файл(ов) · {total_chars:,} символов · {strategy_label}",
            }, ensure_ascii=False),
        }

        full_content = ""

        try:
            async for event in engine.run(messages, strategy):
                evt_type = event["event"]
                evt_data = event["data"]

                if evt_type == "content_delta":
                    content = evt_data.get("content", "")
                    full_content += content
                    yield {
                        "event": "content_delta",
                        "data": json.dumps({"content": content}, ensure_ascii=False),
                    }
                else:
                    yield {
                        "event": evt_type,
                        "data": json.dumps(evt_data, ensure_ascii=False),
                    }
        except Exception as e:
            logger.exception("File analysis error")
            yield {"event": "error", "data": json.dumps({"error": str(e)})}

        # Save assistant response
        await db.add_message(
            conversation_id, "assistant", full_content,
            model=model, provider=provider,
            reasoning_strategy=strategy.value,
        )

        yield {"event": "done", "data": json.dumps({})}

    return EventSourceResponse(event_stream())


@router.get("/api/files/{file_id}")
async def get_file_info(file_id: str):
    """Get cached file metadata."""
    parsed = _file_cache.get(file_id)
    if not parsed:
        raise HTTPException(status_code=404, detail="Файл не найден")
    return {
        "id": file_id,
        "filename": parsed["filename"],
        "file_type": parsed["file_type"],
        "char_count": parsed["char_count"],
    }
