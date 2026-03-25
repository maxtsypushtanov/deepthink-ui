"""Provider registry — factory for LLM providers."""

from __future__ import annotations

import ipaddress
import re
import urllib.parse

from app.providers.base import BaseLLMProvider


def _is_internal_url(url: str) -> bool:
    """Return True if the URL points to an internal/private IP range."""
    parsed = urllib.parse.urlparse(url)
    hostname = parsed.hostname or ""

    # Block localhost variants
    if hostname in ("localhost", ""):
        return True

    # Try to resolve as IP address
    try:
        addr = ipaddress.ip_address(hostname)
        return addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved
    except ValueError:
        pass

    # Block common internal hostnames patterns
    if re.match(r'^(10|127|169\.254)\.\d+\.\d+\.\d+$', hostname):
        return True

    return False


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
    base_url = "https://api.deepseek.com/v1"


class CloudRuProvider(BaseLLMProvider):
    name = "cloudru"
    base_url = "https://api.cloud.ru/v1"


class CustomProvider(BaseLLMProvider):
    name = "custom"

    def __init__(self, api_key: str, base_url: str | None = None):
        url = base_url or "http://localhost:11434/v1"
        url = url.rstrip("/")
        if not url.startswith(("http://", "https://")):
            raise ValueError(f"base_url must start with http:// or https://, got: {url}")
        # SSRF protection: block internal/private IP ranges (allow localhost default only)
        if base_url is not None and _is_internal_url(url):
            raise ValueError(
                f"base_url must not point to internal/private networks: {url}"
            )
        super().__init__(api_key, url)


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
