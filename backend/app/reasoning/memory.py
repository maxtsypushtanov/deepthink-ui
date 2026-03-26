"""Cognitive Memory — automatic user profiling from conversations.

TRIZ Principle #26 "Copying": Instead of storing raw conversation history,
extract a compressed cognitive model (~200 tokens) that captures WHO the user is.

TRIZ Principle #15 "Dynamism": The profile evolves with every conversation,
strengthening confirmed signals and decaying stale ones.

Categories:
- expertise: domain-specific knowledge level (e.g., "python: advanced")
- preferences: how the user likes responses (e.g., "prefers code over explanation")
- style: communication patterns (e.g., "terse, uses Russian slang")
- context: current projects/goals (e.g., "building a chat platform")
- topics: recurring interests (e.g., "machine learning, TRIZ methodology")
"""

from __future__ import annotations

import logging
import re
from collections import Counter

from app.db import database as db
from app.providers.base import LLMMessage

logger = logging.getLogger(__name__)


# ── Signal Extractors (pure heuristics, zero LLM calls) ──

def extract_expertise_signals(messages: list[LLMMessage]) -> dict[str, str]:
    """Detect domain expertise from vocabulary density."""
    user_text = " ".join(m.content for m in messages if m.role == "user").lower()
    words = user_text.split()
    if len(words) < 5:
        return {}

    DOMAIN_TERMS = {
        "python": ["python", "django", "flask", "fastapi", "pip", "venv", "pytest", "asyncio", "pydantic"],
        "javascript": ["javascript", "react", "vue", "angular", "npm", "webpack", "typescript", "node", "next.js"],
        "devops": ["docker", "kubernetes", "k8s", "ci/cd", "nginx", "terraform", "aws", "gcp", "deploy"],
        "ml": ["model", "training", "dataset", "neural", "transformer", "embedding", "fine-tune", "gpu", "pytorch", "tensorflow"],
        "database": ["sql", "postgres", "mongodb", "redis", "orm", "migration", "index", "query", "schema"],
        "math": ["теорема", "доказательство", "интеграл", "матрица", "вектор", "производная", "лемма"],
        "business": ["roi", "kpi", "стратегия", "метрик", "воронк", "конверси", "unit-экономик"],
    }

    signals = {}
    for domain, terms in DOMAIN_TERMS.items():
        count = sum(1 for t in terms if t in user_text)
        density = count / len(words)
        if count >= 3 or density > 0.02:
            level = "advanced" if count >= 5 or density > 0.05 else "intermediate"
            signals[domain] = level

    return signals


def extract_style_signals(messages: list[LLMMessage]) -> dict[str, str]:
    """Detect communication style from user messages."""
    user_msgs = [m.content for m in messages if m.role == "user"]
    if not user_msgs:
        return {}

    signals = {}
    avg_len = sum(len(m.split()) for m in user_msgs) / len(user_msgs)

    if avg_len < 10:
        signals["verbosity"] = "terse"
    elif avg_len > 50:
        signals["verbosity"] = "detailed"

    # Language detection
    all_text = " ".join(user_msgs)
    cyrillic = len(re.findall(r'[а-яА-ЯёЁ]', all_text))
    latin = len(re.findall(r'[a-zA-Z]', all_text))
    if cyrillic > latin * 2:
        signals["language"] = "Russian"
    elif latin > cyrillic * 2:
        signals["language"] = "English"
    else:
        signals["language"] = "mixed"

    # Code preference: does user include code in questions?
    code_msgs = sum(1 for m in user_msgs if '```' in m or 'def ' in m or 'function ' in m)
    if code_msgs > len(user_msgs) * 0.3:
        signals["includes_code"] = "often"

    # Question style
    questions = sum(1 for m in user_msgs if '?' in m)
    if questions > len(user_msgs) * 0.7:
        signals["question_style"] = "interrogative"
    elif questions < len(user_msgs) * 0.2:
        signals["question_style"] = "imperative"

    return signals


def extract_topic_signals(messages: list[LLMMessage]) -> list[str]:
    """Extract recurring topics from conversation."""
    user_text = " ".join(m.content for m in messages if m.role == "user").lower()

    # Extract meaningful n-grams (2-3 word phrases that appear multiple times)
    words = re.findall(r'[а-яёa-z]{3,}', user_text)
    bigrams = [f"{words[i]} {words[i+1]}" for i in range(len(words) - 1)]

    # Count and filter
    counter = Counter(bigrams)
    topics = [phrase for phrase, count in counter.most_common(10) if count >= 2]
    return topics[:5]


def extract_personal_signals(messages: list[LLMMessage]) -> dict[str, str]:
    """Extract personal info: name, role, company, etc."""
    user_text = " ".join(m.content for m in messages if m.role == "user")
    signals = {}

    # Name patterns: "меня зовут X", "я — X", "my name is X", "зови меня X"
    name_patterns = [
        r'(?:меня зовут|я —|я -|зови меня|моё имя|мое имя|я это)\s+([А-ЯЁA-Z][а-яёa-z]+(?:\s+[А-ЯЁA-Z][а-яёa-z]+)?)',
        r'(?:my name is|i\'m|i am|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)',
    ]
    for pattern in name_patterns:
        match = re.search(pattern, user_text, re.IGNORECASE)
        if match:
            signals["name"] = match.group(1).strip()[:30]
            break

    # Role patterns: "я работаю X", "моя роль — X", "my role is X"
    # Note: "я —" excluded to avoid matching names like "я — Мария"
    role_patterns = [
        r'(?:я работаю|моя (?:роль|должность|профессия))\s+(?:как\s+)?([а-яёa-z][а-яёa-z\s-]{2,30}?)(?:\.|,|$)',
        r'(?:i work as|my role is|i am a|i\'m a)\s+([a-z][a-z\s-]{2,30}?)(?:\.|,|$)',
    ]
    for pattern in role_patterns:
        match = re.search(pattern, user_text, re.IGNORECASE)
        if match:
            signals["role"] = match.group(1).strip()[:40]
            break

    # Company
    company_patterns = [
        r'(?:работаю в|компания|в компании|наша компания|my company|i work at|at)\s+[«"\']?([А-ЯЁA-Z][а-яёa-zA-Z\s.-]{1,30}?)(?:[»"\']|[\.,;]|\s+и\s|\s+на\s|$)',
    ]
    for pattern in company_patterns:
        match = re.search(pattern, user_text, re.IGNORECASE)
        if match:
            signals["company"] = match.group(1).strip()[:30]
            break

    return signals


def extract_context_signals(messages: list[LLMMessage]) -> dict[str, str]:
    """Detect current goals/projects from conversation content."""
    user_text = " ".join(m.content for m in messages if m.role == "user")
    signals = {}

    # Project/product mentions
    project_patterns = [
        r'(?:мой |наш |my |our )(?:проект|project|приложение|app|сервис|service|продукт|product)\s+[«"\']?(\w[\w\s-]{2,20})',
        r'(?:работаю над|building|developing|creating)\s+(.{5,30}?)(?:\.|,|$)',
    ]
    for pattern in project_patterns:
        match = re.search(pattern, user_text, re.IGNORECASE)
        if match:
            signals["current_project"] = match.group(1).strip()[:50]
            break

    # Deadline/urgency signals
    if re.search(r'(?:срочно|urgent|deadline|дедлайн|asap|быстр)', user_text, re.IGNORECASE):
        signals["urgency"] = "high"

    return signals


# ── Memory Agent Prompt ──

MEMORY_AGENT_PROMPT = """Ты — агент памяти платформы DeepThink. Твоя задача — проанализировать ПОЛНЫЙ диалог (и вопросы пользователя, и ответы ассистента) и извлечь значимые факты о пользователе для его когнитивного профиля.

Извлекай как ЯВНЫЕ факты, так и НЕЯВНЫЕ сигналы из контекста:
— Явное: "Меня зовут Дима" → personal: name: Дима
— Неявное: обсуждает архитектуру микросервисов с техническими деталями → expertise: backend_architecture: expert
— Неявное: задаёт вопросы о бизнес-метриках → interests: бизнес-аналитика
— Неявное: просит всё объяснять с примерами кода → preferences: format: с примерами кода

Категории фактов:
- personal: имя, возраст, город, страна, язык общения
- role: профессия, должность, компания, отрасль, размер команды
- expertise: навыки и уровень (beginner/intermediate/expert), технологии, фреймворки, методологии
- preferences: стиль ответов (кратко/подробно, формально/неформально, с кодом/без), предпочитаемые стратегии
- goals: текущие цели, проекты, задачи, дедлайны, проблемы которые решает
- interests: темы, которые интересуют, области в которых хочет разобраться

Формат ответа — строго JSON-массив (без markdown, без объяснений):
[
  {"category": "personal", "key": "name", "value": "Алексей"},
  {"category": "expertise", "key": "python", "value": "expert"},
  {"category": "goals", "key": "current_project", "value": "чат-бот для клиники"}
]

Если ничего значимого не найдено — верни пустой массив: []

Правила:
— Извлекай только НОВЫЕ факты, которых нет в текущем профиле
— Будь уверен в извлекаемом — не додумывай то, чего нельзя обоснованно вывести
— Один факт = один объект в массиве
— key должен быть коротким (1-3 слова, snake_case)
— value должно быть информативным и конкретным"""


# ── Main API ──

async def learn_from_conversation(
    conversation_id: str,
    messages: list[LLMMessage],
    provider=None,
    model: str | None = None,
) -> int:
    """Two-phase memory extraction:
    Phase 1: Fast regex extractors (free, instant)
    Phase 2: LLM memory agent (deep, background)
    """
    if len(messages) < 2:
        return 0

    updated = 0

    # ── Phase 1: Fast regex (free, instant) ──
    for domain, level in extract_expertise_signals(messages).items():
        await db.upsert_memory("expertise", domain, level, 0.6, conversation_id)
        updated += 1

    for key, value in extract_style_signals(messages).items():
        await db.upsert_memory("style", key, value, 0.5, conversation_id)
        updated += 1

    for key, value in extract_personal_signals(messages).items():
        await db.upsert_memory("personal", key, value, 0.9, conversation_id)
        updated += 1

    for key, value in extract_context_signals(messages).items():
        await db.upsert_memory("goals", key, value, 0.7, conversation_id)
        updated += 1

    # ── Phase 2: LLM Memory Agent (deep analysis, background) ──
    if provider and model:
        try:
            agent_facts = await _run_memory_agent(messages, provider, model)
            for fact in agent_facts:
                cat = fact.get("category", "")
                key = fact.get("key", "")
                value = fact.get("value", "")
                if cat and key and value:
                    await db.upsert_memory(cat, key, value, 0.8, conversation_id)
                    updated += 1
        except Exception as e:
            logger.warning("Memory agent failed: %s", e)

    # Decay old memories
    await db.decay_memories(0.97)

    logger.info("Learned %d signals from conversation %s", updated, conversation_id[:8])
    return updated


async def _run_memory_agent(
    messages: list[LLMMessage],
    provider,
    model: str,
) -> list[dict]:
    """Run LLM memory agent to extract deep facts from conversation."""
    import json as _json
    from app.providers.base import LLMRequest

    # Build FULL conversation digest — both user and assistant messages
    # The agent needs full context to infer implicit signals
    relevant = [m for m in messages if m.role in ("user", "assistant")][-12:]
    if not relevant:
        return []

    # Include existing profile so agent extracts only NEW facts
    existing_snapshot = await db.get_memory_snapshot()
    existing_context = f"\n\nТекущий профиль пользователя:\n{existing_snapshot}" if existing_snapshot else ""

    digest = "\n\n".join(
        f"{'Пользователь' if m.role == 'user' else 'DeepThink'}: {m.content[:400]}"
        for m in relevant
    )

    req = LLMRequest(
        messages=[
            LLMMessage(role="system", content=MEMORY_AGENT_PROMPT),
            LLMMessage(role="user", content=f"Проанализируй этот диалог и извлеки факты о пользователе:{existing_context}\n\n--- ДИАЛОГ ---\n{digest}"),
        ],
        model=model,
        temperature=0.0,
        max_tokens=500,
    )

    resp = await provider.complete(req)
    content = (resp.content or "").strip()

    # Parse JSON response
    # Strip markdown code fences if present
    content = re.sub(r'^```(?:json)?\n?', '', content)
    content = re.sub(r'\n?```$', '', content)

    try:
        facts = _json.loads(content)
        if isinstance(facts, list):
            return [f for f in facts if isinstance(f, dict)]
    except _json.JSONDecodeError:
        logger.warning("Memory agent returned invalid JSON: %s", content[:200])

    return []


async def get_user_profile_prompt() -> str:
    """Build a compact user profile for injection into system prompt.

    When memory is empty — tells agent to get to know the user.
    When memory exists — tells agent how to use it naturally.
    """
    snapshot = await db.get_memory_snapshot()

    if not snapshot:
        return """
ТЫ ЕЩЁ НЕ ЗНАЕШЬ ЭТОГО ЧЕЛОВЕКА.
Это новый пользователь или пустая память. Ты хочешь познакомиться — это поможет тебе лучше помогать.
В первых сообщениях:
— Представься коротко и тепло, спроси имя
— После ответа на вопрос пользователя — добавь один естественный вопрос о нём (чем занимается, какой опыт в теме)
— Объясни зачем спрашиваешь: «Так я смогу лучше подбирать примеры и глубину»
— НЕ превращай это в анкету. Максимум 1 вопрос за сообщение, и только когда к месту.
— Если пользователь сразу задаёт сложный вопрос — сначала ответь на него, потом уточни контекст."""

    return f"""
ТЫ ЗНАЕШЬ ЭТОГО ЧЕЛОВЕКА (из прошлых разговоров):
{snapshot}

Как использовать эту память:
— Обращайся по имени когда уместно (не в каждом сообщении).
— Ссылайся на прошлый контекст естественно: «Ты же работаешь с X...», «В прошлый раз мы обсуждали...»
— Адаптируй сложность под уровень экспертизы.
— НЕ говори «Согласно вашему профилю» или «Из ваших данных я знаю» — ты просто ЗНАЕШЬ это, как знает друг."""
