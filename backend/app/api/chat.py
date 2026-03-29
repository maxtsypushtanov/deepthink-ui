"""Main chat endpoint — SSE streaming with reasoning engine."""

from __future__ import annotations

import asyncio
import json
import logging
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.api.schemas import ChatRequest
from app.db import calendar as cal_db
from app.db import database as db
from app.providers.base import LLMMessage
from app.providers.registry import get_provider
from app.reasoning.engine import ReasoningEngine, ReasoningStrategy, SessionContext, PersonaBuilder, DOMAIN_LABELS
from app.reasoning.model_router import select_model, FRONTEND_DEFAULT_MODEL

logger = logging.getLogger(__name__)

router = APIRouter()

# In-memory session context storage keyed by conversation_id
MAX_SESSIONS = 1000
_session_contexts: dict[str, SessionContext] = {}


# ── Helpers ──

async def _get_provider_base_url(provider: str) -> str | None:
    """Look up the custom base_url for a provider from saved settings."""
    return await db.get_provider_base_url(provider)


# ── Chat fork ──

class ForkRequest(BaseModel):
    source_conversation_id: str
    fork_at_message_index: int = Field(ge=0)

@router.post("/api/chat/fork")
async def chat_fork(req: ForkRequest):
    """Fork a conversation: copy messages up to a given index into a new conversation."""
    src_messages = await db.get_messages(req.source_conversation_id)
    if not src_messages:
        raise HTTPException(status_code=404, detail="Source conversation not found")

    # Clamp index
    end = min(req.fork_at_message_index + 1, len(src_messages))
    if end == 0:
        raise HTTPException(status_code=400, detail="Nothing to fork (index 0)")

    # Determine title from the first user message
    first_user = next((m for m in src_messages[:end] if m["role"] == "user"), None)
    title = f"Fork: {first_user['content'][:40]}" if first_user else "Fork"

    new_conv = await db.create_conversation(title=title)

    # Batch-insert forked messages in a single transaction
    _db = await db.get_db()
    await _db.execute("BEGIN")
    try:
        import uuid as _uuid
        from datetime import datetime as _dt, timezone as _tz
        for msg in src_messages[:end]:
            mid = str(_uuid.uuid4())
            now = _dt.now(_tz.utc).isoformat()
            await _db.execute(
                """INSERT INTO messages
                   (id, conversation_id, role, content, model, provider,
                    reasoning_strategy, reasoning_trace, tokens_used, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (mid, new_conv["id"], msg["role"], msg["content"],
                 msg.get("model"), msg.get("provider"),
                 msg.get("reasoning_strategy"), msg.get("reasoning_trace"),
                 msg.get("tokens_used", 0), now),
            )
        now = _dt.now(_tz.utc).isoformat()
        await _db.execute(
            "UPDATE conversations SET updated_at = ? WHERE id = ?",
            (now, new_conv["id"]),
        )
        await _db.execute("COMMIT")
    except Exception:
        await _db.execute("ROLLBACK")
        raise

    return {"conversation_id": new_conv["id"], "title": new_conv["title"], "messages_copied": end}


# ── Chat plan (lightweight analysis) ──

@router.post("/api/chat/plan")
async def chat_plan(req: ChatRequest):
    """Analyze message and return execution plan for user confirmation."""
    api_key = await db.get_provider_key(req.provider)
    if not api_key:
        raise HTTPException(status_code=400, detail=f"No API key for {req.provider}")

    base_url = await _get_provider_base_url(req.provider)
    provider = get_provider(req.provider, api_key, base_url)

    # Quick classification
    engine = ReasoningEngine(provider, req.model)
    user_msg = req.message

    # Use prefill results if available, otherwise classify
    messages = [LLMMessage(role="user", content=user_msg)]
    if req.pre_domain and req.pre_strategy:
        domain = req.pre_domain
        classified_strategy = ReasoningStrategy(req.pre_strategy)
        logger.info("Plan using prefill: domain=%s, strategy=%s", domain, req.pre_strategy)
    elif req.pre_domain:
        domain = req.pre_domain
        classified_strategy = await engine._classify_complexity(messages)
    elif req.pre_strategy:
        classified_strategy = ReasoningStrategy(req.pre_strategy)
        domain = await engine._detect_domain(messages)
    else:
        classified_strategy, domain = await asyncio.gather(
            engine._classify_complexity(messages),
            engine._detect_domain(messages),
        )

    # If user chose a specific strategy, use that instead
    if req.reasoning_strategy != "auto":
        classified_strategy = ReasoningStrategy(req.reasoning_strategy)

    strategy = classified_strategy
    label = PersonaBuilder.get_label(strategy.value)
    domain_label = DOMAIN_LABELS.get(domain, domain)

    # Build plan description based on strategy
    plan_steps = []
    if strategy == ReasoningStrategy.NONE:
        plan_steps = ["Прямой ответ без дополнительных рассуждений"]
    elif strategy == ReasoningStrategy.COT:
        plan_steps = [
            "Пошаговый анализ задачи",
            "Проверка логики рассуждений",
            "Формулировка краткого ответа",
        ]
    elif strategy == ReasoningStrategy.BUDGET_FORCING:
        plan_steps = [
            f"Раунд 1: Первичный анализ",
            f"Раунды 2-{req.budget_rounds}: Углублённая проверка и самокоррекция",
            "Синтез финального ответа из всех раундов",
        ]
    elif strategy == ReasoningStrategy.BEST_OF_N:
        plan_steps = [
            f"Генерация {req.best_of_n} независимых вариантов ответа",
            "Голосование за лучший вариант",
            "Представление победителя",
        ]
    elif strategy == ReasoningStrategy.TREE_OF_THOUGHTS:
        plan_steps = [
            f"Построение дерева рассуждений (глубина {req.tree_depth}, ширина {req.tree_breadth})",
            "Оценка и скоринг каждой ветви",
            "Выбор лучшего пути и синтез ответа",
        ]

    return {
        "strategy": strategy.value,
        "strategy_label": label,
        "domain": domain,
        "domain_label": domain_label,
        "steps": plan_steps,
        "estimated_calls": (
            1 if strategy == ReasoningStrategy.NONE else
            1 if strategy == ReasoningStrategy.COT else
            req.budget_rounds if strategy == ReasoningStrategy.BUDGET_FORCING else
            req.best_of_n + 1 if strategy == ReasoningStrategy.BEST_OF_N else
            req.tree_breadth * req.tree_depth + 2
        ),
    }


# ── Chat (SSE streaming) ──

_CALENDAR_RE = re.compile(
    r'(?:завтра|сегодня|послезавтра|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье'
    r'|встреч[аиу]|расписани[ея]|schedule|meeting|tomorrow|today'
    r'|запланируй|назначь|перенеси|отмени встречу|свободные слоты|когда свободно'
    r'|календар[ьеёия]|calendar|что запланирован|покажи событи|мои событи'
    r'|открой календар|покажи календар|мой календар|в календар)',
    re.IGNORECASE,
)

@router.post("/api/chat")
async def chat(req: ChatRequest):
    """Stream a chat response with optional reasoning."""
    from app.api.chat_calendar import _calendar_event_stream, build_calendar_context
    from app.api.chat_github import _github_event_stream, GITHUB_SYSTEM_PROMPT

    # Auto-detect calendar intent from message text
    if not req.calendar_mode and _CALENDAR_RE.search(req.message):
        req.calendar_mode = True

    # Resolve provider API key
    api_key = await db.get_provider_key(req.provider)
    if not api_key:
        raise HTTPException(status_code=400, detail=f"No API key configured for provider: {req.provider}")

    # Get provider settings for base_url
    base_url = await _get_provider_base_url(req.provider)

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

    # Auto-rename if title is still default
    if conv and conv.get("title") in ("New Chat", "Новый чат"):
        new_title = req.message[:50].strip()
        if new_title:
            await db.update_conversation_title(conversation_id, new_title)

    # Build message history
    history = await db.get_messages(conversation_id)
    messages = [LLMMessage(role=m["role"], content=m["content"]) for m in history if m["role"] in ("user", "assistant", "system")]

    # If clarification context is provided, append as system message
    if req.clarification_context:
        messages.append(LLMMessage(role="system", content=req.clarification_context))

    # Calendar mode: inject full calendar context and tool instructions
    if req.calendar_mode:
        cal_context = await build_calendar_context()
        messages.insert(0, LLMMessage(role="system", content=cal_context))

    # Calendar mode: bypass reasoning engine, use direct streaming
    if req.calendar_mode:
        return EventSourceResponse(_calendar_event_stream(messages, provider, req, conversation_id))

    # GitHub mode: agentic streaming with MCP tool calls
    if req.github_mode:
        from app.core.config import settings as _app_settings
        _gh_token = _app_settings.github_personal_access_token or await db.get_provider_key("github") or ""
        if _gh_token:
            messages.insert(0, LLMMessage(role="system", content=GITHUB_SYSTEM_PROMPT))
        else:
            messages.insert(0, LLMMessage(role="system", content=(
                "Ты — ассистент с GitHub-функциональностью, но токен GitHub не настроен. "
                "Объясни пользователю что нужно настроить GITHUB_PERSONAL_ACCESS_TOKEN в .env файле "
                "или добавить токен через Настройки → Провайдеры (провайдер 'github'). "
                "Отвечай на русском."
            )))
        return EventSourceResponse(_github_event_stream(messages, provider, req, conversation_id))

    # ── Web Search: auto-detect if fresh information is needed ──
    try:
        from app.tools.web_search import needs_web_search, brave_search, format_search_results
        from app.core.config import settings as _search_settings
        brave_key = _search_settings.brave_search_api_key or await db.get_provider_key("brave") or ""
        if brave_key and needs_web_search(req.message):
            search_data = await brave_search(req.message, brave_key)
            search_text = format_search_results(search_data)
            if search_text and search_text != "Ничего не найдено.":
                messages.append(LLMMessage(
                    role="system",
                    content=(
                        f"[Результаты веб-поиска по запросу «{search_data['query']}»]\n\n"
                        f"{search_text}\n\n"
                        "Используй эти данные для ответа. Указывай источники когда ссылаешься на конкретные факты. "
                        "Если данные из поиска не релевантны вопросу — игнорируй их."
                    ),
                ))
    except Exception as e:
        logger.warning("Web search failed: %s", e)

    # ── RAG: Retrieve relevant context from past conversations ──
    try:
        from app.reasoning.rag import retrieve_relevant_context
        rag_context = await retrieve_relevant_context(
            query=req.message,
            exclude_conversation_id=conversation_id,
            limit=3,
        )
        if rag_context:
            messages.append(LLMMessage(role="system", content=rag_context))
    except Exception as e:
        logger.warning("RAG context retrieval failed: %s", e)

    # ── Infographic Generation: reasoning + image pipeline ──
    infographic_result: dict | None = None
    try:
        from app.tools.infographic import needs_infographic, generate_infographic
        if needs_infographic(req.message):
            or_key = await db.get_provider_key("openrouter") or ""
            if or_key:
                infographic_result = {"images": [], "mermaid": None, "description": "", "brief": None}
                # Run infographic pipeline — collect results (streaming happens in event_stream)
                async for evt in generate_infographic(
                    topic=req.message,
                    provider=provider,
                    model=req.model,
                    image_model=req.image_model,
                    openrouter_key=or_key,
                ):
                    if evt["event"] == "generated_images":
                        infographic_result["images"] = evt["data"]["images"]
                    elif evt["event"] == "mermaid_code":
                        infographic_result["mermaid"] = evt["data"]["code"]
                    elif evt["event"] == "description":
                        infographic_result["description"] = evt["data"]["text"]
                        infographic_result["brief"] = evt["data"].get("brief")
                    elif evt["event"] == "infographic_brief":
                        infographic_result["brief"] = evt["data"]

                # Inject into context for reasoning engine
                if infographic_result.get("description"):
                    img_note = f"\n\n[Создано {len(infographic_result['images'])} изображений — они отображаются в чате]" if infographic_result["images"] else ""
                    mermaid_note = "\n\n[Также создана интерактивная Mermaid-диаграмма — она отображается в чате]" if infographic_result.get("mermaid") else ""
                    messages.append(LLMMessage(
                        role="system",
                        content=(
                            f"[Инфографика создана по запросу пользователя]\n\n"
                            f"{infographic_result['description']}"
                            f"{img_note}{mermaid_note}\n\n"
                            "Кратко представь инфографику пользователю: что на ней показано, ключевой вывод. "
                            "НЕ дублируй все данные — пользователь видит их на картинке. "
                            "Спроси, нужны ли правки или другой формат."
                        ),
                    ))
    except Exception as e:
        logger.warning("Infographic generation failed: %s", e)

    # ── Image Generation: auto-detect if user wants a simple image (not infographic) ──
    image_gen_result = None
    image_gen_attempted = False
    try:
        from app.tools.image_gen import needs_image_generation, generate_image
        if not infographic_result and needs_image_generation(req.message):
            or_key = await db.get_provider_key("openrouter") or ""
            if or_key:
                image_gen_attempted = True
                image_gen_result = await generate_image(req.message, or_key, model=req.image_model)
                if image_gen_result and image_gen_result["images"]:
                    img_count = len(image_gen_result["images"])
                    desc = image_gen_result.get("text", "")
                    messages.append(LLMMessage(
                        role="system",
                        content=(
                            f"[Генерация изображений завершена: создано {img_count} изображений по запросу пользователя]\n"
                            f"{f'Описание модели: {desc}' if desc else ''}\n\n"
                            "Изображения уже отображаются в чате пользователя. "
                            "Кратко опиши что было создано и спроси, нужны ли изменения. "
                            "НЕ вставляй base64-данные в ответ — изображения показаны автоматически."
                        ),
                    ))
                else:
                    # Generation attempted but failed — tell LLM so it doesn't get confused
                    messages.append(LLMMessage(
                        role="system",
                        content=(
                            "[Генерация изображений была запрошена, но модель не вернула изображение. "
                            f"Использованная модель: {req.image_model}. "
                            "Возможные причины: модель не поддерживает генерацию изображений, или произошла ошибка API. "
                            "Объясни пользователю, что генерация не удалась. Предложи: "
                            "1) попробовать другую модель в Настройках → Инструменты, "
                            "2) описать что он хочет увидеть подробнее. "
                            "Отвечай дружелюбно, не технично.]"
                        ),
                    ))
            else:
                # No API key — tell LLM
                image_gen_attempted = True
                messages.append(LLMMessage(
                    role="system",
                    content=(
                        "[Пользователь попросил сгенерировать изображение, но API-ключ OpenRouter не настроен. "
                        "Объясни что для генерации изображений нужно настроить API-ключ OpenRouter в Настройках → Провайдеры. "
                        "Ответь дружелюбно и кратко.]"
                    ),
                ))
    except Exception as e:
        logger.warning("Image generation failed: %s", e)
        if needs_image_generation(req.message):
            messages.append(LLMMessage(
                role="system",
                content=(
                    f"[Генерация изображений не удалась: {str(e)[:200]}. "
                    "Объясни пользователю кратко и предложи попробовать позже или сменить модель в Настройках → Инструменты.]"
                ),
            ))

    # ── Python Tool: auto-detect if code execution is needed ──
    python_result = None
    try:
        from app.tools.python_sandbox import should_use_python, execute_python, CODE_GEN_PROMPT
        if should_use_python(req.message):
            # Ask LLM to write code
            code_req_msg = [
                LLMMessage(role="system", content=CODE_GEN_PROMPT),
                LLMMessage(role="user", content=req.message),
            ]
            from app.providers.base import LLMRequest as _LLMReq
            code_resp = await provider.complete(_LLMReq(
                messages=code_req_msg, model=req.model, temperature=0.0, max_tokens=1024,
            ))
            generated_code = (code_resp.content or "").strip()
            generated_code = re.sub(r'^```(?:python)?\n?', '', generated_code)
            generated_code = re.sub(r'\n?```$', '', generated_code)

            if generated_code and len(generated_code) > 10:
                python_result = execute_python(generated_code)
                if python_result["success"]:
                    # Inject result into messages so the reasoning engine can interpret it
                    result_text = python_result["output"]
                    images_note = f"\n\n[Создано {len(python_result['images'])} изображений]" if python_result["images"] else ""
                    messages.append(LLMMessage(
                        role="system",
                        content=f"[Python выполнен. Результат:]\n```\n{result_text}\n```{images_note}\n\nОпиши результат пользователю. Числа ТОЧНЫЕ — не округляй. Если есть график — скажи что он отображается.",
                    ))
    except Exception as e:
        logger.warning("Python tool failed: %s", e)

    strategy = ReasoningStrategy(req.reasoning_strategy)

    # ── Smart Model Routing ──
    # Compute complexity heuristic and domain to select optimal model tier
    _user_msg = req.message
    _complexity_score, _ = ReasoningEngine._heuristic_complexity(_user_msg)
    _route_domain = req.pre_domain or "general"

    # Load user-configured tiers from DB (defaults if none saved)
    _model_tiers = await db.get_model_tiers()
    _routed_model, _routed_tier = select_model(
        complexity=_complexity_score,
        domain=_route_domain,
        user_model=req.model,
        tiers=_model_tiers,
    )
    _original_model = req.model
    _effective_model = _routed_model

    engine = ReasoningEngine(provider, _effective_model)

    # Get or create session context for this conversation
    if conversation_id not in _session_contexts:
        _session_contexts[conversation_id] = SessionContext()
        # Evict oldest entry if we exceed the limit
        if len(_session_contexts) > MAX_SESSIONS:
            oldest_key = next(iter(_session_contexts))
            del _session_contexts[oldest_key]
    session_context = _session_contexts[conversation_id]

    # Detect/cache domain for this turn — skip if prefill provides domain
    if req.pre_domain:
        session_context.update(req.pre_domain)
    else:
        await engine.retune_if_needed(messages, session_context)

    # Re-route if domain detection changed the domain (and initial route used "general")
    if session_context.dominant_domain != _route_domain and _route_domain == "general":
        _routed_model, _routed_tier = select_model(
            complexity=_complexity_score,
            domain=session_context.dominant_domain,
            user_model=req.model,
            tiers=_model_tiers,
        )
        if _routed_model != _effective_model:
            _effective_model = _routed_model
            engine = ReasoningEngine(provider, _effective_model)

    _CYR = re.compile(r'[а-яА-ЯёЁ]')
    _thinking_step_counter = 0

    def _make_thinking_step(label: str, content: str = "") -> dict:
        nonlocal _thinking_step_counter
        _thinking_step_counter += 1
        # Clean content: strip system prompt fragments and meta-text
        clean = content.strip()
        # Remove lines that look like system instructions
        clean = re.sub(r'^(?:ИДЕНТИЧНОСТЬ|ГЛАВНЫЙ ПРИНЦИП|ФОРМАТ ОТВЕТА|ПОВЕДЕНИЕ|ТЕКУЩАЯ РОЛЬ|КРИТИЧЕСКИ ВАЖНО|КОНФИДЕНЦИАЛЬНОСТЬ)[\s:—].*$', '', clean, flags=re.MULTILINE)
        clean = re.sub(r'^(?:Ты —|Ты DeepThink|Никогда не).*$', '', clean, flags=re.MULTILINE)
        clean = re.sub(r'^—\s+.*(?:DeepThink|Claude|GPT|Gemini|рассуждени[яе]|<thinking>|промпт|инструкци).*$', '', clean, flags=re.MULTILINE)
        clean = re.sub(r'^(?:Пользователь (?:\w+\s+)?(?:задал|задает|задаёт|спрашивает|хочет|просит|написал|интересуется))[\s].*$', '', clean, flags=re.MULTILINE)
        clean = re.sub(r'^(?:Согласно (?:системной |моей |внутренней )?(?:инструкции|промпту|правилам|указаниям))[\s:,].*$', '', clean, flags=re.MULTILINE)
        clean = re.sub(r'^(?:Необходимо (?:подтвердить|следовать|ответить|соблюдать))[\s].*$', '', clean, flags=re.MULTILINE)
        clean = re.sub(r'^\d+\.\s+(?:Я (?:НЕ|не|—)|Ответ (?:должен|следует)).*$', '', clean, flags=re.MULTILINE)
        clean = re.sub(r'.*(?:системн(?:ой|ая|ые) инструкци|системн(?:ый|ого) промпт|установленн(?:ым|ые) правилам).*$', '', clean, flags=re.MULTILINE)
        clean = re.sub(r'\n{3,}', '\n\n', clean).strip()
        if not clean:
            clean = ""
        return {
            "event": "thinking_step",
            "data": json.dumps({
                "step": _thinking_step_counter,
                "label": label,
                "type": "reasoning",
                "content": clean[:500] if clean else "",
            }, ensure_ascii=False),
        }

    async def event_stream():
        nonlocal _thinking_step_counter
        full_content = ""
        reasoning_trace = []
        content_buffer = ""
        in_thinking = False
        thinking_buffer = ""  # accumulates <thinking> content to stream as steps
        all_thinking = ""  # track ALL thinking content for fallback if no answer
        # ── Initial buffering: detect reasoning vs answer ──
        initial_hold = ""
        initial_phase = True
        INITIAL_LIMIT = 300  # Minimal buffer — start streaming faster

        def _looks_like_clean_answer(text: str) -> bool:
            """Early exit from Phase 1: if text starts with a clean Cyrillic sentence
            (no numbered planning, no meta-text), start streaming immediately."""
            stripped = text.strip()
            if len(stripped) < 30:
                return False  # too short to tell
            first_line = stripped.split('\n')[0].strip()
            # Must start with Cyrillic
            if not _CYR.search(first_line[:5]):
                return False
            # Must NOT look like planning
            if re.match(r'^\d+\.', first_line):
                return False
            if re.match(r'^(?:Пользователь|Согласно|Необходимо|Определение|Контекст|Планирование)', first_line):
                return False
            return True

        # ── Real-time line filter: drop lines that are clearly meta/reasoning ──
        _META_LINE = re.compile(
            r'^(?:\s*\d+\.\s+)?(?:'
            r'Пользователь |Согласно |Необходимо |В моих |Мне (?:указано|велено|нужно)|'
            r'Ответ (?:должен|следует)|Моя (?:задача|роль)|'
            r'User |According to |I need to |I should |Let me |Based on |My (?:task|role)|'
            r'ИДЕНТИЧНОСТЬ|ГЛАВНЫЙ ПРИНЦИП|ФОРМАТ ОТВЕТА|ПОВЕДЕНИЕ|КОНФИДЕНЦИАЛЬНОСТЬ|'
            r'ТЕКУЩАЯ РОЛЬ|КРИТИЧЕСКИ ВАЖНО|САМООСОЗНАНИЕ|МИССИЯ'
            r')',
            re.IGNORECASE
        )

        def _clean_chunk(text: str) -> str:
            """Fast per-chunk cleaning: drop obvious meta-lines, keep everything else."""
            lines = text.split('\n')
            kept = []
            for line in lines:
                stripped = line.strip()
                if stripped and _META_LINE.match(stripped):
                    continue  # drop meta-line
                # Drop numbered items that reference system prompt or planning
                if re.match(r'^\s*[\.\d]+\s*(?:Я (?:НЕ|не|—)|Ответ (?:должен|следует)|Никогда не)', stripped):
                    continue
                # Drop ANY numbered planning: "1. Определение:", "4. Планирование:", etc.
                if re.match(r'^\s*,?\s*\d+\.\s*[А-ЯA-Z][а-яa-z]+(?:\s+[а-яa-z]+)?:', stripped):
                    continue
                # Drop analysis headers
                if re.match(r'^\s*(?:Анализ|План (?:ответа|действий)|Рассуждение|Ход мысли|Контекст|Логика ответа)[\s:]', stripped):
                    continue
                # Drop numbered meta-reasoning
                if re.match(r'^\s*\d+\.\s*(?:В памяти|Текущее сообщение|Поскольку|Исходя из|Учитывая|Из контекста|Из профиля)', stripped):
                    continue
                # Drop lines starting with comma (truncated list remnants)
                if re.match(r'^\s*,\s*(?:на|в |и |с |для|по|от|к |что|как|это)', stripped):
                    continue
                # Drop lines mentioning system instructions
                if re.search(r'системн\w*\s+(?:инструкци|промпт|правил)', stripped, re.IGNORECASE):
                    continue
                # Drop lines that look like internal planning ("подтвердить готовность", "спросить есть ли")
                if re.match(r'^\s*(?:подтвердить|спросить|определить|проверить|убедиться|выяснить|уточнить)\s', stripped, re.IGNORECASE):
                    continue
                kept.append(line)
            result = '\n'.join(kept)
            # Clean leading dots/numbers/commas from truncated lists
            result = re.sub(r'^[\s,\.\d]+\.\s*', '', result)
            # Clean "на русском языке." prefix remnants
            result = re.sub(r'^,?\s*на русском языке\.?\s*', '', result, flags=re.IGNORECASE)
            return result

        def _emit_chunk(text: str) -> dict | None:
            cleaned = _clean_chunk(text)
            if not cleaned.strip():
                return None  # skip empty chunks
            return {"event": "content_delta", "data": json.dumps({"content": cleaned}, ensure_ascii=False)}

        yield {
            "event": "conversation",
            "data": json.dumps({"conversation_id": conversation_id}),
        }

        # Emit model routing info so the frontend knows which model is actually used
        if _effective_model != _original_model:
            yield {
                "event": "model_routed",
                "data": json.dumps({
                    "original_model": _original_model,
                    "routed_model": _effective_model,
                    "tier": _routed_tier,
                    "complexity": _complexity_score,
                    "domain": session_context.dominant_domain,
                }, ensure_ascii=False),
            }

        try:
            async for event in engine.run(
                messages,
                strategy,
                budget_rounds=req.budget_rounds,
                best_of_n=req.best_of_n,
                tree_breadth=req.tree_breadth,
                tree_depth=req.tree_depth,
                session_context=session_context,
                pre_domain=req.pre_domain,
                pre_strategy=req.pre_strategy,
            ):
                evt_type = event["event"]
                evt_data = event["data"]

                if evt_type == "content_delta":
                    raw = evt_data["content"]

                    # ── Phase 1: Buffer initial tokens, then clean in one pass ──
                    # TRIZ "Intermediary": don't guess answer boundary in real-time.
                    # Buffer → clean with _strip_meta_text → stream clean result.
                    if initial_phase:
                        initial_hold += raw

                        # Check for <thinking> tags — handle immediately
                        if '<thinking>' in initial_hold:
                            initial_phase = False
                            before_think = initial_hold.split('<thinking>')[0].strip()
                            if before_think:
                                # Clean even the pre-thinking content
                                cleaned_before = ReasoningEngine._strip_meta_text(before_think)
                                if cleaned_before.strip():
                                    content_buffer += cleaned_before
                            rest = initial_hold[len(initial_hold.split('<thinking>')[0]):]
                            content_buffer += rest
                        elif len(initial_hold) >= INITIAL_LIMIT or _looks_like_clean_answer(initial_hold):
                            # Buffer full OR early detection of clean answer
                            initial_phase = False
                            cleaned = ReasoningEngine._strip_meta_text(initial_hold)
                            # Whatever cleaning removed = reasoning/meta (send to panel)
                            if len(cleaned) < len(initial_hold) * 0.8:
                                yield _make_thinking_step("Анализирую и выстраиваю ответ", initial_hold.strip()[:500])
                            if cleaned.strip():
                                content_buffer += cleaned
                            elif initial_hold.strip():
                                yield _make_thinking_step("Рассуждаю", initial_hold.strip()[:500])
                        else:
                            continue  # keep accumulating

                    else:
                        content_buffer += raw

                    # ── Phase 2: <thinking> tag handling — stream to panel, not to user ──
                    while True:
                        if not in_thinking:
                            think_start = content_buffer.find("<thinking>")
                            lt_pos = content_buffer.find("<")
                            if think_start != -1:
                                before = content_buffer[:think_start]
                                if before:
                                    full_content += before
                                    _ch = _emit_chunk(before)
                                    if _ch: yield _ch
                                content_buffer = content_buffer[think_start + len("<thinking>"):]
                                in_thinking = True
                                thinking_buffer = ""
                            elif lt_pos != -1 and lt_pos >= len(content_buffer) - len("<thinking>") + 1:
                                before = content_buffer[:lt_pos]
                                if before:
                                    full_content += before
                                    _ch = _emit_chunk(before)
                                    if _ch: yield _ch
                                content_buffer = content_buffer[lt_pos:]
                                break
                            else:
                                if content_buffer:
                                    full_content += content_buffer
                                    _ch = _emit_chunk(content_buffer)
                                    if _ch: yield _ch
                                content_buffer = ""
                                break
                        else:
                            think_end = content_buffer.find("</thinking>")
                            if think_end == -1:
                                # Still inside <thinking> — accumulate for panel
                                thinking_buffer += content_buffer
                                content_buffer = ""
                                # Stream thinking chunk to panel — accumulate more before flushing
                                if len(thinking_buffer) > 600:
                                    all_thinking += thinking_buffer
                                    # Extract a meaningful label from the first line
                                    first_line = thinking_buffer.strip().split('\n')[0][:80]
                                    yield _make_thinking_step("Рассуждаю", first_line)
                                    thinking_buffer = ""
                                break
                            else:
                                # Found </thinking> — flush remaining thinking to panel
                                thinking_buffer += content_buffer[:think_end]
                                if thinking_buffer.strip():
                                    all_thinking += thinking_buffer
                                    yield _make_thinking_step("Завершаю анализ", thinking_buffer.strip())
                                thinking_buffer = ""
                                content_buffer = content_buffer[think_end + len("</thinking>"):]
                                in_thinking = False

                elif evt_type == "thinking_end":
                    reasoning_trace = evt_data.get("steps", [])
                    yield {
                        "event": evt_type,
                        "data": json.dumps(evt_data, ensure_ascii=False),
                    }
                else:
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

        # Flush remaining thinking buffer to panel
        if thinking_buffer.strip():
            all_thinking += thinking_buffer
            yield _make_thinking_step("Завершаю анализ", thinking_buffer.strip())

        # If initial_phase never ended — response was short. Clean and emit.
        if initial_phase and initial_hold:
            initial_phase = False
            cleaned = ReasoningEngine._strip_meta_text(initial_hold)
            if cleaned.strip():
                full_content += cleaned
                _ch = _emit_chunk(cleaned)
                if _ch: yield _ch
            # Send original to thinking panel if cleaning removed content
            raw_stripped = re.sub(r'<thinking>|</thinking>', '', initial_hold).strip()
            if raw_stripped and raw_stripped != cleaned.strip():
                yield _make_thinking_step("Рассуждаю", raw_stripped[:500])

        # Flush remaining content buffer
        if content_buffer and not in_thinking:
            remaining = content_buffer.replace("<thinking>", "").replace("</thinking>", "")
            if remaining:
                full_content += remaining
                _ch = _emit_chunk(remaining)
                if _ch: yield _ch
        content_buffer = ""

        # ── Fallback: if no visible content was emitted but thinking exists,
        #    extract the answer from the thinking buffer.
        #    This happens when the model wraps the entire response in <thinking> tags.
        if not full_content.strip() and all_thinking.strip():
            fallback = ReasoningEngine._strip_meta_text(all_thinking)
            if fallback.strip():
                full_content = fallback
                _ch = _emit_chunk(fallback)
                if _ch: yield _ch

        full_content = full_content or ""
        # Final cleanup: strip any leaked meta-text from saved content
        full_content = ReasoningEngine._strip_meta_text(full_content)

        # Check for clarification request in the response
        needs_clarification, clarification_question = ReasoningEngine._check_clarification(full_content)
        if needs_clarification:
            yield {
                "event": "clarification_needed",
                "data": json.dumps({"question": clarification_question}, ensure_ascii=False),
            }

        # Save assistant message (use effective model from routing, not original req.model)
        await db.add_message(
            conversation_id,
            "assistant",
            full_content,
            model=_effective_model,
            provider=req.provider,
            reasoning_strategy=strategy.value,
            reasoning_trace=json.dumps(reasoning_trace, ensure_ascii=False) if reasoning_trace else None,
        )

        # Update dominant domain for smart folder grouping
        if session_context and session_context.dominant_domain != "general":
            await db.update_conversation_domain(conversation_id, session_context.dominant_domain)

        # Learn user profile from conversation (cognitive memory)
        # Phase 1 (regex) runs instantly, Phase 2 (LLM agent) runs in background
        try:
            from app.reasoning.memory import learn_from_conversation
            import asyncio as _aio
            _aio.ensure_future(learn_from_conversation(
                conversation_id, messages, provider=provider, model=req.model,
            ))
        except Exception as e:
            logger.warning("Memory learning failed: %s", e)

        # Neuron identity reflection (background, non-blocking)
        try:
            from app.reasoning.neuron_identity import identity_manager
            import asyncio as _aio2
            _aio2.ensure_future(identity_manager.reflect_after_conversation(
                provider=provider,
                conversation_id=conversation_id,
                messages=messages,
            ))
        except Exception as e:
            logger.warning("Neuron reflection trigger failed: %s", e)

        # RAG: Generate conversation summary (background, non-blocking)
        try:
            from app.reasoning.rag import generate_conversation_summary
            import asyncio as _aio3
            _aio3.ensure_future(generate_conversation_summary(
                conversation_id=conversation_id,
                messages=messages,
                provider=provider,
                model=req.model,
            ))
        except Exception as e:
            logger.warning("RAG summary generation failed: %s", e)

        done_data: dict = {}

        # Include Python-generated images if any
        if python_result and python_result.get("images"):
            done_data["images"] = python_result["images"]

        # Include AI-generated images if any
        if image_gen_result and image_gen_result.get("images"):
            done_data["generated_images"] = image_gen_result["images"]

        # Include infographic results
        if infographic_result:
            if infographic_result.get("images"):
                done_data["generated_images"] = infographic_result["images"]
            if infographic_result.get("mermaid"):
                done_data["mermaid_code"] = infographic_result["mermaid"]

        yield {"event": "done", "data": json.dumps(done_data, ensure_ascii=False)}

        # ── Self-Verification: check factual claims after response is sent ──
        # Non-blocking — runs after the 'done' event, only for complex factual queries
        try:
            _verify_domain = session_context.dominant_domain if session_context else "general"
            if (
                _complexity_score >= 3
                and _verify_domain not in ("creative_writing", "philosophy")
                and full_content.strip()
            ):
                from app.reasoning.verifier import verify_response
                from app.core.config import settings as _verify_settings
                _brave_key = _verify_settings.brave_search_api_key or await db.get_provider_key("brave") or ""
                if _brave_key:
                    verification = await verify_response(
                        response_text=full_content,
                        user_query=req.message,
                        brave_api_key=_brave_key,
                        domain=_verify_domain,
                    )
                    if verification and not verification.get("skipped"):
                        yield {
                            "event": "verification",
                            "data": json.dumps(verification, ensure_ascii=False),
                        }
        except Exception as e:
            logger.warning("Верификация не удалась: %s", e)

    return EventSourceResponse(event_stream())
