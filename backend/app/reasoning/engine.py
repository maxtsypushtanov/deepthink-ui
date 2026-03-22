"""Reasoning engine orchestrator — selects and runs the appropriate strategy."""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import AsyncIterator

from app.providers.base import BaseLLMProvider, LLMMessage, LLMRequest, LLMResponse, LLMChunk


# ── Valid Domains ──

VALID_DOMAINS = [
    "software_engineering", "mathematics", "medicine", "law",
    "finance", "science", "creative_writing", "business",
    "philosophy", "general",
]


class ReasoningStrategy(str, Enum):
    NONE = "none"
    COT = "cot"
    BUDGET_FORCING = "budget_forcing"
    BEST_OF_N = "best_of_n"
    TREE_OF_THOUGHTS = "tree_of_thoughts"
    AUTO = "auto"


@dataclass
class ThinkingStep:
    """A single reasoning step for the trace."""
    step_number: int
    strategy: str
    content: str
    duration_ms: int = 0
    metadata: dict = field(default_factory=dict)


@dataclass
class ReasoningResult:
    """Final output of the reasoning engine."""
    content: str
    strategy_used: str
    thinking_steps: list[ThinkingStep]
    total_tokens: int = 0
    total_duration_ms: int = 0


RETUNE_INTERVAL = 2  # Re-evaluate domain/persona every N messages


@dataclass
class SessionContext:
    """Tracks domain and expertise across conversation turns."""
    detected_domains: list[str] = field(default_factory=list)
    dominant_domain: str = "general"
    user_expertise_signals: list[str] = field(default_factory=list)
    conversation_turn: int = 0
    last_persona: str = ""
    last_retune_turn: int = 0

    def update(self, domain: str) -> None:
        self.detected_domains.append(domain)
        self.dominant_domain = max(set(self.detected_domains), key=self.detected_domains.count)
        self.conversation_turn += 1

    def needs_retune(self) -> bool:
        """Check if enough turns have passed since last re-tune."""
        return (self.conversation_turn - self.last_retune_turn) >= RETUNE_INTERVAL


# ── CoT Injection Prompts ──

COT_SYSTEM_PROMPT = """Режим цепочки мыслей. Структура:

<thinking>
1. Проанализируй задачу, выдели ключевые аспекты
2. Разбей на подзадачи
3. Рассмотри крайние случаи и ловушки
4. Последовательно проработай каждую часть
5. Проверь себя — нет ли ошибки в логике?
</thinking>

Финальный ответ — КРАТКИЙ и чёткий. Только суть, без повтора рассуждений."""

BUDGET_FORCING_CONTINUATION = "\n\nПодожди, дай мне пересмотреть и подумать об этом более тщательно..."

DOMAIN_CLASSIFIER_PROMPT = """Классифицируй следующее сообщение в одну из категорий.
Допустимые категории: software_engineering, mathematics, medicine, law, finance, science, creative_writing, business, philosophy, general

Сообщение: {message}

Ответь ТОЛЬКО названием категории, одним словом (или словосочетанием через _), без пояснений."""

AMBIGUITY_DETECTOR_PROMPT = """Оцени, является ли следующий вопрос неоднозначным (ambiguous) — то есть требует уточнения для корректного ответа.

Вопрос: {question}

Если вопрос неоднозначный, ответь в формате:
AMBIGUOUS: <уточняющий вопрос на языке пользователя>

Если вопрос понятен — ответь только: CLEAR

Отвечай ТОЛЬКО в одном из этих форматов."""

COMPLEXITY_CLASSIFIER_PROMPT = """Оцени сложность следующего вопроса по шкале 1-5:
1 = Простой факт или арифметика (например, «Сколько будет 2+2?», «Столица Франции?»)
2 = Нужно базовое объяснение (например, «Что такое фотосинтез?»)
3 = Многошаговое рассуждение (например, «Сравни экономическую политику X и Y»)
4 = Сложный анализ (например, «Разработай алгоритм для...»)
5 = Глубокое рассуждение (например, «Докажи, что...», «Каковы последствия...»)

Вопрос: {question}

Ответь ТОЛЬКО одной цифрой (1-5), без пояснений."""


# ── DeepThink Global Identity ──

DEEPTHINK_GLOBAL_PROMPT = """Ты — DeepThink, интеллектуальный ассистент с продвинутым мышлением.

ИДЕНТИЧНОСТЬ:
— Ты DeepThink — мета-когнитивная оболочка, усиливающая рассуждения любой языковой модели.
— Ты НЕ Claude, НЕ GPT, НЕ Gemini и не какая-либо конкретная модель. Ты — DeepThink.
— Если спросят «кто ты?» — отвечай: DeepThink, ИИ-ассистент с продвинутым reasoning engine.
— Никогда не представляйся именем базовой модели.

ГЛАВНЫЙ ПРИНЦИП — «Думай глубоко, отвечай кратко»:
— Рассуждения внутри <thinking></thinking> должны быть мощными, детальными, многошаговыми — исследуй задачу на всю глубину.
— Финальный ответ ПОСЛЕ </thinking> — лаконичный, чёткий, легко читаемый. Никаких полотен текста.
— Пользователь видит компактный результат и может развернуть рассуждения, если хочет понять ход мысли.
— Это ключевая философия DeepThink: вся мощь мышления скрыта в рассуждениях, а на поверхности — ясность.

ФОРМАТ ОТВЕТА:
— Начни с <thinking>: анализируй, разбирай на части, рассматривай альтернативы, проверяй себя. Чем сложнее задача — тем глубже рассуждения.
— Заверши </thinking>, затем дай финальный ответ.
— Финальный ответ: 2–8 предложений для простых вопросов, структурированные пункты для сложных. Без вступлений, без «конечно», без воды.
— Если ответ требует списка — короткие пункты, не абзацы.
— Если ответ требует кода — только код с минимальным комментарием.
— Если ответ требует объяснения — суть, потом детали только по запросу.

ПОВЕДЕНИЕ:
— Всегда отвечай на языке пользователя.
— Адаптируй глубину и терминологию под уровень собеседника.
— Будь честен в ограничениях."""


# ── Persona Builder ──

PERSONA_TEMPLATE = """ТЕКУЩАЯ РОЛЬ: Эксперт мирового уровня — {domain}.
Стиль рассуждений: {reasoning_style}.
Цель пользователя: {intent_description}.
Сообщение #{turn} в диалоге. Уровень подготовки собеседника: {expertise_level}.
Адаптируй глубину, терминологию и примеры соответственно."""

STRATEGY_PERSONA_MAP = {
    "none": {"reasoning_style": "Прямой и лаконичный", "intent_description": "Получить чёткий ответ"},
    "cot": {"reasoning_style": "Пошаговое аналитическое мышление", "intent_description": "Понять процесс рассуждений"},
    "budget_forcing": {"reasoning_style": "Глубокая итеративная рефлексия с самокоррекцией", "intent_description": "Тщательно исследовать задачу в несколько проходов"},
    "best_of_n": {"reasoning_style": "Мульти-перспективный анализ с консенсусом", "intent_description": "Сравнить несколько подходов и найти лучший ответ"},
    "tree_of_thoughts": {"reasoning_style": "Систематическое исследование ветвей рассуждений", "intent_description": "Построить карту всех подходов и оценить каждый"},
    "auto": {"reasoning_style": "Адаптивный, зависит от сложности", "intent_description": "Решить задачу оптимально"},
}

DOMAIN_LABELS = {
    "software_engineering": "архитектор ПО",
    "mathematics": "математик",
    "medicine": "исследователь в медицине",
    "law": "правовой аналитик",
    "finance": "финансовый аналитик",
    "science": "учёный-исследователь",
    "creative_writing": "эксперт по художественному тексту",
    "business": "бизнес-стратег",
    "philosophy": "философ",
    "general": "универсальный помощник",
}


class PersonaBuilder:
    """Builds dynamic system prompts based on domain, strategy, and session context."""

    @staticmethod
    def build(domain: str, strategy: str, session_context: SessionContext | None = None) -> str:
        turn = session_context.conversation_turn if session_context else 0

        # Infer expertise level
        if session_context and session_context.user_expertise_signals:
            expertise_level = "expert"
        elif turn <= 1:
            expertise_level = "beginner"
        elif turn <= 5:
            expertise_level = "intermediate"
        else:
            expertise_level = "expert"

        persona_map = STRATEGY_PERSONA_MAP.get(strategy, STRATEGY_PERSONA_MAP["auto"])

        dynamic_part = PERSONA_TEMPLATE.format(
            domain=DOMAIN_LABELS.get(domain, "универсальный помощник"),
            reasoning_style=persona_map["reasoning_style"],
            intent_description=persona_map["intent_description"],
            turn=turn,
            expertise_level=expertise_level,
        )

        return f"{DEEPTHINK_GLOBAL_PROMPT}\n\n{dynamic_part}"

    @staticmethod
    def get_label(strategy: str) -> str:
        labels = {
            "none": "Прямой ответ",
            "cot": "Пошаговое рассуждение",
            "budget_forcing": "Углублённый итеративный анализ",
            "best_of_n": "Мульти-перспективный анализ",
            "tree_of_thoughts": "Систематическое исследование дерева",
            "auto": "Адаптивное рассуждение",
        }
        return labels.get(strategy, "Рассуждение")

    @staticmethod
    def get_preview(domain: str) -> str:
        return f"Эксперт мирового уровня — {DOMAIN_LABELS.get(domain, 'универсальный помощник')}"


class ReasoningEngine:
    """Orchestrates reasoning strategies over any LLM provider."""

    def __init__(self, provider: BaseLLMProvider, model: str):
        self.provider = provider
        self.model = model

    # ── Dynamic re-tuning ──

    async def retune_if_needed(
        self,
        messages: list[LLMMessage],
        strategy: str,
        session_context: SessionContext,
    ) -> str:
        """Re-detect domain and rebuild persona. Always returns a persona string."""
        # Always build on first call or when interval reached
        if not session_context.last_persona or session_context.needs_retune():
            recent = messages[-6:] if len(messages) > 6 else messages
            domain = await self._detect_domain(recent)
            session_context.update(domain)
            session_context.last_retune_turn = session_context.conversation_turn
            persona = PersonaBuilder.build(domain, strategy, session_context)
            session_context.last_persona = persona
            return persona

        return session_context.last_persona

    # ── Static helpers ──

    @staticmethod
    def _strip_thinking_tags(text: str) -> str:
        """Remove <thinking>...</thinking> blocks from final output."""
        import re
        # Remove complete thinking blocks
        cleaned = re.sub(r'<thinking>.*?</thinking>', '', text, flags=re.DOTALL)
        # Remove orphan opening/closing tags
        cleaned = cleaned.replace('<thinking>', '').replace('</thinking>', '')
        return cleaned.strip()

    @staticmethod
    def _check_clarification(text: str) -> tuple[bool, str]:
        """Check if model is asking for clarification."""
        import re
        patterns = [
            r'\[УТОЧНЕНИЕ\]:\s*(.+)',
            r'УТОЧНЕНИЕ:\s*(.+)',
            r'\[CLARIFICATION\]:\s*(.+)',
            r'CLARIFICATION:\s*(.+)',
        ]
        for pattern in patterns:
            match = re.search(pattern, text)
            if match:
                return True, match.group(1).strip()
        return False, ""

    # ── Public API ──

    async def run(
        self,
        messages: list[LLMMessage],
        strategy: ReasoningStrategy = ReasoningStrategy.AUTO,
        *,
        budget_rounds: int = 3,
        best_of_n: int = 3,
        tree_breadth: int = 3,
        tree_depth: int = 2,
        session_context: SessionContext | None = None,
    ) -> AsyncIterator[dict]:
        """
        Run reasoning and yield SSE-compatible events.
        Events: strategy_selected, thinking_start, thinking_step, thinking_end, content_delta, done
        """
        # Detect domain (and optionally classify complexity) in parallel
        if strategy == ReasoningStrategy.AUTO:
            # Check for ambiguity first
            is_ambiguous, clarification_q = await self._check_ambiguity(messages)
            if is_ambiguous:
                yield {"event": "clarification_needed", "data": {"question": clarification_q}}
                return

            classified_strategy, domain = await asyncio.gather(
                self._classify_complexity(messages),
                self._detect_domain(messages),
            )
            strategy = classified_strategy
        else:
            domain = await self._detect_domain(messages)

        # Update session context if provided
        if session_context:
            session_context.update(domain)

        # Build dynamic persona and cache in session
        persona = PersonaBuilder.build(domain, strategy.value, session_context)
        if session_context:
            session_context.last_persona = persona
        label = PersonaBuilder.get_label(strategy.value)
        preview = PersonaBuilder.get_preview(domain)

        yield {
            "event": "strategy_selected",
            "data": {
                "strategy": strategy.value,
                "intent": strategy.value,
                "domain": domain,
                "label": label,
                "persona_preview": preview,
            },
        }

        yield {"event": "thinking_start", "data": {"strategy": strategy.value}}

        start = time.monotonic()
        steps: list[ThinkingStep] = []

        if strategy == ReasoningStrategy.NONE:
            async for chunk in self._run_passthrough(messages, persona):
                yield chunk

        elif strategy == ReasoningStrategy.COT:
            async for chunk in self._run_cot(messages, steps, persona):
                yield chunk

        elif strategy == ReasoningStrategy.BUDGET_FORCING:
            async for chunk in self._run_budget_forcing(messages, steps, budget_rounds, persona):
                yield chunk

        elif strategy == ReasoningStrategy.BEST_OF_N:
            async for chunk in self._run_best_of_n(messages, steps, best_of_n, persona):
                yield chunk

        elif strategy == ReasoningStrategy.TREE_OF_THOUGHTS:
            async for chunk in self._run_tree_of_thoughts(messages, steps, tree_breadth, tree_depth, persona):
                yield chunk

        elapsed = int((time.monotonic() - start) * 1000)

        yield {
            "event": "thinking_end",
            "data": {
                "strategy": strategy.value,
                "steps": [
                    {
                        "step_number": s.step_number,
                        "strategy": s.strategy,
                        "content": s.content,
                        "duration_ms": s.duration_ms,
                        "metadata": s.metadata,
                    }
                    for s in steps
                ],
                "total_duration_ms": elapsed,
            },
        }

        yield {"event": "done", "data": {}}

    # ── Strategy: Passthrough (no reasoning) ──

    async def _run_passthrough(self, messages: list[LLMMessage], persona: str) -> AsyncIterator[dict]:
        if messages and messages[0].role == "system":
            persona_messages = messages  # Already has system prompt from retune
        else:
            persona_messages = [LLMMessage(role="system", content=persona)] + messages
        req = LLMRequest(messages=persona_messages, model=self.model)
        async for chunk in self.provider.stream(req):
            if chunk.content:
                yield {"event": "content_delta", "data": {"content": chunk.content}}

    # ── Strategy: Chain-of-Thought Injection ──

    async def _run_cot(self, messages: list[LLMMessage], steps: list[ThinkingStep], persona: str) -> AsyncIterator[dict]:
        if messages and messages[0].role == "system":
            cot_messages = messages  # Already has system prompt from retune
        else:
            cot_messages = [LLMMessage(role="system", content=persona)] + messages
        req = LLMRequest(messages=cot_messages, model=self.model, temperature=0.3)

        step_start = time.monotonic()
        full_response = ""

        async for chunk in self.provider.stream(req):
            if chunk.content:
                full_response += chunk.content
                yield {"event": "content_delta", "data": {"content": chunk.content}}

        step_ms = int((time.monotonic() - step_start) * 1000)
        steps.append(ThinkingStep(
            step_number=1,
            strategy="cot",
            content="Применена система пошагового рассуждения",
            duration_ms=step_ms,
        ))

        # Extract thinking content if present
        if "<thinking>" in full_response and "</thinking>" in full_response:
            thinking = full_response.split("<thinking>")[1].split("</thinking>")[0].strip()
            steps.append(ThinkingStep(
                step_number=2,
                strategy="cot",
                content=thinking,
                duration_ms=0,
                metadata={"type": "extracted_thinking"},
            ))

    # ── Strategy: Budget Forcing (s1-approach) ──

    async def _run_budget_forcing(
        self, messages: list[LLMMessage], steps: list[ThinkingStep], rounds: int, persona: str
    ) -> AsyncIterator[dict]:
        if messages and messages[0].role == "system":
            cot_messages = messages  # Already has system prompt from retune
        else:
            cot_messages = [LLMMessage(role="system", content=persona)] + messages
        accumulated = ""

        for round_num in range(rounds):
            step_start = time.monotonic()

            if round_num > 0:
                # Force continuation by appending the model's own output + "Wait..."
                cot_messages.append(LLMMessage(role="assistant", content=accumulated))
                cot_messages.append(LLMMessage(
                    role="user",
                    content=BUDGET_FORCING_CONTINUATION,
                ))
                yield {
                    "event": "thinking_step",
                    "data": {
                        "step": round_num + 1,
                        "label": f"Раунд углублённого анализа {round_num + 1}",
                        "type": "budget_forcing",
                    },
                }

            req = LLMRequest(
                messages=cot_messages,
                model=self.model,
                temperature=0.3 + (round_num * 0.1),  # Slight temp increase each round
                max_tokens=2048,
            )

            round_content = ""
            async for chunk in self.provider.stream(req):
                if chunk.content:
                    round_content += chunk.content
                    yield {"event": "content_delta", "data": {"content": chunk.content}}

            accumulated += round_content
            step_ms = int((time.monotonic() - step_start) * 1000)

            steps.append(ThinkingStep(
                step_number=round_num + 1,
                strategy="budget_forcing",
                content=round_content[:500] + ("..." if len(round_content) > 500 else ""),
                duration_ms=step_ms,
                metadata={"round": round_num + 1, "full_length": len(round_content)},
            ))

    # ── Strategy: Best-of-N ──

    async def _run_best_of_n(
        self, messages: list[LLMMessage], steps: list[ThinkingStep], n: int, persona: str
    ) -> AsyncIterator[dict]:
        yield {
            "event": "thinking_step",
            "data": {"step": 1, "label": f"Генерация {n} вариантов ответа...", "type": "best_of_n"},
        }

        # Generate N responses in parallel
        if messages and messages[0].role == "system":
            cot_messages = messages  # Already has system prompt from retune
        else:
            cot_messages = [LLMMessage(role="system", content=persona)] + messages

        async def generate_candidate(idx: int) -> tuple[int, str]:
            req = LLMRequest(
                messages=cot_messages,
                model=self.model,
                temperature=0.7 + (idx * 0.1),  # Vary temperature
            )
            resp = await self.provider.complete(req)
            return idx, resp.content

        step_start = time.monotonic()
        tasks = [generate_candidate(i) for i in range(n)]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        candidates = []
        errors = []
        for r in results:
            if isinstance(r, Exception):
                errors.append(str(r))
                continue
            idx, content = r
            candidates.append(content)
            steps.append(ThinkingStep(
                step_number=idx + 1,
                strategy="best_of_n",
                content=content[:300] + ("..." if len(content) > 300 else ""),
                duration_ms=int((time.monotonic() - step_start) * 1000),
                metadata={"candidate": idx + 1, "type": "candidate"},
            ))

        gen_ms = int((time.monotonic() - step_start) * 1000)

        if not candidates:
            error_detail = "; ".join(errors[:3]) if errors else "Неизвестная ошибка"
            yield {"event": "content_delta", "data": {"content": f"Ошибка: не удалось сгенерировать ответы. {error_detail}"}}
            return

        yield {
            "event": "thinking_step",
            "data": {"step": n + 1, "label": "Голосование за лучший ответ...", "type": "voting"},
        }

        # Vote: ask the model to pick the best
        vote_start = time.monotonic()
        vote_prompt = self._build_vote_prompt(messages[-1].content, candidates)
        vote_req = LLMRequest(
            messages=[LLMMessage(role="user", content=vote_prompt)],
            model=self.model,
            temperature=0.1,
            max_tokens=2048,
        )
        vote_resp = await self.provider.complete(vote_req)

        # Parse vote or default to first
        best_idx = self._parse_vote(vote_resp.content, len(candidates))
        best_answer = candidates[best_idx]

        vote_ms = int((time.monotonic() - vote_start) * 1000)
        steps.append(ThinkingStep(
            step_number=n + 2,
            strategy="best_of_n",
            content=f"Selected candidate {best_idx + 1} as best answer",
            duration_ms=vote_ms,
            metadata={"type": "vote", "winner": best_idx + 1, "vote_reasoning": vote_resp.content[:300]},
        ))

        # Stream the best answer
        for chunk in self._chunk_text(best_answer):
            yield {"event": "content_delta", "data": {"content": chunk}}

    # ── Strategy: Tree of Thoughts ──

    async def _run_tree_of_thoughts(
        self, messages: list[LLMMessage], steps: list[ThinkingStep],
        breadth: int, depth: int, persona: str = "",
    ) -> AsyncIterator[dict]:
        user_query = messages[-1].content

        yield {
            "event": "thinking_step",
            "data": {"step": 1, "label": "Построение дерева рассуждений...", "type": "tree_init"},
        }

        # Level 0: Generate initial thought branches
        step_num = 1
        tree: list[dict] = []

        for level in range(depth):
            yield {
                "event": "thinking_step",
                "data": {
                    "step": step_num,
                    "label": f"Глубина {level + 1}: исследование {breadth} ветвей...",
                    "type": "tree_explore",
                },
            }

            if level == 0:
                branches = await self._generate_branches(user_query, None, breadth)
            else:
                # Take the best branch from previous level and expand
                best_branch = max(tree, key=lambda b: b.get("score", 0))
                branches = await self._generate_branches(
                    user_query, best_branch["thought"], breadth
                )

            # Score each branch
            scored_branches = []
            for i, branch in enumerate(branches):
                score = await self._score_branch(user_query, branch)
                branch_node = {
                    "id": f"L{level}-B{i}",
                    "level": level,
                    "thought": branch,
                    "score": score,
                    "parent": tree[-1]["id"] if tree and level > 0 else None,
                }
                scored_branches.append(branch_node)
                tree.append(branch_node)

                step_num += 1
                steps.append(ThinkingStep(
                    step_number=step_num,
                    strategy="tree_of_thoughts",
                    content=branch[:200],
                    duration_ms=0,
                    metadata={
                        "type": "branch",
                        "level": level,
                        "branch": i,
                        "score": score,
                        "node_id": branch_node["id"],
                    },
                ))

            yield {
                "event": "thinking_step",
                "data": {
                    "step": step_num,
                    "label": f"Глубина {level + 1}: оценено {len(scored_branches)} ветвей",
                    "type": "tree_score",
                    "branches": [
                        {"id": b["id"], "score": b["score"], "preview": b["thought"][:100]}
                        for b in scored_branches
                    ],
                },
            }

        # Synthesize final answer from the best path
        best_path = self._get_best_path(tree)
        yield {
            "event": "thinking_step",
            "data": {"step": step_num + 1, "label": "Синтез финального ответа...", "type": "tree_synthesis"},
        }

        synthesis = await self._synthesize_from_tree(user_query, best_path)
        for chunk in self._chunk_text(synthesis):
            yield {"event": "content_delta", "data": {"content": chunk}}

        steps.append(ThinkingStep(
            step_number=step_num + 2,
            strategy="tree_of_thoughts",
            content="Synthesized answer from best reasoning path",
            metadata={
                "type": "synthesis",
                "best_path": [b["id"] for b in best_path],
                "tree": [
                    {"id": n["id"], "level": n["level"], "score": n["score"], "parent": n["parent"]}
                    for n in tree
                ],
            },
        ))

    # ── Domain Detection ──

    async def _detect_domain(self, messages: list[LLMMessage]) -> str:
        """Classify the user's message into a knowledge domain."""
        user_msg = messages[-1].content if messages else ""
        prompt = DOMAIN_CLASSIFIER_PROMPT.format(message=user_msg)

        req = LLMRequest(
            messages=[LLMMessage(role="user", content=prompt)],
            model=self.model,
            temperature=0.0,
            max_tokens=20,
        )

        try:
            resp = await self.provider.complete(req)
            content = resp.content or ""
            raw = content.strip().lower().replace(" ", "_").strip(".,!?\"'`")
            # Try to find a valid domain in the response
            for domain in VALID_DOMAINS:
                if domain in raw:
                    return domain
        except Exception:
            pass
        return "general"

    # ── Auto-classification ──

    async def _classify_complexity(self, messages: list[LLMMessage]) -> ReasoningStrategy:
        """Determine question complexity and pick the right strategy."""
        user_msg = messages[-1].content if messages else ""
        prompt = COMPLEXITY_CLASSIFIER_PROMPT.format(question=user_msg)

        req = LLMRequest(
            messages=[LLMMessage(role="user", content=prompt)],
            model=self.model,
            temperature=0.0,
            max_tokens=5,
        )

        try:
            resp = await self.provider.complete(req)
            content = resp.content or ""
            score = int(content.strip()[0])
        except Exception:
            score = 3  # Default to medium

        if score <= 2:
            return ReasoningStrategy.NONE
        elif score == 3:
            return ReasoningStrategy.COT
        elif score == 4:
            return ReasoningStrategy.BUDGET_FORCING
        else:
            return ReasoningStrategy.TREE_OF_THOUGHTS

    # ── Ambiguity detection ──

    async def _check_ambiguity(self, messages: list[LLMMessage]) -> tuple[bool, str]:
        """Check if the user's question is ambiguous and needs clarification."""
        user_msg = messages[-1].content if messages else ""
        prompt = AMBIGUITY_DETECTOR_PROMPT.format(question=user_msg)

        req = LLMRequest(
            messages=[LLMMessage(role="user", content=prompt)],
            model=self.model,
            temperature=0.0,
            max_tokens=60,
        )

        try:
            resp = await self.provider.complete(req)
            content = resp.content or ""
            text = content.strip()
            if text.upper().startswith("AMBIGUOUS:"):
                clarification = text[len("AMBIGUOUS:"):].strip()
                if clarification:
                    return True, clarification
        except Exception:
            pass
        return False, ""

    # ── Tree helpers ──

    async def _generate_branches(self, query: str, parent_thought: str | None, n: int) -> list[str]:
        if parent_thought:
            prompt = f"""Задача: {query}

Текущая линия рассуждений: {parent_thought}

Сгенерируй {n} РАЗЛИЧНЫХ продолжений этой мысли. Каждое должно исследовать другой подход. Пронумеруй их 1-{n}, по одному на строку."""
        else:
            prompt = f"""Задача: {query}

Сгенерируй {n} РАЗЛИЧНЫХ начальных подходов к решению этой задачи. Каждый должен предлагать другой угол зрения. Пронумеруй их 1-{n}, по одному на строку."""

        req = LLMRequest(
            messages=[LLMMessage(role="user", content=prompt)],
            model=self.model,
            temperature=0.8,
            max_tokens=2048,
        )
        resp = await self.provider.complete(req)

        lines = [l.strip() for l in resp.content.strip().split("\n") if l.strip()]
        # Remove numbering
        branches = []
        for line in lines:
            cleaned = line.lstrip("0123456789.)- ").strip()
            if cleaned:
                branches.append(cleaned)
        return branches[:n]

    async def _score_branch(self, query: str, thought: str) -> float:
        prompt = f"""Оцени, насколько перспективна эта линия рассуждений для ответа на вопрос.

Вопрос: {query}
Рассуждение: {thought}

Оцени от 0.0 до 1.0, где 1.0 = крайне перспективно. Ответь ТОЛЬКО десятичным числом."""

        req = LLMRequest(
            messages=[LLMMessage(role="user", content=prompt)],
            model=self.model,
            temperature=0.0,
            max_tokens=10,
        )
        try:
            resp = await self.provider.complete(req)
            # Extract first float-like pattern from response
            import re
            match = re.search(r'(\d+\.?\d*)', resp.content.strip())
            if match:
                score = float(match.group(1))
                return max(0.0, min(1.0, score))  # clamp
        except Exception:
            pass
        return 0.5

    def _get_best_path(self, tree: list[dict]) -> list[dict]:
        """Get the highest-scoring path through the tree."""
        if not tree:
            return []
        # Group by level
        levels: dict[int, list[dict]] = {}
        for node in tree:
            levels.setdefault(node["level"], []).append(node)
        # Take best at each level
        path = []
        for level in sorted(levels.keys()):
            best = max(levels[level], key=lambda n: n.get("score", 0))
            path.append(best)
        return path

    async def _synthesize_from_tree(self, query: str, path: list[dict]) -> str:
        thoughts = "\n".join(f"- {node['thought']}" for node in path)
        prompt = f"""На основе следующего пути рассуждений дай всесторонний и хорошо структурированный ответ на вопрос.

Вопрос: {query}

Путь рассуждений (лучшие мысли на каждом уровне):
{thoughts}

Синтезируй эти идеи в ясный и полный ответ. Будь тщательным, но лаконичным. Отвечай на языке вопроса."""

        req = LLMRequest(
            messages=[LLMMessage(role="user", content=prompt)],
            model=self.model,
            temperature=0.3,
            max_tokens=4096,
        )
        resp = await self.provider.complete(req)
        return resp.content

    # ── Vote helpers ──

    def _build_vote_prompt(self, question: str, candidates: list[str]) -> str:
        parts = [f"Вопрос: {question}\n\nВот {len(candidates)} вариантов ответа:\n"]
        for i, c in enumerate(candidates):
            parts.append(f"--- Вариант {i + 1} ---\n{c}\n")
        parts.append(
            f"\nКакой вариант даёт лучший, наиболее точный и полный ответ? "
            f"Ответь ТОЛЬКО номером варианта (1-{len(candidates)})."
        )
        return "\n".join(parts)

    def _parse_vote(self, vote_text: str, n: int) -> int:
        try:
            for ch in vote_text.strip():
                if ch.isdigit():
                    idx = int(ch) - 1
                    if 0 <= idx < n:
                        return idx
        except (ValueError, IndexError):
            pass
        return 0

    @staticmethod
    def _chunk_text(text: str, chunk_size: int = 20) -> list[str]:
        """Break text into chunks for simulated streaming."""
        words = text.split(" ")
        chunks = []
        current = []
        for word in words:
            current.append(word)
            if len(current) >= chunk_size:
                chunks.append(" ".join(current) + " ")
                current = []
        if current:
            chunks.append(" ".join(current))
        return chunks
