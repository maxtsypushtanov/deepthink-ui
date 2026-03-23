"""Base LLM provider interface."""

from __future__ import annotations

import httpx
import json
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import AsyncIterator

logger = logging.getLogger(__name__)


@dataclass
class LLMMessage:
    role: str
    content: str


@dataclass
class LLMRequest:
    messages: list[LLMMessage]
    model: str
    temperature: float = 0.7
    max_tokens: int = 4096
    stream: bool = True
    stop: list[str] | None = None


@dataclass
class LLMChunk:
    """A single chunk from streaming response."""
    content: str = ""
    finish_reason: str | None = None
    usage: dict = field(default_factory=dict)


@dataclass
class LLMResponse:
    """Full (non-streaming) response."""
    content: str
    finish_reason: str = "stop"
    usage: dict = field(default_factory=dict)
    model: str = ""


class BaseLLMProvider(ABC):
    """Abstract base for all LLM providers."""

    name: str = "base"
    base_url: str = ""
    api_key: str = ""

    def __init__(self, api_key: str, base_url: str | None = None):
        self.api_key = api_key
        if base_url:
            self.base_url = base_url

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _build_body(self, req: LLMRequest) -> dict:
        body: dict = {
            "model": req.model,
            "messages": [{"role": m.role, "content": m.content} for m in req.messages],
            "temperature": req.temperature,
            "max_tokens": req.max_tokens,
            "stream": req.stream,
        }
        if req.stop:
            body["stop"] = req.stop
        return body

    async def complete(self, req: LLMRequest) -> LLMResponse:
        """Non-streaming completion."""
        req.stream = False
        url = f"{self.base_url}/chat/completions"
        body = self._build_body(req)
        logger.warning("[LLM REQUEST] POST %s | model=%s | body=%s", url, body.get("model"), json.dumps(body, ensure_ascii=False, default=str)[:2000])
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(url, headers=self._headers(), json=body)
            if resp.status_code >= 400:
                logger.error("LLM API error %s: %s", resp.status_code, resp.text[:1000])
            resp.raise_for_status()
            data = resp.json()

        choices = data.get("choices")
        if not choices or len(choices) == 0:
            raise ValueError(f"Provider returned empty choices. Response: {data}")
        choice = choices[0]
        message = choice.get("message") or {}
        return LLMResponse(
            content=message.get("content", ""),
            finish_reason=choice.get("finish_reason", "stop"),
            usage=data.get("usage", {}),
            model=data.get("model", req.model),
        )

    async def stream(self, req: LLMRequest) -> AsyncIterator[LLMChunk]:
        """Streaming completion yielding chunks."""
        req.stream = True
        url = f"{self.base_url}/chat/completions"
        body = self._build_body(req)
        logger.warning("[LLM REQUEST] POST (stream) %s | model=%s | body=%s", url, body.get("model"), json.dumps(body, ensure_ascii=False, default=str)[:2000])
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream("POST", url, headers=self._headers(), json=body) as resp:
                if resp.status_code >= 400:
                    error_body = await resp.aread()
                    logger.error("LLM API error %s: %s", resp.status_code, error_body.decode()[:1000])
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    payload = line[6:].strip()
                    if payload == "[DONE]":
                        return
                    try:
                        data = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    choices = data.get("choices")
                    if not choices:
                        continue
                    choice = choices[0]
                    delta = choice.get("delta", {})
                    yield LLMChunk(
                        content=delta.get("content", ""),
                        finish_reason=choice.get("finish_reason"),
                        usage=data.get("usage", {}),
                    )
