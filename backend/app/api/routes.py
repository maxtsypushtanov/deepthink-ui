"""API routes for chat, conversations, and settings."""

from __future__ import annotations

import json
from fastapi import APIRouter, HTTPException
from sse_starlette.sse import EventSourceResponse

from app.api.schemas import (
    ChatRequest,
    ConversationCreate,
    ConversationUpdate,
    ProviderSettingsRequest,
)
from app.db import database as db
from app.providers.base import LLMMessage
from app.providers.registry import get_provider
from app.reasoning.engine import ReasoningEngine, ReasoningStrategy

router = APIRouter()


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

    # Build message history
    history = await db.get_messages(conversation_id)
    messages = [LLMMessage(role=m["role"], content=m["content"]) for m in history if m["role"] in ("user", "assistant")]

    strategy = ReasoningStrategy(req.reasoning_strategy)
    engine = ReasoningEngine(provider, req.model)

    async def event_stream():
        full_content = ""
        reasoning_trace = []

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
            ):
                evt_type = event["event"]
                evt_data = event["data"]

                if evt_type == "content_delta":
                    full_content += evt_data["content"]

                if evt_type == "thinking_end":
                    reasoning_trace = evt_data.get("steps", [])

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
        {"id": "gpt-4o-mini", "name": "GPT-4o Mini (Cloud.ru)", "context": 128000},
    ],
    "custom": [],
}


@router.get("/api/models/{provider}")
async def list_models(provider: str):
    return KNOWN_MODELS.get(provider, [])
