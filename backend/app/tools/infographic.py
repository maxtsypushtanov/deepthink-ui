"""Advanced infographic generation: Reasoning + Structured Data + Image Generation.

Pipeline:
1. Detect infographic request
2. LLM reasons about the topic → structured brief
3. Auto-select format: Mermaid diagram (data/process) or AI image (visual infographic)
4. LLM crafts optimized image prompt from brief
5. Generate image + optional Mermaid code
6. Stream thinking steps to frontend
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, AsyncGenerator

import httpx

from app.providers.base import LLMMessage, LLMRequest, BaseLLMProvider

_http_client: httpx.AsyncClient | None = None


def _get_client(timeout: float = 30.0) -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=timeout)
    return _http_client

logger = logging.getLogger(__name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# ── Detection ──

INFOGRAPHIC_PATTERNS = re.compile(
    r'(?:инфографик[уа]|создай (?:схем|диаграмм|визуализаци|карт[уа] )|'
    r'визуализируй (?:данные|информаци|процесс|структур)|'
    r'покажи (?:схем|структур|процесс|связи|архитектур)|'
    r'нарисуй (?:схем|диаграмм|процесс|структур|карт[уа])|'
    r'mind.?map|майнд.?мап|интеллект.?карт|'
    r'infographic|flowchart|diagram|timeline|'
    r'дорожн(?:ая|ую) карт|roadmap|'
    r'сравнительн(?:ая|ую) (?:таблиц|схем|инфографик)|'
    r'объясни (?:визуально|наглядно|схематично))',
    re.IGNORECASE,
)


def needs_infographic(query: str) -> bool:
    """Detect if user wants an infographic or visual explanation."""
    return bool(INFOGRAPHIC_PATTERNS.search(query))


# ── Structured Brief Prompt ──

BRIEF_PROMPT = """\
Ты — эксперт по инфодизайну. Проанализируй тему и создай структурированный бриф для инфографики.

Тема: {topic}

{context}

Ответь СТРОГО в JSON (без markdown, без объяснений):
{{
  "title": "Заголовок инфографики",
  "subtitle": "Подзаголовок (1 предложение)",
  "type": "один из: comparison | process | timeline | hierarchy | statistics | mindmap | architecture",
  "sections": [
    {{
      "heading": "Название секции",
      "points": ["Ключевой факт 1", "Ключевой факт 2"],
      "data": {{"label": "value"}} или null,
      "icon_hint": "emoji или краткое описание иконки"
    }}
  ],
  "visual_style": "один из: corporate | creative | minimal | tech | scientific | playful",
  "color_scheme": "один из: monochrome | warm | cool | vibrant | pastel | dark",
  "layout": "один из: vertical | horizontal | circular | grid | freeform",
  "key_insight": "Главный вывод или посыл инфографики (1 предложение)",
  "mermaid_suitable": true/false
}}

Правила:
— Максимум 6 секций
— Каждая секция: 2-4 ключевых факта
— Данные должны быть конкретными (числа, проценты, даты), не абстрактными
— mermaid_suitable=true если тема хорошо ложится на блок-схему, timeline или mind map
— Если тема сравнительная — type=comparison, если процесс — process, и т.д.
"""

# ── Mermaid Generation Prompt ──

MERMAID_PROMPT = """\
Создай Mermaid-диаграмму на основе этого брифа. Используй тип диаграммы, который лучше всего подходит.

Бриф:
{brief_json}

Правила:
— Пиши ТОЛЬКО код Mermaid (без ```mermaid, без объяснений)
— Текст в узлах — на русском
— Используй подходящий тип: graph TD, graph LR, timeline, mindmap, flowchart, pie, sequenceDiagram
— Для comparison используй graph LR с двумя ветками
— Для process/timeline — flowchart TD или timeline
— Для hierarchy/architecture — graph TD
— Для mindmap — mindmap
— Для statistics с числами — pie chart если уместно
— Максимум 15 узлов
— Используй стилизацию: subgraph для группировки, разные формы узлов ([прямоугольник], (скруглённый), {{ромб}})
"""

# ── Image Prompt Generation ──

IMAGE_PROMPT_TEMPLATE = """\
Ты — промпт-инженер для генерации инфографики через AI-модель. На основе брифа создай детальный промпт для генерации изображения.

Бриф:
{brief_json}

Создай промпт на АНГЛИЙСКОМ языке для модели генерации изображений. Промпт должен:
— Описывать визуальную инфографику как единое изображение
— Включать: layout, цветовую схему, типографику, иконки, данные
— Указать стиль: flat design, modern infographic
— Включить все ключевые данные из брифа (числа, факты) — они должны быть видны на изображении
— Быть одним абзацем, 100-200 слов
— НЕ включать markdown, только текст промпта

Ответь ТОЛЬКО текстом промпта, ничего больше.
"""


async def generate_infographic(
    topic: str,
    provider: BaseLLMProvider,
    model: str,
    image_model: str,
    openrouter_key: str,
    context: str = "",
) -> AsyncGenerator[dict[str, Any], None]:
    """Generate an infographic through reasoning + image generation pipeline.

    Yields SSE-compatible events:
    - thinking_step: progress updates
    - infographic_brief: structured data
    - mermaid_code: Mermaid diagram code (if applicable)
    - generated_images: base64 image URLs
    - content_delta: text description
    """

    # ── Step 1: Generate structured brief ──
    yield _step(1, "Анализирую тему и структурирую информацию", "reasoning")

    ctx_note = f"\nДополнительный контекст:\n{context}" if context else ""
    brief_messages = [
        LLMMessage(role="user", content=BRIEF_PROMPT.format(topic=topic, context=ctx_note)),
    ]

    brief_resp = await provider.complete(LLMRequest(
        messages=brief_messages, model=model, temperature=0.3, max_tokens=2048,
    ))

    brief_text = (brief_resp.content or "").strip()
    # Extract JSON from response
    brief_text = re.sub(r'^```(?:json)?\n?', '', brief_text)
    brief_text = re.sub(r'\n?```$', '', brief_text)

    try:
        brief = json.loads(brief_text)
    except json.JSONDecodeError:
        # Try to extract JSON from mixed text
        json_match = re.search(r'\{[\s\S]*\}', brief_text)
        if json_match:
            brief = json.loads(json_match.group())
        else:
            yield _step(2, "Не удалось структурировать данные", "error")
            return

    yield _step(2, f"Бриф готов: {brief.get('title', '')} ({brief.get('type', '')})", "reasoning",
                content=json.dumps(brief, ensure_ascii=False, indent=2))

    yield {"event": "infographic_brief", "data": brief}

    # ── Step 2: Generate Mermaid diagram (if suitable) ──
    mermaid_code = None
    if brief.get("mermaid_suitable", False):
        yield _step(3, "Создаю интерактивную диаграмму", "reasoning")

        mermaid_messages = [
            LLMMessage(role="user", content=MERMAID_PROMPT.format(
                brief_json=json.dumps(brief, ensure_ascii=False),
            )),
        ]

        mermaid_resp = await provider.complete(LLMRequest(
            messages=mermaid_messages, model=model, temperature=0.2, max_tokens=1500,
        ))

        mermaid_code = (mermaid_resp.content or "").strip()
        mermaid_code = re.sub(r'^```(?:mermaid)?\n?', '', mermaid_code)
        mermaid_code = re.sub(r'\n?```$', '', mermaid_code)

        yield _step(4, "Диаграмма создана", "reasoning", content=mermaid_code[:300])
        yield {"event": "mermaid_code", "data": {"code": mermaid_code}}

    # ── Step 3: Generate image prompt ──
    step_n = 5 if mermaid_code else 3
    yield _step(step_n, "Создаю промпт для визуальной инфографики", "reasoning")

    img_prompt_messages = [
        LLMMessage(role="user", content=IMAGE_PROMPT_TEMPLATE.format(
            brief_json=json.dumps(brief, ensure_ascii=False),
        )),
    ]

    img_prompt_resp = await provider.complete(LLMRequest(
        messages=img_prompt_messages, model=model, temperature=0.4, max_tokens=500,
    ))

    image_prompt = (img_prompt_resp.content or "").strip()
    yield _step(step_n + 1, "Промпт готов, генерирую изображение", "reasoning",
                content=image_prompt[:200])

    # ── Step 4: Generate image ──
    yield _step(step_n + 2, f"Генерирую инфографику ({image_model.split('/')[-1]})", "reasoning")

    images = await _generate_image(image_prompt, openrouter_key, image_model)

    if images:
        yield _step(step_n + 3, f"Готово! Создано {len(images)} изображений", "reasoning")
        yield {"event": "generated_images", "data": {"images": images}}
    else:
        yield _step(step_n + 3, "Не удалось сгенерировать изображение", "error")

    # ── Step 5: Generate description ──
    description = _build_description(brief, mermaid_code, bool(images))
    yield {"event": "description", "data": {"text": description, "brief": brief, "mermaid": mermaid_code}}


def _step(n: int, label: str, step_type: str = "reasoning", content: str = "") -> dict:
    """Create a thinking step event."""
    return {
        "event": "thinking_step",
        "data": {
            "step_number": n,
            "strategy": "infographic",
            "content": label,
            "duration_ms": 0,
            "metadata": {"type": step_type, "content": content},
        },
    }


def _build_description(brief: dict, mermaid_code: str | None, has_image: bool) -> str:
    """Build markdown description from brief."""
    parts = []
    parts.append(f"## {brief.get('title', 'Инфографика')}")
    if brief.get("subtitle"):
        parts.append(f"*{brief['subtitle']}*")
    parts.append("")

    for section in brief.get("sections", []):
        icon = section.get("icon_hint", "")
        heading = section.get("heading", "")
        parts.append(f"### {icon} {heading}" if icon else f"### {heading}")
        for point in section.get("points", []):
            parts.append(f"- {point}")
        if section.get("data"):
            for k, v in section["data"].items():
                parts.append(f"- **{k}**: {v}")
        parts.append("")

    if brief.get("key_insight"):
        parts.append(f"> {brief['key_insight']}")
        parts.append("")

    if mermaid_code:
        parts.append("```mermaid")
        parts.append(mermaid_code)
        parts.append("```")

    return "\n".join(parts)


async def _generate_image(prompt: str, api_key: str, model: str) -> list[str]:
    """Generate image via OpenRouter."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://deepthink.app",
        "X-Title": "DeepThink",
    }

    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "modalities": ["text", "image"],
        "max_tokens": 4096,
    }

    try:
        client = _get_client(120.0)
        resp = await client.post(OPENROUTER_URL, headers=headers, json=body)
        resp.raise_for_status()
        data = resp.json()

        images: list[str] = []
        for choice in data.get("choices", []):
            msg = choice.get("message", {})
            for img in msg.get("images", []):
                url = img.get("image_url", {}).get("url", "")
                if url:
                    images.append(url)
            # Fallback: check content for base64
            if not images and msg.get("content"):
                b64_matches = re.findall(r'data:image/[^;]+;base64,[A-Za-z0-9+/=]+', msg["content"])
                images.extend(b64_matches)
        return images
    except Exception as e:
        logger.error("Infographic image generation failed: %s", e)
        return []
