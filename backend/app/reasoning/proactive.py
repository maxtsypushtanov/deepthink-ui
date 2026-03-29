"""Proactive Agent — a living assistant that initiates conversations.

Not a notification system. A thoughtful colleague who drops a message when relevant.

Triggers:
1. Morning briefing (09:00) — plan the day
2. Meeting prep (30 min before) — context + recommendations
3. Follow-up (next day after important conversation) — "How did it go?"
4. Goal check-in (weekly) — progress on stated goals
5. Insight (when idle) — share an observation based on user's interests
6. End of day (18:00) — summary + tomorrow preview
7. Pattern insight — recurring topics across conversations
8. Trending insight — web-enhanced proactive (Brave Search)
9. Productivity nudge — smart timing based on user habits
"""

from __future__ import annotations

import json
import logging
import os
import random
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from app.db import calendar as cal_db
from app.db import database as db
from app.providers.base import LLMMessage, LLMRequest

logger = logging.getLogger(__name__)

# State tracking — prevents duplicate messages
_state: dict[str, Any] = {
    "last_morning": None,      # date string
    "last_evening": None,      # date string
    "last_reminder_id": None,  # event id
    "last_reminder_at": None,  # datetime
    "last_followup": None,     # date string
    "last_insight": None,      # datetime
    "last_check": None,        # datetime (prevents rapid polling)
    "last_pattern": None,      # date string
    "last_trending": None,     # date string
    "last_nudge": None,        # date string
    # Accumulated conversation start hours for productivity nudge
    "conversation_hours": [],  # list of (hour, minute) tuples
}


def _state_file_path() -> Path:
    """Return path to the proactive state JSON file."""
    from app.core.config import settings
    db_dir = Path(settings.db_path).parent if settings.db_path else Path(".")
    return db_dir / "proactive_state.json"


def _load_state() -> None:
    """Load persisted state from JSON file on startup."""
    path = _state_file_path()
    if not path.exists():
        return
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        # Restore datetime fields
        for key in ("last_reminder_at", "last_insight", "last_check"):
            if data.get(key):
                try:
                    data[key] = datetime.fromisoformat(data[key])
                except (ValueError, TypeError):
                    data[key] = None
        # Restore conversation_hours as list of tuples
        if "conversation_hours" in data and isinstance(data["conversation_hours"], list):
            data["conversation_hours"] = [
                tuple(pair) if isinstance(pair, list) else pair
                for pair in data["conversation_hours"]
            ]
        _state.update(data)
        logger.debug("Loaded proactive state from %s", path)
    except Exception:
        logger.warning("Failed to load proactive state", exc_info=True)


def _save_state() -> None:
    """Persist current state to JSON file."""
    path = _state_file_path()
    try:
        serializable: dict[str, Any] = {}
        for key, value in _state.items():
            if isinstance(value, datetime):
                serializable[key] = value.isoformat()
            elif isinstance(value, list):
                serializable[key] = [list(item) if isinstance(item, tuple) else item for item in value]
            else:
                serializable[key] = value
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(serializable, f, ensure_ascii=False, indent=2)
    except Exception:
        logger.warning("Failed to save proactive state", exc_info=True)


# Load persisted state on module import
_load_state()


async def check_proactive(provider=None, model: str | None = None) -> dict | None:
    """Main entry point. Returns a proactive message or None.

    Called by frontend every 5 minutes via /api/proactive/check.
    """
    now = datetime.now()

    # Rate limit: max once per 3 minutes
    if _state["last_check"] and (now - _state["last_check"]).total_seconds() < 180:
        return None
    _state["last_check"] = now
    _save_state()

    today = now.strftime("%Y-%m-%d")

    if not provider or not model:
        return None

    # Priority order — first match wins

    # 1. Morning briefing: 8:30–10:00, once per day
    if 8 <= now.hour < 10 and _state["last_morning"] != today:
        msg = await _morning_briefing(now, provider, model)
        if msg:
            _state["last_morning"] = today
            _save_state()
            return msg

    # 2. Meeting reminder: 15-35 min before next event
    if _state["last_reminder_at"] is None or (now - _state["last_reminder_at"]).total_seconds() > 1500:
        msg = await _meeting_reminder(now, provider, model)
        if msg:
            return msg

    # 3. End of day summary: 17:30–19:00, once per day
    if 17 <= now.hour < 19 and _state["last_evening"] != today:
        msg = await _evening_summary(now, provider, model)
        if msg:
            _state["last_evening"] = today
            _save_state()
            return msg

    # 4. Follow-up on yesterday's conversations (once per day, 10:00-12:00)
    if 10 <= now.hour < 12 and _state["last_followup"] != today:
        msg = await _conversation_followup(now, provider, model)
        if msg:
            _state["last_followup"] = today
            _save_state()
            return msg

    # 5. Pattern insight (once per day, 11:00-16:00)
    if 11 <= now.hour < 16 and _state["last_pattern"] != today:
        msg = await _pattern_insight(now, provider, model)
        if msg:
            _state["last_pattern"] = today
            _save_state()
            return msg

    # 6. Productivity nudge (once per day, early in user's productive window)
    if _state["last_nudge"] != today:
        msg = await _productivity_nudge(now, provider, model)
        if msg:
            _state["last_nudge"] = today
            _save_state()
            return msg

    # 7. Trending insight (once per day, 12:00-17:00)
    if 12 <= now.hour < 17 and _state["last_trending"] != today:
        msg = await _trending_insight(now, provider, model)
        if msg:
            _state["last_trending"] = today
            _save_state()
            return msg

    # 8. Insight (when idle, max once per 3 hours, 10:00-20:00)
    if 10 <= now.hour < 20:
        if _state["last_insight"] is None or (now - _state["last_insight"]).total_seconds() > 10800:
            msg = await _idle_insight(now, provider, model)
            if msg:
                _state["last_insight"] = now
                _save_state()
                return msg

    return None


# ── Trigger Implementations ──

async def _morning_briefing(now: datetime, provider, model: str) -> dict | None:
    today = now.strftime("%Y-%m-%d")
    events = await cal_db.list_events(f"{today}T00:00:00", f"{today}T23:59:59")
    free = await cal_db.find_free_slots(today)
    profile = await _get_profile()

    events_text = "\n".join(
        f"- {e['start_time'][11:16]}–{e['end_time'][11:16]}: {e['title']}"
        for e in events
    ) if events else "Нет запланированных встреч"

    free_text = ", ".join(f"{s['start'][11:16]}–{s['end'][11:16]}" for s in free[:4]) if free else "Нет"

    prompt = f"""Составь короткое утреннее сообщение (3-4 предложения).
{profile}
Расписание на сегодня:\n{events_text}
Свободные слоты: {free_text}

Тон: как умный друг-секретарь. Поприветствуй по имени если знаешь. Упомяни ключевые встречи. Если день свободный — предложи запланировать.
Пиши ТОЛЬКО финальное сообщение, без тегов."""

    text = await _gen(prompt, provider, model)
    return {"type": "morning", "icon": "sun", "message": text} if text else None


async def _meeting_reminder(now: datetime, provider, model: str) -> dict | None:
    upcoming = await _upcoming_events(now, 35)
    if not upcoming:
        return None

    ev = upcoming[0]
    if ev["id"] == _state["last_reminder_id"]:
        return None

    try:
        minutes = int((datetime.fromisoformat(ev["start_time"]) - now).total_seconds() / 60)
    except ValueError:
        minutes = 30

    profile = await _get_profile()
    desc = ev.get("description", "")

    prompt = f"""Через {minutes} мин встреча: «{ev['title']}» ({ev['start_time'][11:16]}–{ev['end_time'][11:16]}).
{f'Описание: {desc}' if desc else ''}
{profile}
Напиши 1-2 предложения: напомни + если есть описание, дай совет по подготовке. Тон ненавязчивый, полезный.
Пиши ТОЛЬКО финальное сообщение."""

    text = await _gen(prompt, provider, model)
    if text:
        _state["last_reminder_id"] = ev["id"]
        _state["last_reminder_at"] = now
        _save_state()
        return {"type": "reminder", "icon": "calendar", "message": text}
    return None


async def _evening_summary(now: datetime, provider, model: str) -> dict | None:
    today = now.strftime("%Y-%m-%d")
    events = await cal_db.list_events(f"{today}T00:00:00", f"{today}T23:59:59")
    tomorrow = (now + timedelta(days=1)).strftime("%Y-%m-%d")
    tomorrow_events = await cal_db.list_events(f"{tomorrow}T00:00:00", f"{tomorrow}T23:59:59")
    profile = await _get_profile()

    today_text = "\n".join(f"- {e['title']}" for e in events) if events else "Ничего"
    tomorrow_text = "\n".join(
        f"- {e['start_time'][11:16]}: {e['title']}" for e in tomorrow_events
    ) if tomorrow_events else "Пока пусто"

    # Count today's conversations
    convs = await db.list_conversations()
    today_convs = [c for c in convs if c.get("updated_at", "").startswith(today)]

    prompt = f"""Составь короткое вечернее сообщение (2-3 предложения).
{profile}
Сегодня было: {len(events)} встреч, {len(today_convs)} диалогов.
Встречи сегодня: {today_text}
Завтра: {tomorrow_text}

Тон: тёплый, завершающий день. Подведи итог, упомяни что завтра. Если завтра пусто — предложи запланировать.
Пиши ТОЛЬКО финальное сообщение."""

    text = await _gen(prompt, provider, model)
    return {"type": "evening", "icon": "moon", "message": text} if text else None


async def _conversation_followup(now: datetime, provider, model: str) -> dict | None:
    """Follow up on yesterday's important conversations."""
    yesterday = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    convs = await db.list_conversations()
    yesterday_convs = [c for c in convs if c.get("updated_at", "").startswith(yesterday)]

    if not yesterday_convs:
        return None

    # Pick the longest/most important conversation from yesterday
    best = max(yesterday_convs, key=lambda c: len(c.get("title", "")))
    title = best.get("title", "")
    if len(title) < 10:
        return None

    profile = await _get_profile()

    prompt = f"""Вчера пользователь обсуждал тему: «{title[:80]}».
{profile}
Напиши 1 предложение — дружеский follow-up: спроси как дела с этой темой, или предложи продолжить.
Тон: как коллега, который помнит вчерашний разговор. Естественно, не формально.
Пиши ТОЛЬКО финальное сообщение."""

    text = await _gen(prompt, provider, model)
    return {"type": "followup", "icon": "message", "message": text} if text else None


async def _idle_insight(now: datetime, provider, model: str) -> dict | None:
    """Share an insight based on user's interests. Random 30% chance."""
    if random.random() > 0.3:
        return None

    profile = await _get_profile()
    if not profile or len(profile) < 50:
        return None  # Not enough data about user

    memories = await db.get_user_memory("interests")
    if not memories:
        memories = await db.get_user_memory("expertise")
    if not memories:
        return None

    topic = random.choice(memories)
    topic_text = f"{topic['key']}: {topic['value']}"

    prompt = f"""Пользователь интересуется: {topic_text}
{profile}
Поделись одним коротким интересным фактом, наблюдением или вопросом по этой теме (1-2 предложения).
Не будь навязчивым. Как будто вспомнил что-то любопытное и решил поделиться.
Пиши ТОЛЬКО финальное сообщение."""

    text = await _gen(prompt, provider, model)
    return {"type": "insight", "icon": "sparkle", "message": text} if text else None


# ── 7. Pattern Detection ──

# Common Russian stop words to filter out
_STOP_WORDS = frozenset({
    "и", "в", "на", "с", "по", "для", "от", "из", "к", "за", "до",
    "не", "но", "а", "что", "как", "это", "то", "я", "мы", "ты",
    "он", "она", "они", "мне", "меня", "тебя", "тебе", "нам",
    "всё", "все", "его", "её", "их", "мой", "твой", "наш", "ваш",
    "был", "была", "было", "были", "быть", "будет", "есть",
    "можно", "нужно", "надо", "уже", "ещё", "еще", "тоже", "также",
    "если", "когда", "где", "кто", "чем", "или", "ли", "бы",
    "очень", "просто", "так", "там", "тут", "здесь", "этот", "эта",
    "the", "a", "an", "is", "are", "was", "were", "be", "been",
    "have", "has", "had", "do", "does", "did", "will", "would",
    "can", "could", "should", "may", "might", "must",
    "i", "you", "he", "she", "it", "we", "they", "me", "him", "her",
    "my", "your", "his", "its", "our", "their",
    "in", "on", "at", "to", "for", "of", "with", "from", "by",
    "and", "or", "but", "not", "if", "this", "that", "what", "how",
})


def _extract_keywords(text: str) -> list[str]:
    """Extract meaningful keywords from text, filtering stop words."""
    # Normalize
    text = text.lower().strip()
    # Split into words, keep only alphanumeric + cyrillic
    words = re.findall(r'[a-zA-Zа-яёА-ЯЁ]{3,}', text)
    # Filter stop words and very short tokens
    return [w for w in words if w not in _STOP_WORDS and len(w) >= 3]


def _extract_ngrams(text: str, n: int = 2) -> list[str]:
    """Extract n-grams (bigrams by default) from text."""
    words = _extract_keywords(text)
    if len(words) < n:
        return words
    ngrams = []
    for i in range(len(words) - n + 1):
        ngrams.append(" ".join(words[i:i + n]))
    return ngrams


def detect_patterns(
    conversations: list[dict],
    messages_by_conv: dict[str, list[dict]],
    days: int = 7,
    min_occurrences: int = 3,
) -> list[dict]:
    """Analyze recent conversations for recurring themes.

    Args:
        conversations: List of conversation dicts with 'id', 'title', 'updated_at'.
        messages_by_conv: Dict mapping conversation_id -> list of message dicts.
        days: How many days back to look.
        min_occurrences: Minimum number of different conversations a topic
                         must appear in to be considered a pattern.

    Returns:
        List of dicts with 'topic', 'count', 'conversations' (list of titles).
    """
    cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    # Filter to recent conversations
    recent = [
        c for c in conversations
        if c.get("updated_at", "") >= cutoff
    ]

    if len(recent) < min_occurrences:
        return []

    # Count keywords and bigrams per conversation (deduplicated per conversation)
    topic_conversations: dict[str, set[str]] = defaultdict(set)  # topic -> set of conv titles

    for conv in recent:
        conv_id = conv.get("id", "")
        conv_title = conv.get("title", "")
        messages = messages_by_conv.get(conv_id, [])

        # Gather text from title + user messages
        texts = [conv_title]
        for msg in messages:
            if msg.get("role") == "user":
                content = msg.get("content", "")
                if isinstance(content, str):
                    texts.append(content[:500])  # limit per message

        combined = " ".join(texts)

        # Extract both unigrams and bigrams
        unigrams = _extract_keywords(combined)
        bigrams = _extract_ngrams(combined, 2)

        # Deduplicate within this conversation, then track
        seen = set()
        for token in bigrams + unigrams:
            if token not in seen:
                seen.add(token)
                topic_conversations[token].add(conv_title or conv_id)

    # Find topics appearing across min_occurrences different conversations
    patterns = []
    seen_topics: set[str] = set()

    # Sort by count descending, prefer bigrams (longer = more specific)
    sorted_topics = sorted(
        topic_conversations.items(),
        key=lambda x: (-len(x[1]), -len(x[0])),
    )

    for topic, conv_titles in sorted_topics:
        if len(conv_titles) < min_occurrences:
            continue

        # Skip if a broader topic already covers this
        skip = False
        for seen in seen_topics:
            if topic in seen or seen in topic:
                skip = True
                break
        if skip:
            continue

        seen_topics.add(topic)
        patterns.append({
            "topic": topic,
            "count": len(conv_titles),
            "conversations": sorted(conv_titles)[:5],
        })

        # Limit patterns returned
        if len(patterns) >= 3:
            break

    return patterns


async def _pattern_insight(now: datetime, provider, model: str) -> dict | None:
    """Detect recurring patterns in recent conversations and generate an insight."""
    # Random 40% chance to avoid being too frequent
    if random.random() > 0.4:
        return None

    convs = await db.list_conversations()
    if len(convs) < 5:
        return None  # Not enough data

    # Load messages for recent conversations (last 7 days)
    cutoff = (now - timedelta(days=7)).strftime("%Y-%m-%d")
    recent_convs = [c for c in convs if c.get("updated_at", "") >= cutoff]

    if len(recent_convs) < 3:
        return None

    # Load messages — limit to 20 most recent conversations to avoid heavy queries
    messages_by_conv: dict[str, list[dict]] = {}
    for conv in recent_convs[:20]:
        conv_id = conv.get("id", "")
        if conv_id:
            try:
                msgs = await db.get_messages(conv_id)
                messages_by_conv[conv_id] = msgs
            except Exception:
                continue

    patterns = detect_patterns(recent_convs, messages_by_conv)
    if not patterns:
        return None

    # Pick the strongest pattern
    pattern = patterns[0]
    profile = await _get_profile()

    titles_text = ", ".join(f"«{t[:40]}»" for t in pattern["conversations"][:3])

    prompt = f"""Ты заметил паттерн: тема «{pattern['topic']}» появилась {pattern['count']} раз за последнюю неделю в разных диалогах ({titles_text}).
{profile}
Напиши 1-2 предложения: отметь этот паттерн и предложи конкретное действие (написать RFC, создать шаблон, изучить глубже, и т.д.).
Тон: как внимательный коллега, который заметил повторяющуюся тему. Не навязчиво.
Пиши ТОЛЬКО финальное сообщение."""

    text = await _gen(prompt, provider, model)
    return {"type": "pattern_insight", "icon": "repeat", "message": text} if text else None


# ── 8. Web-Enhanced Proactive (Trending Insight) ──

async def _trending_insight(now: datetime, provider, model: str) -> dict | None:
    """Search for trending news related to user's interests via Brave Search."""
    # Random 25% chance — max once per day already enforced by caller
    if random.random() > 0.25:
        return None

    # Check if Brave Search API key is available
    try:
        from app.core.config import settings
        api_key = settings.brave_search_api_key
    except Exception:
        return None

    if not api_key:
        return None

    # Get user interests from memory
    interests = await db.get_user_memory("expertise")
    if not interests:
        interests = await db.get_user_memory("interests")
    if not interests:
        interests = await db.get_user_memory("goals")
    if not interests:
        return None

    # Build search query from top interests
    top_interests = interests[:3]
    query_parts = []
    for mem in top_interests:
        key = mem.get("key", "")
        value = mem.get("value", "")
        # Use the more descriptive of key/value
        part = value if len(value) > len(key) else key
        query_parts.append(part[:30])

    search_query = " ".join(query_parts[:2]) + " новости"

    # Perform search
    try:
        from app.tools.web_search import brave_search, format_search_results
        results = await brave_search(
            query=search_query,
            api_key=api_key,
            count=3,
            freshness="pw",  # past week
        )
    except Exception as e:
        logger.warning("Trending insight search failed: %s", e)
        return None

    if not results or not results.get("results"):
        return None

    # Format results for LLM
    results_text = ""
    for r in results["results"][:3]:
        title = r.get("title", "")
        description = r.get("description", "")
        url = r.get("url", "")
        results_text += f"- {title}: {description[:100]} ({url})\n"

    if not results_text:
        return None

    profile = await _get_profile()
    interests_text = ", ".join(
        f"{m.get('key', '')}" for m in top_interests
    )

    prompt = f"""Ты нашёл свежие статьи, потенциально интересные пользователю.
Интересы пользователя: {interests_text}
{profile}

Найденные статьи:
{results_text}

Если хотя бы одна статья действительно релевантна интересам пользователя — напиши 1-2 предложения: упомяни находку и почему она может быть интересна.
Если ни одна не релевантна — ответь ТОЛЬКО словом "SKIP".
Тон: как коллега, который наткнулся на интересную статью и решил поделиться.
Пиши ТОЛЬКО финальное сообщение (или SKIP)."""

    text = await _gen(prompt, provider, model)
    if not text or "SKIP" in text.upper():
        return None
    return {"type": "trending_insight", "icon": "globe", "message": text}


# ── 9. Productivity Nudge ──

def _detect_productive_window(conversation_hours: list[tuple[int, int]]) -> tuple[int, int] | None:
    """Detect user's typical productive window from conversation start times.

    Returns (start_hour, end_hour) of the most active 3-hour window, or None.
    """
    if len(conversation_hours) < 5:
        return None

    # Count conversations per hour
    hour_counts: Counter[int] = Counter()
    for h, _ in conversation_hours:
        hour_counts[h] += 1

    if not hour_counts:
        return None

    # Find the 3-hour window with the most conversations
    best_start = 9
    best_count = 0
    for start in range(6, 22):  # 6:00 to 21:00
        window_count = sum(hour_counts.get(h, 0) for h in range(start, start + 3))
        if window_count > best_count:
            best_count = window_count
            best_start = start

    if best_count < 3:
        return None

    return (best_start, best_start + 3)


async def _productivity_nudge(now: datetime, provider, model: str) -> dict | None:
    """Nudge user at the start of their productive window if they have unfinished topics."""
    # Accumulate conversation start hours from recent data
    convs = await db.list_conversations()
    if len(convs) < 5:
        return None

    # Build conversation hours from last 30 days
    cutoff = (now - timedelta(days=30)).strftime("%Y-%m-%d")
    recent_convs = [c for c in convs if c.get("updated_at", "") >= cutoff]

    conversation_hours: list[tuple[int, int]] = []
    for c in recent_convs:
        created = c.get("created_at", "")
        if len(created) >= 16:
            try:
                h = int(created[11:13])
                m = int(created[14:16])
                conversation_hours.append((h, m))
            except (ValueError, IndexError):
                continue

    # Store for future use
    _state["conversation_hours"] = conversation_hours

    # Detect productive window
    window = _detect_productive_window(conversation_hours)
    if window is None:
        return None

    start_hour, end_hour = window

    # Only nudge if we're in the first 30 minutes of the productive window
    if not (now.hour == start_hour and now.minute < 30):
        return None

    # Random 50% chance — don't nudge every day
    if random.random() > 0.5:
        return None

    # Find unfinished topics from yesterday or recent days
    yesterday = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    two_days_ago = (now - timedelta(days=2)).strftime("%Y-%m-%d")

    recent_topics = [
        c for c in convs
        if c.get("updated_at", "") >= two_days_ago
        and c.get("updated_at", "") < now.strftime("%Y-%m-%d")
    ]

    if not recent_topics:
        return None

    # Pick the most recent meaningful conversation
    best = max(recent_topics, key=lambda c: c.get("updated_at", ""))
    title = best.get("title", "")
    if len(title) < 8:
        return None

    profile = await _get_profile()
    time_str = now.strftime("%H:%M")

    # Check calendar for free time
    today = now.strftime("%Y-%m-%d")
    events = await cal_db.list_events(
        f"{today}T{now.strftime('%H:%M')}:00",
        f"{today}T{end_hour:02d}:00:00",
    )

    if events:
        free_until = events[0].get("start_time", "")[11:16]
        time_context = f"У тебя свободно до {free_until}."
    else:
        time_context = f"У тебя свободно до {end_hour:02d}:00."

    prompt = f"""Сейчас {time_str}. {time_context}
Недавно пользователь работал над темой: «{title[:80]}».
{profile}
Напиши 1 предложение: мягко предложи продолжить работу над этой темой, упомяни свободное время.
Тон: как внимательный друг, который знает расписание. Не навязчиво — это предложение, не приказ.
Пиши ТОЛЬКО финальное сообщение."""

    text = await _gen(prompt, provider, model)
    return {"type": "productivity_nudge", "icon": "clock", "message": text} if text else None


# ── Helpers ──

async def _get_profile() -> str:
    from app.reasoning.memory import get_user_profile_prompt
    p = await get_user_profile_prompt()
    return p or ""


async def _upcoming_events(now: datetime, minutes: int) -> list[dict]:
    start = now.isoformat()
    end = (now + timedelta(minutes=minutes)).isoformat()
    events = await cal_db.list_events(start, end)
    return [e for e in events if datetime.fromisoformat(e["start_time"]) > now]


async def _gen(prompt: str, provider, model: str) -> str | None:
    try:
        req = LLMRequest(
            messages=[LLMMessage(role="user", content=prompt)],
            model=model, temperature=0.7, max_tokens=200,
        )
        resp = await provider.complete(req)
        return resp.content.strip() if resp.content else None
    except Exception as e:
        logger.warning("Proactive gen failed: %s", e)
        return None
