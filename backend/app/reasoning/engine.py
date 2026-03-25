"""Reasoning engine orchestrator — selects and runs the appropriate strategy."""

from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import AsyncIterator

from collections import Counter

from app.providers.base import BaseLLMProvider, LLMMessage, LLMRequest

logger = logging.getLogger(__name__)


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
    PERSONA_COUNCIL = "persona_council"
    RUBBER_DUCK = "rubber_duck"
    SOCRATIC = "socratic"
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
        self.dominant_domain = Counter(self.detected_domains).most_common(1)[0][0]
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

BUDGET_FORCING_CONTINUATION = """Продолжи анализ — ты ещё не закончил. Углуби рассуждения:
— Проверь предыдущие выводы на ошибки и слабые места
— Рассмотри альтернативные точки зрения
— Добавь нюансы, которые упустил
Продолжай рассуждения в <thinking></thinking>, затем дай обновлённый краткий ответ."""

BUDGET_FORCING_FINAL = """На основе всех предыдущих раундов анализа дай ФИНАЛЬНЫЙ ответ.
— НЕ используй теги <thinking>
— НЕ повторяй рассуждения — они уже выполнены
— Дай только чёткий, структурированный ответ на языке пользователя"""

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
— Рассуждения ТОЛЬКО внутри <thinking></thinking>. ВСЯ аналитика, размышления, планирование — ТОЛЬКО внутри этих тегов.
— Финальный ответ ПОСЛЕ </thinking> — лаконичный, чёткий, легко читаемый. Никаких полотен текста.
— Пользователь видит ТОЛЬКО то, что идёт ПОСЛЕ тега </thinking>.
— НИКОГДА не пиши рассуждения вне тегов <thinking>. Ни на каком языке. Ни одного слова анализа вне тегов.
— ЗАПРЕЩЕНО писать "User says...", "Let me think...", "I need to...", "According to..." вне <thinking>.

ФОРМАТ ОТВЕТА:
— <thinking>здесь весь анализ, рассуждения, проверка, планирование</thinking>
— Затем СРАЗУ финальный ответ на языке пользователя. Без преамбул.
— Финальный ответ: 2–8 предложений для простых вопросов, структурированные пункты для сложных.
— Если ответ требует списка — короткие пункты.
— Если ответ требует кода — только код с минимальным комментарием.

ПОВЕДЕНИЕ:
— Всегда отвечай на языке пользователя.
— Адаптируй глубину и терминологию под уровень собеседника.
— Будь честен в ограничениях.
— ПОСЛЕ </thinking> пиши ТОЛЬКО на языке пользователя. Если пользователь пишет на русском — отвечай ТОЛЬКО на русском."""


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
    "persona_council": {"reasoning_style": "Совет экспертов с разными ролями", "intent_description": "Рассмотреть задачу с нескольких экспертных точек зрения и синтезировать"},
    "rubber_duck": {"reasoning_style": "Самообъяснение и самокоррекция через упрощение", "intent_description": "Объяснить просто, найти ошибки, исправить"},
    "socratic": {"reasoning_style": "Самодопрос и синтез через ключевые подвопросы", "intent_description": "Раскрыть тему через сократический диалог с самим собой"},
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
            "persona_council": "Совет экспертов",
            "rubber_duck": "Объясни и исправь",
            "socratic": "Метод Сократа",
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
        session_context: SessionContext,
    ) -> str:
        """Re-detect domain if needed. Returns the detected/cached domain."""
        if not session_context.detected_domains or session_context.needs_retune():
            recent = messages[-6:] if len(messages) > 6 else messages
            domain = await self._detect_domain(recent)
            session_context.update(domain)
            session_context.last_retune_turn = session_context.conversation_turn
            return domain

        session_context.conversation_turn += 1
        return session_context.dominant_domain

    # ── Static helpers ──

    @staticmethod
    def _strip_thinking_tags(text: str) -> str:
        """Remove <thinking>...</thinking> blocks from final output."""
        # Remove complete thinking blocks
        cleaned = re.sub(r'<thinking>.*?</thinking>', '', text, flags=re.DOTALL)
        # Remove orphan opening/closing tags
        cleaned = cleaned.replace('<thinking>', '').replace('</thinking>', '')
        return cleaned.strip()

    @staticmethod
    def _strip_meta_text(text: str) -> str:
        """Remove LLM meta-commentary, internal reasoning, and system prompt echoes."""
        # Remove thinking blocks first
        cleaned = ReasoningEngine._strip_thinking_tags(text)

        # ── Phase 1: line-level patterns ──
        line_patterns = [
            r'^(?:User says|User\'s? (?:question|message|request|input))[\s:].*$',
            r'^(?:Thinking|Let me think|Analyzing|Processing|Рассуждаю|Анализирую|Думаю)[\s:].*$',
            r'^(?:System|Instructions?|Context|Note to self)[\s:].*$',
            r'^(?:Step \d+|Шаг \d+)[\s:].*$',
            r'^\[(?:THINKING|REASONING|ANALYSIS|РАССУЖДЕНИЕ|INTERNAL)\].*$',
            r'^(?:I need to|I should|I will|I\'ll|Let me|We need to|We should|According to)[\s].*$',
            r'^(?:The user|This user|They want|They\'re asking)[\s].*$',
            r'^(?:OK so|Okay so|Alright|Hmm|Wait,)[\s].*$',
            r'^(?:Based on the (?:instructions|guidelines|rules|context))[\s,].*$',
            r'^(?:My (?:task|job|role|goal) (?:is|here))[\s].*$',
        ]
        for pattern in line_patterns:
            cleaned = re.sub(pattern, '', cleaned, flags=re.MULTILINE | re.IGNORECASE)

        # ── Phase 2: strip leading English reasoning block before Cyrillic answer ──
        # Many models dump reasoning in English then answer in Russian.
        # Detect: if text starts with non-Cyrillic lines and Cyrillic appears later,
        # strip everything before the first Cyrillic paragraph.
        has_cyrillic = bool(re.search(r'[а-яА-ЯёЁ]', cleaned))
        if has_cyrillic:
            lines = cleaned.split('\n')
            first_cyrillic_idx = None
            for i, line in enumerate(lines):
                stripped = line.strip()
                if not stripped:
                    continue
                # A line is "Cyrillic" if it contains Cyrillic characters
                if re.search(r'[а-яА-ЯёЁ]', stripped):
                    first_cyrillic_idx = i
                    break

            if first_cyrillic_idx is not None and first_cyrillic_idx > 0:
                # Check if lines before are purely English reasoning (no Cyrillic at all)
                prefix_lines = lines[:first_cyrillic_idx]
                prefix_text = '\n'.join(prefix_lines).strip()
                if prefix_text and not re.search(r'[а-яА-ЯёЁ]', prefix_text):
                    # All lines before first Cyrillic are English-only — strip them
                    cleaned = '\n'.join(lines[first_cyrillic_idx:])

        # ── Phase 3: cleanup ──
        cleaned = re.sub(r'\n{3,}', '\n\n', cleaned).strip()
        return cleaned

    @staticmethod
    def _clean_step_content(text: str) -> str:
        """Strip thinking tags from step display content."""
        cleaned = re.sub(r'<thinking>.*?</thinking>', lambda m: m.group(0)[len('<thinking>'):-len('</thinking>')], text, flags=re.DOTALL)
        cleaned = cleaned.replace('<thinking>', '').replace('</thinking>', '')
        return cleaned.strip()

    @staticmethod
    def _check_clarification(text: str) -> tuple[bool, str]:
        """Check if model is asking for clarification."""
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
        messages = list(messages)  # Work on a copy to avoid mutating the caller's list

        # Detect domain (and optionally classify complexity) in parallel
        if strategy == ReasoningStrategy.AUTO:
            # Run ambiguity check, complexity classification, and domain detection in parallel
            (is_ambiguous, clarification_q), classified_strategy, domain = await asyncio.gather(
                self._check_ambiguity(messages),
                self._classify_complexity(messages),
                self._detect_domain(messages),
            )
            if is_ambiguous:
                yield {"event": "clarification_needed", "data": {"question": clarification_q}}
                return
            strategy = classified_strategy
        else:
            domain = await self._detect_domain(messages)

        # Build persona with the RESOLVED strategy (not "auto")
        persona = PersonaBuilder.build(domain, strategy.value, session_context)
        if session_context:
            session_context.last_persona = persona

        # Inject/update system prompt in messages
        if messages and messages[0].role == "system":
            messages[0] = LLMMessage(role="system", content=persona)
        else:
            messages.insert(0, LLMMessage(role="system", content=persona))

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
                "persona_detail": f"{DOMAIN_LABELS.get(domain, domain)} · {label}",
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

        elif strategy == ReasoningStrategy.PERSONA_COUNCIL:
            async for chunk in self._run_persona_council(messages, steps, persona):
                yield chunk

        elif strategy == ReasoningStrategy.RUBBER_DUCK:
            async for chunk in self._run_rubber_duck(messages, steps, persona):
                yield chunk

        elif strategy == ReasoningStrategy.SOCRATIC:
            async for chunk in self._run_socratic(messages, steps, persona):
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


    # ── Strategy: Passthrough (no reasoning) ──

    async def _run_passthrough(self, messages: list[LLMMessage], persona: str) -> AsyncIterator[dict]:
        # run() guarantees messages[0] is the system prompt
        req = LLMRequest(messages=list(messages), model=self.model)
        async for chunk in self.provider.stream(req):
            if chunk.content:
                yield {"event": "content_delta", "data": {"content": chunk.content}}

    # ── Strategy: Chain-of-Thought Injection ──

    async def _run_cot(self, messages: list[LLMMessage], steps: list[ThinkingStep], persona: str) -> AsyncIterator[dict]:
        # run() guarantees messages[0] is the system prompt
        cot_messages = list(messages)
        cot_messages[0] = LLMMessage(role="system", content=cot_messages[0].content + "\n\n" + COT_SYSTEM_PROMPT)
        req = LLMRequest(messages=cot_messages, model=self.model, temperature=0.3)

        step_start = time.monotonic()
        chunks: list[str] = []

        # Buffer ALL content first (don't stream yet) — extract thinking before yielding
        async for chunk in self.provider.stream(req):
            if chunk.content:
                chunks.append(chunk.content)

        full_response = "".join(chunks)
        step_ms = int((time.monotonic() - step_start) * 1000)

        # Extract thinking content into panel
        thinking_text = ""
        answer_text = full_response
        if "<thinking>" in full_response:
            # Extract all thinking blocks
            thinking_blocks = re.findall(r'<thinking>(.*?)</thinking>', full_response, flags=re.DOTALL)
            thinking_text = "\n\n".join(b.strip() for b in thinking_blocks if b.strip())
            # Remove thinking tags from answer
            answer_text = re.sub(r'<thinking>.*?</thinking>', '', full_response, flags=re.DOTALL)
            answer_text = answer_text.replace('<thinking>', '').replace('</thinking>', '').strip()

        steps.append(ThinkingStep(
            step_number=1,
            strategy="cot",
            content="Выстраиваю цепочку рассуждений",
            duration_ms=step_ms,
            metadata={"type": "reasoning"},
        ))

        if thinking_text:
            steps.append(ThinkingStep(
                step_number=2,
                strategy="cot",
                content="Проверяю логику ответа",
                duration_ms=0,
                metadata={"type": "extracted_thinking", "content": self._clean_step_content(thinking_text)},
            ))
            yield {
                "event": "thinking_step",
                "data": {
                    "step": 2,
                    "label": "Ход мысли",
                    "type": "extracted_thinking",
                    "content": self._clean_step_content(thinking_text)[:500],
                },
            }

        # Strip any remaining meta-text from the answer
        answer_text = self._strip_meta_text(answer_text) if answer_text else ""

        # Now stream ONLY the clean answer (without thinking content)
        for chunk in self._chunk_text(answer_text):
            yield {"event": "content_delta", "data": {"content": chunk}}

    # ── Strategy: Budget Forcing (s1-approach) ──

    async def _run_budget_forcing(
        self, messages: list[LLMMessage], steps: list[ThinkingStep], rounds: int, persona: str
    ) -> AsyncIterator[dict]:
        # run() guarantees messages[0] is the system prompt
        cot_messages = list(messages)

        prev_round_content = ""

        for round_num in range(rounds):
            step_start = time.monotonic()
            is_last_round = (round_num == rounds - 1)

            if round_num == 0:
                yield {
                    "event": "thinking_step",
                    "data": {
                        "step": 1,
                        "label": "Анализирую запрос и формирую первичный ответ",
                        "type": "reasoning",
                        "content": "",
                    },
                }

            if round_num > 0:
                # Append previous round output + deepening/final instruction
                cot_messages.append(LLMMessage(role="assistant", content=prev_round_content))
                continuation = BUDGET_FORCING_FINAL if is_last_round else BUDGET_FORCING_CONTINUATION
                cot_messages.append(LLMMessage(role="user", content=continuation))
                yield {
                    "event": "thinking_step",
                    "data": {
                        "step": round_num + 1,
                        "label": f"Углубляю анализ — проход {round_num + 1}",
                        "type": "reasoning",
                        "content": "",
                    },
                }

            req = LLMRequest(
                messages=cot_messages,
                model=self.model,
                temperature=0.3 + (round_num * 0.1),
                max_tokens=2048,
            )

            round_chunks: list[str] = []
            async for chunk in self.provider.stream(req):
                if chunk.content:
                    round_chunks.append(chunk.content)
                    # Only stream the last round to user
                    if is_last_round:
                        yield {"event": "content_delta", "data": {"content": chunk.content}}

            round_content = "".join(round_chunks)

            if not is_last_round:
                # Stream intermediate round content to thinking panel
                clean = self._clean_step_content(round_content)
                yield {
                    "event": "thinking_step",
                    "data": {
                        "step": round_num + 1,
                        "label": f"Проверяю и дополняю рассуждения",
                        "type": "reasoning",
                        "content": clean[:600] if clean else "",
                    },
                }

            prev_round_content = round_content
            step_ms = int((time.monotonic() - step_start) * 1000)

            # Clean tags for step display
            clean = self._clean_step_content(round_content)
            _round_label = (
                "Анализирую запрос и формирую ответ" if round_num == 0
                else f"Углубляю анализ — проход {round_num + 1}"
            )
            steps.append(ThinkingStep(
                step_number=round_num + 1,
                strategy="budget_forcing",
                content=_round_label,
                duration_ms=step_ms,
                metadata={"type": "reasoning", "round": round_num + 1, "content": clean[:500]},
            ))

    # ── Strategy: Best-of-N ──

    async def _run_best_of_n(
        self, messages: list[LLMMessage], steps: list[ThinkingStep], n: int, persona: str
    ) -> AsyncIterator[dict]:
        yield {
            "event": "thinking_step",
            "data": {"step": 1, "label": f"Генерирую {n} независимых вариантов ответа", "type": "candidate", "content": ""},
        }

        # Generate N responses in parallel (run() guarantees messages[0] is the system prompt)
        cot_messages = list(messages)

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
            clean = self._clean_step_content(content)
            steps.append(ThinkingStep(
                step_number=idx + 1,
                strategy="best_of_n",
                content=f"Вариант {idx + 1} сформирован",
                duration_ms=int((time.monotonic() - step_start) * 1000),
                metadata={"candidate": idx + 1, "type": "candidate", "content": clean[:400]},
            ))

        gen_ms = int((time.monotonic() - step_start) * 1000)

        if not candidates:
            error_detail = "; ".join(errors[:3]) if errors else "Неизвестная ошибка"
            yield {"event": "content_delta", "data": {"content": f"Ошибка: не удалось сгенерировать ответы. {error_detail}"}}
            return

        yield {
            "event": "thinking_step",
            "data": {"step": n + 1, "label": "Сравниваю варианты и выбираю лучший", "type": "vote", "content": ""},
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
        best_answer = self._strip_thinking_tags(candidates[best_idx])

        vote_ms = int((time.monotonic() - vote_start) * 1000)
        steps.append(ThinkingStep(
            step_number=n + 2,
            strategy="best_of_n",
            content=f"Лучший вариант: #{best_idx + 1}",
            duration_ms=vote_ms,
            metadata={"type": "vote", "winner": best_idx + 1, "content": vote_resp.content[:300]},
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
            "data": {"step": 1, "label": "Строю дерево подходов к решению", "type": "reasoning", "content": ""},
        }

        # Level 0: Generate initial thought branches
        step_num = 1
        tree: list[dict] = []

        for level in range(depth):
            yield {
                "event": "thinking_step",
                "data": {
                    "step": step_num,
                    "label": f"Исследую {breadth} направлений на глубине {level + 1}",
                    "type": "branch",
                    "content": "",
                },
            }

            parent_id = None
            if level == 0:
                branches = await self._generate_branches(user_query, None, breadth)
            else:
                # Take the best branch from previous level and expand
                prev_level_nodes = [n for n in tree if n["level"] == level - 1]
                best_branch = max(prev_level_nodes, key=lambda b: b.get("score", 0))
                parent_id = best_branch["id"]
                branches = await self._generate_branches(
                    user_query, best_branch["thought"], breadth
                )

            # Score all branches in parallel
            score_tasks = [self._score_branch(user_query, branch) for branch in branches]
            scores = await asyncio.gather(*score_tasks, return_exceptions=True)

            scored_branches = []
            for i, branch in enumerate(branches):
                raw_score = scores[i] if i < len(scores) else 0.5
                score = raw_score if isinstance(raw_score, float) else 0.5
                branch_node = {
                    "id": f"L{level}-B{i}",
                    "level": level,
                    "thought": branch,
                    "score": score,
                    "parent": parent_id,
                }
                scored_branches.append(branch_node)
                tree.append(branch_node)

                step_num += 1
                steps.append(ThinkingStep(
                    step_number=step_num,
                    strategy="tree_of_thoughts",
                    content=f"Направление {i + 1}: {branch[:100]}",
                    duration_ms=0,
                    metadata={
                        "type": "branch",
                        "level": level,
                        "branch": i,
                        "score": score,
                        "node_id": branch_node["id"],
                        "parent": parent_id,
                        "content": branch[:300],
                    },
                ))

            yield {
                "event": "thinking_step",
                "data": {
                    "step": step_num,
                    "label": f"Оцениваю {len(scored_branches)} направлений",
                    "type": "branch",
                    "content": "\n".join(
                        f"{b['thought'][:80]}  →  {b['score']:.1f}"
                        for b in scored_branches
                    ),
                },
            }

        # Synthesize final answer from the best path
        best_path = self._get_best_path(tree)
        yield {
            "event": "thinking_step",
            "data": {"step": step_num + 1, "label": "Формирую ответ на основе лучшего пути", "type": "synthesis", "content": ""},
        }

        synthesis = await self._synthesize_from_tree(user_query, best_path)
        synthesis = self._strip_thinking_tags(synthesis)
        for chunk in self._chunk_text(synthesis):
            yield {"event": "content_delta", "data": {"content": chunk}}

        steps.append(ThinkingStep(
            step_number=step_num + 2,
            strategy="tree_of_thoughts",
            content="Формирую ответ на основе лучшего пути",
            metadata={
                "type": "synthesis",
                "best_path": [b["id"] for b in best_path],
            },
        ))

    # ── Strategy: Socratic ──

    SOCRATIC_QUESTIONS_PROMPT = """Тебе задан вопрос. Вместо прямого ответа — сгенерируй ровно 3 ключевых подвопроса, ответы на которые необходимы для полного ответа на исходный вопрос.

Вопрос: {question}

Требования к подвопросам:
— Каждый раскрывает отдельный важный аспект
— Вместе они покрывают тему с разных сторон
— Формулировки конкретные, не общие

Ответь СТРОГО в формате (3 строки, каждая начинается с цифры):
1. <подвопрос>
2. <подвопрос>
3. <подвопрос>

Ничего кроме трёх пронумерованных строк."""

    SOCRATIC_ANSWER_PROMPT = """Ответь на следующий вопрос подробно и по существу.

Вопрос: {subquestion}

Контекст — это часть более широкого вопроса: {original_question}

Отвечай на языке пользователя. Будь конкретен и лаконичен (3–6 предложений)."""

    SOCRATIC_SYNTHESIS_PROMPT = """Пользователь задал вопрос. Ты провёл сократический анализ: разбил его на подвопросы и ответил на каждый.

Исходный вопрос: {question}

{qa_pairs}

Синтезируй ответы в единый, целостный, хорошо структурированный финальный ответ.
— Не перечисляй подвопросы по отдельности
— Дай связный ответ, естественно интегрирующий все инсайты
— Отвечай на языке пользователя, чётко и по существу
— НЕ используй теги <thinking>. Пиши ТОЛЬКО финальный ответ."""

    async def _run_socratic(
        self, messages: list[LLMMessage], steps: list[ThinkingStep], persona: str,
    ) -> AsyncIterator[dict]:
        user_query = messages[-1].content

        # ── Step 1: Generate sub-questions ──
        yield {
            "event": "thinking_step",
            "data": {"step": 1, "label": "Формулирую ключевые подвопросы", "type": "socratic_questions", "content": ""},
        }

        q_prompt = self.SOCRATIC_QUESTIONS_PROMPT.format(question=user_query)
        q_req = LLMRequest(
            messages=[
                LLMMessage(role="system", content=persona),
                LLMMessage(role="user", content=q_prompt),
            ],
            model=self.model,
            temperature=0.5,
            max_tokens=512,
        )

        step_start = time.monotonic()
        q_resp = await self.provider.complete(q_req)
        q_ms = int((time.monotonic() - step_start) * 1000)

        # Parse numbered lines
        raw_lines = [l.strip() for l in q_resp.content.strip().split("\n") if l.strip()]
        subquestions: list[str] = []
        for line in raw_lines:
            cleaned = line.lstrip("0123456789.)- ").strip()
            if cleaned:
                subquestions.append(cleaned)
        subquestions = subquestions[:3]

        if not subquestions:
            # Fallback: use the original question
            subquestions = [user_query]

        steps.append(ThinkingStep(
            step_number=1,
            strategy="socratic",
            content="Подвопросы сформулированы",
            duration_ms=q_ms,
            metadata={"type": "socratic_questions", "questions": subquestions},
        ))

        yield {
            "event": "thinking_step",
            "data": {
                "step": 1, "label": f"Сформулировано {len(subquestions)} подвопросов",
                "type": "socratic_questions",
                "content": "\n".join(f"{i+1}. {q}" for i, q in enumerate(subquestions)),
            },
        }

        # ── Step 2: Answer each sub-question in parallel ──
        async def answer_subquestion(idx: int, sq: str) -> tuple[int, str, str]:
            a_prompt = self.SOCRATIC_ANSWER_PROMPT.format(
                subquestion=sq,
                original_question=user_query,
            )
            a_req = LLMRequest(
                messages=[
                    LLMMessage(role="system", content=persona),
                    LLMMessage(role="user", content=a_prompt),
                ],
                model=self.model,
                temperature=0.3,
                max_tokens=1024,
            )
            resp = await self.provider.complete(a_req)
            return idx, sq, resp.content

        yield {
            "event": "thinking_step",
            "data": {"step": 2, "label": "Отвечаю на каждый подвопрос", "type": "socratic_answering", "content": ""},
        }

        step_start = time.monotonic()
        tasks = [answer_subquestion(i, sq) for i, sq in enumerate(subquestions)]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        qa_pairs: list[tuple[str, str]] = []
        for r in results:
            if isinstance(r, Exception):
                logger.warning("Socratic sub-answer failed: %s", r)
                continue
            idx, sq, answer = r
            answer_clean = self._strip_thinking_tags(answer)
            qa_pairs.append((sq, answer_clean))
            a_ms = int((time.monotonic() - step_start) * 1000)

            steps.append(ThinkingStep(
                step_number=idx + 2,
                strategy="socratic",
                content=f"Подвопрос {idx + 1}",
                duration_ms=a_ms,
                metadata={
                    "type": "socratic_answer",
                    "question": sq,
                    "content": self._clean_step_content(answer_clean)[:400],
                },
            ))

            yield {
                "event": "thinking_step",
                "data": {
                    "step": idx + 2,
                    "label": f"Подвопрос {idx + 1}: {sq[:60]}",
                    "type": "socratic_answer",
                    "content": self._clean_step_content(answer_clean)[:300],
                },
            }

        if not qa_pairs:
            yield {"event": "content_delta", "data": {"content": "Ошибка: не удалось ответить на подвопросы."}}
            return

        # ── Step 3: Synthesize ──
        yield {
            "event": "thinking_step",
            "data": {
                "step": len(subquestions) + 2,
                "label": "Синтезирую финальный ответ",
                "type": "socratic_synthesis",
                "content": "",
            },
        }

        qa_text = "\n\n".join(
            f"Подвопрос: {sq}\nОтвет: {ans}"
            for sq, ans in qa_pairs
        )
        synth_prompt = self.SOCRATIC_SYNTHESIS_PROMPT.format(
            question=user_query,
            qa_pairs=qa_text,
        )

        synth_req = LLMRequest(
            messages=[
                LLMMessage(role="system", content=persona),
                LLMMessage(role="user", content=synth_prompt),
            ],
            model=self.model,
            temperature=0.3,
            max_tokens=4096,
        )

        synth_start = time.monotonic()
        async for chunk in self.provider.stream(synth_req):
            if chunk.content:
                yield {"event": "content_delta", "data": {"content": chunk.content}}

        synth_ms = int((time.monotonic() - synth_start) * 1000)
        steps.append(ThinkingStep(
            step_number=len(subquestions) + 3,
            strategy="socratic",
            content="Синтез ответов завершён",
            duration_ms=synth_ms,
            metadata={"type": "socratic_synthesis"},
        ))

    # ── Strategy: Rubber Duck Debug ──

    RUBBER_DUCK_DRAFT_PROMPT = """Ответь на вопрос пользователя. Дай полный черновой ответ.
Не упрощай — отвечай так, как считаешь правильным. Это черновик, который будет проверен."""

    RUBBER_DUCK_EXPLAIN_PROMPT = """Ты только что дал черновой ответ на вопрос. Теперь объясни свой ответ максимально просто — так, чтобы понял пятиклассник.

Вопрос пользователя: {question}

Твой черновой ответ:
{draft}

Правила объяснения:
— Используй простые слова, аналогии из повседневной жизни
— Каждый шаг логики — отдельным предложением
— Если какой-то шаг НЕЛЬЗЯ объяснить просто — значит, в нём возможна ошибка. Отметь это явно: [⚠️ СОМНИТЕЛЬНО: ...]
— Если обнаружишь противоречие или логическую дыру — отметь: [❌ ОШИБКА: ...]
— В конце дай вердикт: черновик верный, или содержит ошибки

Формат:
ОБЪЯСНЕНИЕ:
(простое объяснение по шагам)

НАЙДЕННЫЕ ПРОБЛЕМЫ:
(список или «Проблем не обнаружено»)"""

    RUBBER_DUCK_FIX_PROMPT = """Ты проверил свой черновой ответ через упрощённое объяснение и нашёл проблемы.

Вопрос: {question}

Черновик: {draft}

Результат проверки: {review}

Дай ФИНАЛЬНЫЙ исправленный ответ. Если проблем не было — дай улучшенную версию черновика.
Отвечай чётко, по существу, на языке пользователя. БЕЗ мета-комментариев типа «я исправил...».
НЕ используй теги <thinking>. Пиши ТОЛЬКО финальный ответ."""

    async def _run_rubber_duck(
        self, messages: list[LLMMessage], steps: list[ThinkingStep], persona: str,
    ) -> AsyncIterator[dict]:
        user_query = messages[-1].content

        # ── Step 1: Draft ──
        yield {
            "event": "thinking_step",
            "data": {"step": 1, "label": "Формирую черновой ответ", "type": "rubber_duck_draft", "content": ""},
        }

        draft_messages = list(messages)
        if draft_messages and draft_messages[0].role == "system":
            draft_messages[0] = LLMMessage(
                role="system",
                content=draft_messages[0].content + "\n\n" + self.RUBBER_DUCK_DRAFT_PROMPT,
            )

        draft_req = LLMRequest(
            messages=draft_messages,
            model=self.model,
            temperature=0.3,
            max_tokens=2048,
        )

        step_start = time.monotonic()
        draft_chunks: list[str] = []
        async for chunk in self.provider.stream(draft_req):
            if chunk.content:
                draft_chunks.append(chunk.content)

        draft = "".join(draft_chunks)
        draft_clean = self._strip_thinking_tags(draft)
        draft_ms = int((time.monotonic() - step_start) * 1000)

        steps.append(ThinkingStep(
            step_number=1,
            strategy="rubber_duck",
            content="Черновой ответ сформирован",
            duration_ms=draft_ms,
            metadata={"type": "rubber_duck_draft", "content": self._clean_step_content(draft_clean)[:500]},
        ))

        yield {
            "event": "thinking_step",
            "data": {
                "step": 1, "label": "Черновик готов",
                "type": "rubber_duck_draft",
                "content": self._clean_step_content(draft_clean)[:400],
            },
        }

        # ── Step 2: Explain like I'm 5 → find errors ──
        yield {
            "event": "thinking_step",
            "data": {"step": 2, "label": "🦆 Объясняю как пятикласснику — ищу ошибки", "type": "rubber_duck_review", "content": ""},
        }

        explain_prompt = self.RUBBER_DUCK_EXPLAIN_PROMPT.format(
            question=user_query,
            draft=draft_clean,
        )
        explain_req = LLMRequest(
            messages=[
                LLMMessage(role="system", content=persona),
                LLMMessage(role="user", content=explain_prompt),
            ],
            model=self.model,
            temperature=0.2,
            max_tokens=2048,
        )

        step_start = time.monotonic()
        review_chunks: list[str] = []
        async for chunk in self.provider.stream(explain_req):
            if chunk.content:
                review_chunks.append(chunk.content)

        review = "".join(review_chunks)
        review_clean = self._strip_thinking_tags(review)
        review_ms = int((time.monotonic() - step_start) * 1000)

        steps.append(ThinkingStep(
            step_number=2,
            strategy="rubber_duck",
            content="Проверка через объяснение завершена",
            duration_ms=review_ms,
            metadata={"type": "rubber_duck_review", "content": self._clean_step_content(review_clean)[:500]},
        ))

        yield {
            "event": "thinking_step",
            "data": {
                "step": 2, "label": "🦆 Проверка завершена",
                "type": "rubber_duck_review",
                "content": self._clean_step_content(review_clean)[:400],
            },
        }

        # ── Step 3: Fix and finalize ──
        yield {
            "event": "thinking_step",
            "data": {"step": 3, "label": "Формирую финальный ответ с исправлениями", "type": "rubber_duck_fix", "content": ""},
        }

        fix_prompt = self.RUBBER_DUCK_FIX_PROMPT.format(
            question=user_query,
            draft=draft_clean,
            review=review_clean,
        )
        fix_req = LLMRequest(
            messages=[
                LLMMessage(role="system", content=persona),
                LLMMessage(role="user", content=fix_prompt),
            ],
            model=self.model,
            temperature=0.3,
            max_tokens=4096,
        )

        step_start = time.monotonic()
        async for chunk in self.provider.stream(fix_req):
            if chunk.content:
                yield {"event": "content_delta", "data": {"content": chunk.content}}

        fix_ms = int((time.monotonic() - step_start) * 1000)
        steps.append(ThinkingStep(
            step_number=3,
            strategy="rubber_duck",
            content="Финальный ответ с учётом найденных проблем",
            duration_ms=fix_ms,
            metadata={"type": "rubber_duck_fix"},
        ))

    # ── Strategy: Persona Council ──

    COUNCIL_PERSONAS = [
        {
            "name": "Скептик-учёный",
            "emoji": "🔬",
            "system": (
                "Ты — скептик-учёный. Твой подход: научная строгость и доказательность. "
                "Для каждого утверждения спрашивай: где доказательства? Что можно измерить или проверить? "
                "Указывай на логические ошибки, когнитивные искажения и необоснованные допущения. "
                "Будь лаконичен, конкретен и критичен. Отвечай на языке пользователя."
            ),
        },
        {
            "name": "Практик",
            "emoji": "🔧",
            "system": (
                "Ты — практик с многолетним опытом. Твой подход: что реально работает на практике? "
                "Оценивай осуществимость, затраты, сроки, реальные ограничения. "
                "Приводи примеры из практики. Отбрасывай теоретически красивые, но нереализуемые идеи. "
                "Будь лаконичен и конкретен. Отвечай на языке пользователя."
            ),
        },
        {
            "name": "Адвокат дьявола",
            "emoji": "⚖️",
            "system": (
                "Ты — адвокат дьявола. Твоя задача: найти слабые места, риски и контраргументы. "
                "Что может пойти не так? Какие скрытые предположения? Какие альтернативные объяснения? "
                "Атакуй каждый аргумент, чтобы проверить его прочность. "
                "Будь провокативен, но конструктивен. Отвечай на языке пользователя."
            ),
        },
        {
            "name": "Визионер",
            "emoji": "🚀",
            "system": (
                "Ты — визионер-стратег. Твой подход: идеальная версия, стратегическое мышление, долгосрочная перспектива. "
                "Каков максимальный потенциал? Какие неочевидные возможности? Как это может изменить картину в целом? "
                "Мысли масштабно, но обосновывай. Отвечай на языке пользователя."
            ),
        },
    ]

    COUNCIL_MODERATOR_PROMPT = """Ты — модератор совета экспертов. Тебе предоставлены мнения четырёх экспертов по вопросу пользователя.

Вопрос: {question}

{opinions}

Твоя задача — синтезировать мнения в единый взвешенный ответ:
1. Выдели ключевые инсайты каждого эксперта
2. Найди точки согласия и расхождения
3. Сформулируй сбалансированный ответ, учитывающий все перспективы
4. Если эксперты расходятся — объясни почему и какой подход предпочтительнее в данном контексте

Отвечай чётко и структурированно на языке пользователя. НЕ перечисляй мнения экспертов по отдельности — дай СИНТЕЗ.
НЕ используй теги <thinking>. Пиши ТОЛЬКО финальный ответ."""

    async def _run_persona_council(
        self, messages: list[LLMMessage], steps: list[ThinkingStep], persona: str,
    ) -> AsyncIterator[dict]:
        user_query = messages[-1].content
        council = self.COUNCIL_PERSONAS

        yield {
            "event": "thinking_step",
            "data": {
                "step": 1,
                "label": f"Созываю совет из {len(council)} экспертов",
                "type": "council_init",
                "content": ", ".join(f"{p['emoji']} {p['name']}" for p in council),
            },
        }

        # Generate all expert opinions in parallel
        async def get_opinion(idx: int, p: dict) -> tuple[int, dict, str]:
            expert_messages = [
                LLMMessage(role="system", content=p["system"]),
                *[m for m in messages if m.role != "system"],
            ]
            req = LLMRequest(
                messages=expert_messages,
                model=self.model,
                temperature=0.5 + (idx * 0.05),
            )
            resp = await self.provider.complete(req)
            return idx, p, resp.content

        step_start = time.monotonic()
        tasks = [get_opinion(i, p) for i, p in enumerate(council)]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        opinions: list[tuple[dict, str]] = []
        for r in results:
            if isinstance(r, Exception):
                logger.warning("Council member failed: %s", r)
                continue
            idx, p, content = r
            content = self._strip_thinking_tags(content)
            opinions.append((p, content))
            step_ms = int((time.monotonic() - step_start) * 1000)

            clean = self._clean_step_content(content)
            steps.append(ThinkingStep(
                step_number=idx + 2,
                strategy="persona_council",
                content=f"{p['emoji']} {p['name']}",
                duration_ms=step_ms,
                metadata={
                    "type": "council_opinion",
                    "persona": p["name"],
                    "emoji": p["emoji"],
                    "content": clean[:500],
                },
            ))
            yield {
                "event": "thinking_step",
                "data": {
                    "step": idx + 2,
                    "label": f"{p['emoji']} {p['name']} высказался",
                    "type": "council_opinion",
                    "content": clean[:400],
                },
            }

        if not opinions:
            yield {"event": "content_delta", "data": {"content": "Ошибка: ни один эксперт не ответил."}}
            return

        # Moderator synthesizes
        yield {
            "event": "thinking_step",
            "data": {
                "step": len(council) + 2,
                "label": "Модератор синтезирует мнения",
                "type": "council_synthesis",
                "content": "",
            },
        }

        opinions_text = "\n\n".join(
            f"### {p['emoji']} {p['name']}:\n{content}"
            for p, content in opinions
        )
        moderator_prompt = self.COUNCIL_MODERATOR_PROMPT.format(
            question=user_query,
            opinions=opinions_text,
        )

        synth_req = LLMRequest(
            messages=[
                LLMMessage(role="system", content=persona),
                LLMMessage(role="user", content=moderator_prompt),
            ],
            model=self.model,
            temperature=0.3,
            max_tokens=4096,
        )

        synth_start = time.monotonic()
        async for chunk in self.provider.stream(synth_req):
            if chunk.content:
                yield {"event": "content_delta", "data": {"content": chunk.content}}

        synth_ms = int((time.monotonic() - synth_start) * 1000)
        steps.append(ThinkingStep(
            step_number=len(council) + 3,
            strategy="persona_council",
            content="Синтез мнений совета",
            duration_ms=synth_ms,
            metadata={"type": "council_synthesis"},
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
        except Exception as e:
            logger.warning("Domain detection failed: %s", e)
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
            match = re.search(r'[1-5]', content)
            score = int(match.group()) if match else 3
        except Exception as e:
            logger.warning("Complexity classification failed: %s", e)
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
        except Exception as e:
            logger.warning("Ambiguity check failed: %s", e)
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

        prompt = f"""Оцени перспективность этой линии рассуждений для ответа на вопрос.

Вопрос: {query}
Рассуждение: {thought}

Насколько это перспективный подход? Ответь ОДНИМ числом от 0.0 до 1.0 (например: 0.7). Ничего кроме числа."""

        req = LLMRequest(
            messages=[LLMMessage(role="user", content=prompt)],
            model=self.model,
            temperature=0.0,
            max_tokens=30,
        )
        try:
            resp = await self.provider.complete(req)
            content = (resp.content or "").strip()
            # Try to extract a float from the response
            match = re.search(r'(0\.\d+|1\.0|0|1)', content)
            if match:
                score = float(match.group(1))
                return max(0.05, min(1.0, score))  # clamp, never exactly 0
            # Fallback: try to find any number
            match = re.search(r'(\d+\.?\d*)', content)
            if match:
                score = float(match.group(1))
                if score > 1.0:
                    score = score / 10.0  # handle "7" meaning 0.7
                return max(0.05, min(1.0, score))
            logger.warning("Score parse failed for response: %r", content)
        except Exception as e:
            logger.warning("Branch scoring error: %s", e)
        return 0.5

    def _get_best_path(self, tree: list[dict]) -> list[dict]:
        """Get the highest-scoring root-to-leaf path following parent-child links."""
        if not tree:
            return []

        # Index children by parent id
        children_map: dict[str | None, list[dict]] = {}
        for node in tree:
            children_map.setdefault(node.get("parent"), []).append(node)

        # DFS from roots (parent=None), track best average-score path
        best_path: list[dict] = []
        best_avg = -1.0

        def dfs(node: dict, path: list[dict], total: float) -> None:
            nonlocal best_path, best_avg
            path.append(node)
            new_total = total + node.get("score", 0)
            kids = children_map.get(node["id"], [])
            if not kids:
                avg = new_total / len(path)
                if avg > best_avg:
                    best_avg = avg
                    best_path = list(path)
            else:
                for child in kids:
                    dfs(child, path, new_total)
            path.pop()

        for root in children_map.get(None, []):
            dfs(root, [], 0.0)

        return best_path

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
            match = re.search(r'\d+', vote_text.strip())
            if match:
                idx = int(match.group()) - 1
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
