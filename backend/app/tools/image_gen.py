"""Image generation via OpenRouter (models with image output modality)."""

from __future__ import annotations

import logging
import re
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_http_client: httpx.AsyncClient | None = None


def _get_client(timeout: float = 30.0) -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=timeout)
    return _http_client

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# Default image generation models (ordered by quality)
DEFAULT_IMAGE_MODELS = [
    "google/gemini-2.5-flash-preview:thinking",
    "openai/gpt-image-1",
    "bytedance/seedream-4.5",
]

# Patterns that suggest user wants image generation
IMAGE_TRIGGER_PATTERNS = re.compile(
    r'(?:нарисуй|нарисовать|создай (?:изображени|картинк|иллюстраци|арт|логотип|иконк|баннер|постер|обложк)|'
    r'сгенерируй (?:изображени|картинк|фото|арт)|генерация (?:изображени|картин)|'
    r'сделай (?:картинк|изображени|иллюстраци|визуализаци)|'
    r'покажи (?:как выглядит|визуально)|визуализируй|'
    r'generate (?:an? )?(?:image|picture|photo|art|illustration|logo|icon|banner)|'
    r'draw (?:me )?|create (?:an? )?(?:image|picture|illustration|art)|'
    r'make (?:an? )?(?:image|picture|photo))',
    re.IGNORECASE,
)


def needs_image_generation(query: str) -> bool:
    """Heuristic: does this query request image generation?"""
    return bool(IMAGE_TRIGGER_PATTERNS.search(query))


async def generate_image(
    prompt: str,
    api_key: str,
    model: str = "google/gemini-2.5-flash-preview:thinking",
) -> dict[str, Any]:
    """Generate an image via OpenRouter.

    Args:
        prompt: Text description of the image to generate
        api_key: OpenRouter API key
        model: Model ID that supports image output

    Returns:
        Dict with 'images' (list of base64 data URLs), 'text' (optional description), 'model'
    """
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://deepthink.app",
        "X-Title": "DeepThink",
    }

    body = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": prompt,
            }
        ],
        "modalities": ["text", "image"],
        "max_tokens": 4096,
    }

    client = _get_client(120.0)
    resp = await client.post(OPENROUTER_URL, headers=headers, json=body)
    resp.raise_for_status()
    data = resp.json()

    images: list[str] = []
    text = ""

    for choice in data.get("choices", []):
        msg = choice.get("message", {})
        if msg.get("content"):
            text = msg["content"]

        # Extract images from message
        for img in msg.get("images", []):
            url = img.get("image_url", {}).get("url", "")
            if url:
                images.append(url)

        # Some models return images inline in content as markdown
        if not images and msg.get("content"):
            # Look for base64 image data in content
            b64_matches = re.findall(r'data:image/[^;]+;base64,[A-Za-z0-9+/=]+', msg["content"])
            images.extend(b64_matches)

    return {
        "images": images,
        "text": text,
        "model": model,
    }
