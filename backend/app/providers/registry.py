"""Provider registry — factory for LLM providers."""

from __future__ import annotations

from app.providers.base import BaseLLMProvider


class OpenRouterProvider(BaseLLMProvider):
    name = "openrouter"
    base_url = "https://openrouter.ai/api/v1"

    def _headers(self) -> dict:
        h = super()._headers()
        h["HTTP-Referer"] = "https://deepthink-ui.local"
        h["X-Title"] = "DeepThink UI"
        return h


class DeepSeekProvider(BaseLLMProvider):
    name = "deepseek"
    base_url = "https://api.deepseek.com"


class CloudRuProvider(BaseLLMProvider):
    name = "cloudru"
    base_url = "https://api.cloud.ru/v1"

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }


class CustomProvider(BaseLLMProvider):
    name = "custom"

    def __init__(self, api_key: str, base_url: str | None = None):
        super().__init__(api_key, base_url or "http://localhost:11434/v1")


PROVIDERS: dict[str, type[BaseLLMProvider]] = {
    "openrouter": OpenRouterProvider,
    "deepseek": DeepSeekProvider,
    "cloudru": CloudRuProvider,
    "custom": CustomProvider,
}


def get_provider(name: str, api_key: str, base_url: str | None = None) -> BaseLLMProvider:
    """Instantiate a provider by name."""
    cls = PROVIDERS.get(name)
    if not cls:
        raise ValueError(f"Unknown provider: {name}. Available: {list(PROVIDERS.keys())}")
    return cls(api_key=api_key, base_url=base_url)
