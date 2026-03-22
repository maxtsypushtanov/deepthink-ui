"""API routes for chat, conversations, and settings."""

from __future__ import annotations

import json
import logging
from fastapi import APIRouter, HTTPException
from sse_starlette.sse import EventSourceResponse

logger = logging.getLogger(__name__)

from app.api.schemas import (
    ChatRequest,
    ConversationCreate,
    ConversationUpdate,
    ProviderSettingsRequest,
)
from app.db import database as db
from app.providers.base import LLMMessage
from app.providers.registry import get_provider
from app.reasoning.engine import ReasoningEngine, ReasoningStrategy, SessionContext

router = APIRouter()

# In-memory session context storage keyed by conversation_id
_session_contexts: dict[str, SessionContext] = {}


# ── Chat (SSE streaming) ──

@router.post("/api/chat")
async def chat(req: ChatRequest):
    """Stream a chat response with optional reasoning."""

    # Resolve provider API key
    api_key = await db.get_provider_key(req.provider)
    if not api_key:
        raise HTTPException(status_code=400, detail=f"No API key configured for provider: {req.provider}")

    # Get provider settings for base_url
    all_settings = await db.get_provider_settings()
    base_url = None
    for s in all_settings:
        if s["provider"] == req.provider and s.get("base_url"):
            base_url = s["base_url"]

    provider = get_provider(req.provider, api_key, base_url)

    # Create or get conversation
    if req.conversation_id:
        conv = await db.get_conversation(req.conversation_id)
        if not conv:
            raise HTTPException(status_code=404, detail="Conversation not found")
        conversation_id = req.conversation_id
    else:
        conv = await db.create_conversation(title=req.message[:50])
        conversation_id = conv["id"]

    # Save user message
    await db.add_message(conversation_id, "user", req.message)

    # Auto-rename if title is still default
    conv_data = await db.get_conversation(conversation_id)
    if conv_data and conv_data.get("title") in ("New Chat", "Новый чат"):
        new_title = req.message[:50].strip()
        if new_title:
            await db.update_conversation_title(conversation_id, new_title)

    # Build message history
    history = await db.get_messages(conversation_id)
    messages = [LLMMessage(role=m["role"], content=m["content"]) for m in history if m["role"] in ("user", "assistant")]

    # If clarification context is provided, append as system message
    if req.clarification_context:
        messages.append(LLMMessage(role="system", content=req.clarification_context))

    strategy = ReasoningStrategy(req.reasoning_strategy)
    engine = ReasoningEngine(provider, req.model)

    # Get or create session context for this conversation
    if conversation_id not in _session_contexts:
        _session_contexts[conversation_id] = SessionContext()
    session_context = _session_contexts[conversation_id]

    # Dynamic re-tuning: every N messages, re-detect domain and refresh persona
    refreshed_persona = await engine.retune_if_needed(
        messages, req.reasoning_strategy, session_context,
    )
    if refreshed_persona:
        # Inject refreshed system prompt at the start of messages
        messages.insert(0, LLMMessage(role="system", content=refreshed_persona))

    async def event_stream():
        full_content = ""
        reasoning_trace = []
        content_buffer = ""
        in_thinking = False

        yield {
            "event": "conversation",
            "data": json.dumps({"conversation_id": conversation_id}),
        }

        try:
            async for event in engine.run(
                messages,
                strategy,
                budget_rounds=req.budget_rounds,
                best_of_n=req.best_of_n,
                tree_breadth=req.tree_breadth,
                tree_depth=req.tree_depth,
                session_context=session_context,
            ):
                evt_type = event["event"]
                evt_data = event["data"]

                if evt_type == "content_delta":
                    raw = evt_data["content"]
                    # Buffer-based thinking tag filter
                    content_buffer += raw
                    while True:
                        if not in_thinking:
                            think_start = content_buffer.find("<thinking>")
                            if think_start == -1:
                                # No tag found — safe to emit all but last 10 chars (in case partial tag)
                                safe = content_buffer[:-10] if len(content_buffer) > 10 else ""
                                if safe:
                                    full_content += safe
                                    yield {"event": "content_delta", "data": json.dumps({"content": safe}, ensure_ascii=False)}
                                    content_buffer = content_buffer[len(safe):]
                                break
                            else:
                                # Emit everything before the tag
                                before = content_buffer[:think_start]
                                if before:
                                    full_content += before
                                    yield {"event": "content_delta", "data": json.dumps({"content": before}, ensure_ascii=False)}
                                content_buffer = content_buffer[think_start:]
                                in_thinking = True
                        else:
                            think_end = content_buffer.find("</thinking>")
                            if think_end == -1:
                                break  # Wait for more data
                            else:
                                # Skip the entire thinking block
                                content_buffer = content_buffer[think_end + len("</thinking>"):]
                                in_thinking = False
                elif evt_type == "thinking_end":
                    reasoning_trace = evt_data.get("steps", [])
                    yield {
                        "event": evt_type,
                        "data": json.dumps(evt_data, ensure_ascii=False),
                    }
                else:
                    yield {
                        "event": evt_type,
                        "data": json.dumps(evt_data, ensure_ascii=False),
                    }

        except Exception as e:
            yield {
                "event": "error",
                "data": json.dumps({"error": str(e)}),
            }
            return

        # Flush remaining buffer
        if content_buffer:
            if not in_thinking:
                remaining = content_buffer.replace("<thinking>", "").replace("</thinking>", "").strip()
                if remaining:
                    full_content += remaining

        # Guard against None content
        full_content = full_content or ""

        # Strip any remaining thinking tags from full_content
        full_content = ReasoningEngine._strip_thinking_tags(full_content)

        # Check for clarification request in the response
        needs_clarification, clarification_question = ReasoningEngine._check_clarification(full_content)
        if needs_clarification:
            yield {
                "event": "clarification_needed",
                "data": json.dumps({"question": clarification_question}, ensure_ascii=False),
            }

        # Save assistant message
        await db.add_message(
            conversation_id,
            "assistant",
            full_content,
            model=req.model,
            provider=req.provider,
            reasoning_strategy=strategy.value,
            reasoning_trace=json.dumps(reasoning_trace, ensure_ascii=False) if reasoning_trace else None,
        )

        yield {"event": "done", "data": json.dumps({})}

    return EventSourceResponse(event_stream())


# ── Conversations ──

@router.get("/api/conversations")
async def list_conversations():
    return await db.list_conversations()


@router.post("/api/conversations")
async def create_conversation(req: ConversationCreate):
    return await db.create_conversation(req.title)


@router.get("/api/conversations/{cid}")
async def get_conversation(cid: str):
    conv = await db.get_conversation(cid)
    if not conv:
        raise HTTPException(status_code=404, detail="Not found")
    return conv


@router.get("/api/conversations/{cid}/messages")
async def get_messages(cid: str):
    return await db.get_messages(cid)


@router.patch("/api/conversations/{cid}")
async def update_conversation(cid: str, req: ConversationUpdate):
    await db.update_conversation_title(cid, req.title)
    return {"ok": True}


@router.delete("/api/conversations/{cid}")
async def delete_conversation(cid: str):
    await db.delete_conversation(cid)
    return {"ok": True}


# ── Settings ──

@router.get("/api/settings/providers")
async def get_providers():
    settings = await db.get_provider_settings()
    # Mask API keys for security
    for s in settings:
        if s.get("api_key"):
            key = s["api_key"]
            s["api_key_preview"] = key[:8] + "..." + key[-4:] if len(key) > 12 else "***"
    return settings


@router.post("/api/settings/providers")
async def save_provider(req: ProviderSettingsRequest):
    await db.save_provider_settings(
        provider=req.provider,
        api_key=req.api_key,
        base_url=req.base_url,
        enabled=req.enabled,
    )
    return {"ok": True}


# ── Models list (per provider) ──

KNOWN_MODELS = {
    "openrouter": [
        {"id": "openai/gpt-4o-mini", "name": "GPT-4o Mini", "context": 128000},
        {"id": "openai/gpt-4o", "name": "GPT-4o", "context": 128000},
        {"id": "anthropic/claude-3.5-sonnet", "name": "Claude 3.5 Sonnet", "context": 200000},
        {"id": "anthropic/claude-3-haiku", "name": "Claude 3 Haiku", "context": 200000},
        {"id": "google/gemini-2.0-flash-exp:free", "name": "Gemini 2.0 Flash (free)", "context": 1000000},
        {"id": "meta-llama/llama-3.1-70b-instruct", "name": "Llama 3.1 70B", "context": 131072},
        {"id": "mistralai/mistral-large-latest", "name": "Mistral Large", "context": 128000},
        {"id": "qwen/qwen-2.5-72b-instruct", "name": "Qwen 2.5 72B", "context": 131072},
        {"id": "deepseek/deepseek-r1", "name": "DeepSeek R1", "context": 64000},
        {"id": "deepseek/deepseek-chat", "name": "DeepSeek V3", "context": 64000},
    ],
    "deepseek": [
        {"id": "deepseek-chat", "name": "DeepSeek V3", "context": 64000},
        {"id": "deepseek-reasoner", "name": "DeepSeek R1", "context": 64000},
    ],
    "cloudru": [
        # GigaChat family
        {"id": "GigaChat", "name": "GigaChat", "context": 32768},
        {"id": "GigaChat-Plus", "name": "GigaChat Plus", "context": 32768},
        {"id": "GigaChat-Pro", "name": "GigaChat Pro", "context": 32768},
        {"id": "GigaChat-Max", "name": "GigaChat Max", "context": 32768},
        {"id": "GigaChat-2", "name": "GigaChat 2", "context": 32768},
        {"id": "GigaChat-2-Max", "name": "GigaChat 2 Max", "context": 32768},
        # Llama models
        {"id": "llama-3.3-70b", "name": "Llama 3.3 70B", "context": 131072},
        {"id": "llama-3.1-8b", "name": "Llama 3.1 8B", "context": 131072},
        {"id": "llama-3.1-70b", "name": "Llama 3.1 70B", "context": 131072},
        {"id": "llama-3.1-405b", "name": "Llama 3.1 405B", "context": 131072},
        # DeepSeek models
        {"id": "deepseek-r1", "name": "DeepSeek R1", "context": 64000},
        {"id": "deepseek-v3", "name": "DeepSeek V3", "context": 64000},
        # Qwen models
        {"id": "qwen-2.5-72b", "name": "Qwen 2.5 72B", "context": 131072},
        {"id": "qwen-2.5-coder-32b", "name": "Qwen 2.5 Coder 32B", "context": 131072},
        {"id": "qwen-max", "name": "Qwen Max", "context": 32768},
    ],
    "custom": [],
}


async def _fetch_models_from_api(provider: str, api_key: str) -> list[dict]:
    """Try to fetch model list from provider API."""
    import httpx

    all_settings = await db.get_provider_settings()
    base_url = None
    for s in all_settings:
        if s["provider"] == provider and s.get("base_url"):
            base_url = s["base_url"]

    if not base_url:
        from app.providers.registry import PROVIDERS
        cls = PROVIDERS.get(provider)
        if cls:
            base_url = cls.base_url

    if not base_url:
        return []

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if provider == "openrouter":
        headers["HTTP-Referer"] = "https://deepthink-ui.local"
        headers["X-Title"] = "DeepThink UI"

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{base_url}/models", headers=headers)
        resp.raise_for_status()
        data = resp.json()

    models = []
    raw_models = data.get("data", data if isinstance(data, list) else [])
    for m in raw_models[:50]:  # Limit to 50 models
        model_id = m.get("id", "")
        model_name = m.get("name") or m.get("id", "").split("/")[-1]
        context = m.get("context_length") or m.get("context_window") or 4096
        models.append({"id": model_id, "name": model_name, "context": context})

    return models


@router.get("/api/models/{provider}")
async def list_models(provider: str):
    # Try dynamic fetch for providers that support it
    if provider in ("openrouter", "cloudru", "custom"):
        api_key = await db.get_provider_key(provider)
        if api_key:
            try:
                fetched = await _fetch_models_from_api(provider, api_key)
                if fetched:
                    return fetched
            except Exception as e:
                logger.warning(f"Failed to fetch models for {provider}: {e}")
    return KNOWN_MODELS.get(provider, [])
