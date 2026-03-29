"""Brave Search API integration for web search."""

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

BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"

# Patterns that suggest user wants fresh/real-time information
SEARCH_TRIGGER_PATTERNS = re.compile(
    r'(?:что (?:случилось|произошло|нового)|последние новости|сегодня|вчера|'
    r'курс (?:доллара|евро|биткоина|валют)|погода|текущ|актуальн|свежи|'
    r'найди в интернете|загугли|поищи|посмотри в сети|'
    r'кто (?:выиграл|победил|стал)|результат[ыа]? матч|счёт|'
    r'последняя версия|latest|current|recent|today|yesterday|'
    r'what happened|search for|look up|google|find online|'
    r'цена|стоимость|stock price|market|'
    r'новый закон|изменени[яе] в|обновлени[яе]|релиз|вышел|вышла|'
    r'сколько сейчас|сколько стоит|когда будет|когда выйдет)',
    re.IGNORECASE,
)


def needs_web_search(query: str) -> bool:
    """Heuristic: does this query likely need fresh web data?"""
    return bool(SEARCH_TRIGGER_PATTERNS.search(query))


async def brave_search(
    query: str,
    api_key: str,
    count: int = 5,
    freshness: str | None = None,
) -> dict[str, Any]:
    """Search the web via Brave Search API.

    Args:
        query: Search query
        api_key: Brave Search API key
        count: Number of results (max 20)
        freshness: Filter by freshness: pd (past day), pw (past week), pm (past month), py (past year)

    Returns:
        Dict with 'results' list and 'query' string
    """
    headers = {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": api_key,
    }
    params: dict[str, Any] = {
        "q": query,
        "count": min(count, 20),
        "search_lang": "ru",
        "ui_lang": "ru-RU",
    }
    if freshness:
        params["freshness"] = freshness

    client = _get_client(15.0)
    resp = await client.get(BRAVE_SEARCH_URL, headers=headers, params=params)
    resp.raise_for_status()
    data = resp.json()

    results = []
    for item in data.get("web", {}).get("results", []):
        results.append({
            "title": item.get("title", ""),
            "url": item.get("url", ""),
            "description": item.get("description", ""),
            "age": item.get("age", ""),
        })

    # Also grab infobox if present
    infobox = None
    if data.get("infobox"):
        ib = data["infobox"]
        infobox = {
            "title": ib.get("title", ""),
            "description": ib.get("long_desc") or ib.get("description", ""),
            "url": ib.get("url", ""),
        }

    # News results
    news = []
    for item in data.get("news", {}).get("results", [])[:3]:
        news.append({
            "title": item.get("title", ""),
            "url": item.get("url", ""),
            "description": item.get("description", ""),
            "age": item.get("age", ""),
        })

    return {
        "query": query,
        "results": results,
        "news": news,
        "infobox": infobox,
    }


def format_search_results(data: dict[str, Any]) -> str:
    """Format search results as text for LLM context injection."""
    parts = []

    if data.get("infobox"):
        ib = data["infobox"]
        parts.append(f"## {ib['title']}\n{ib['description']}\nИсточник: {ib['url']}")

    if data.get("news"):
        parts.append("## Свежие новости:")
        for n in data["news"]:
            age = f" ({n['age']})" if n.get("age") else ""
            parts.append(f"- **{n['title']}**{age}\n  {n['description']}\n  {n['url']}")

    if data.get("results"):
        parts.append("## Результаты поиска:")
        for r in data["results"]:
            age = f" ({r['age']})" if r.get("age") else ""
            parts.append(f"- **{r['title']}**{age}\n  {r['description']}\n  {r['url']}")

    return "\n\n".join(parts) if parts else "Ничего не найдено."
