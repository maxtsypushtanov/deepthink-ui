"""Settings endpoints — providers, models, model tiers."""

from __future__ import annotations

import logging

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.schemas import ProviderSettingsRequest
from app.db import database as db
from app.providers.registry import get_provider

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Helpers ──

async def _get_provider_base_url(provider: str) -> str | None:
    """Look up the custom base_url for a provider from saved settings."""
    return await db.get_provider_base_url(provider)


# ── Settings ──

@router.get("/api/settings/providers")
async def get_providers():
    settings = await db.get_provider_settings()
    # Mask API keys for security
    for s in settings:
        if s.get("api_key"):
            key = s["api_key"]
            s["api_key_preview"] = key[:8] + "..." + key[-4:] if len(key) > 12 else "***"
            s.pop("api_key", None)
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


# ── Model Tiers (smart routing) ──

class ModelTierUpdate(BaseModel):
    fast: str | None = None
    standard: str | None = None
    powerful: str | None = None


@router.get("/api/settings/model-tiers")
async def get_model_tiers():
    """Get current model tier configuration for smart routing."""
    tiers = await db.get_model_tiers()
    return tiers


@router.post("/api/settings/model-tiers")
async def update_model_tiers(req: ModelTierUpdate):
    """Update model tier configuration for smart routing."""
    updated = []
    if req.fast is not None:
        await db.set_model_tier("fast", req.fast)
        updated.append("fast")
    if req.standard is not None:
        await db.set_model_tier("standard", req.standard)
        updated.append("standard")
    if req.powerful is not None:
        await db.set_model_tier("powerful", req.powerful)
        updated.append("powerful")
    return {"ok": True, "updated": updated}


# ── Models list (per provider) ──

KNOWN_MODELS = {
    "custom": [
        {"id": "openai/gpt-oss-120b", "name": "GPT-OSS 120B", "context": 131072},
        {"id": "zai-org/GLM-4.7", "name": "GLM-4.7", "context": 131072},
        {"id": "zai-org/GLM-4.7-Flash", "name": "GLM-4.7 Flash", "context": 131072},
        {"id": "zai-org/GLM-4.6", "name": "GLM-4.6", "context": 131072},
    ],
}


async def _fetch_models_from_api(provider: str, api_key: str) -> list[dict]:
    """Try to fetch model list from provider API."""
    import httpx

    base_url = await _get_provider_base_url(provider)

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
