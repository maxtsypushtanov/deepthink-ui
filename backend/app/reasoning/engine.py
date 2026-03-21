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


@dataclass
class SessionContext:
    """Tracks domain and expertise across conversation turns."""
    detected_domains: list[str] = field(default_factory=list)
    dominant_domain: str = "general"
    user_expertise_signals: list[str] = field(default_factory=list)
    conversation_turn: int = 0

    def update(self, domain: str) -> None:
        self.detected_domains.append(domain)
        self.dominant_domain = max(set(self.detected_domains), key=self.detected_domains.count)
        self.conversation_turn += 1


# ── CoT Injection Prompts ──

COT_SYSTEM_PROMPT = """You are a world-class reasoning assistant. For every question, you MUST think step by step before giving your final answer.

Structure your response as follows:
1. First, analyze the problem carefully
2. Break it down into smaller parts
3. Consider edge cases and potential pitfalls
4. Reason through each part systematically
5. Synthesize your findings into a clear conclusion

Always show your reasoning process explicitly. Start your thinking with <thinking> and end with </thinking>, then provide your final answer after.</s>"""

BUDGET_FORCING_CONTINUATION = "\n\nWait, let me reconsider and think more carefully about this..."

DOMAIN_CLASSIFIER_PROMPT = """Classify the following message into exactly one domain.
Valid domains: software_engineering, mathematics, medicine, law, finance, science, creative_writing, business, philosophy, general

Message: {message}

Respond with ONLY the domain name, nothing else."""

COMPLEXITY_CLASSIFIER_PROMPT = """Rate the complexity of the following question on a scale of 1-5:
1 = Simple factual question (e.g., "What is 2+2?")
2 = Basic explanation needed (e.g., "What is photosynthesis?")
3 = Multi-step reasoning (e.g., "Compare the economic policies of X and Y")
4 = Complex analysis (e.g., "Design an algorithm for...")
5 = Deep reasoning required (e.g., "Prove that...", "What are the implications of...")

Question: {question}

Respond with ONLY a single digit (1-5), nothing else."""


# ── Persona Builder ──

PERSONA_TEMPLATE = """You are a world-class expert in {domain}.
Reasoning style: {reasoning_style}.
User's goal: {intent_description}.
Conversation turn: {turn}. Expertise level: {expertise_level}.
Adapt depth, terminology and examples accordingly.

Structure your response clearly. When reasoning, start your thinking with <thinking> and end with </thinking>, then provide your final answer after."""

STRATEGY_PERSONA_MAP = {
    "none": {"reasoning_style": "Direct and concise", "intent_description": "Get a straightforward answer"},
    "cot": {"reasoning_style": "Step-by-step analytical thinking", "intent_description": "Understand the reasoning process"},
    "budget_forcing": {"reasoning_style": "Deep iterative reflection with self-correction", "intent_description": "Explore the problem thoroughly with multiple passes"},
    "best_of_n": {"reasoning_style": "Multi-perspective analysis with consensus", "intent_description": "Compare multiple approaches and find the best answer"},
    "tree_of_thoughts": {"reasoning_style": "Systematic exploration of reasoning branches", "intent_description": "Map out all possible approaches and evaluate each"},
    "auto": {"reasoning_style": "Adaptive based on complexity", "intent_description": "Solve the problem optimally"},
}

DOMAIN_LABELS = {
    "software_engineering": "software architect",
    "mathematics": "mathematician",
    "medicine": "medical researcher",
    "law": "legal analyst",
    "finance": "financial analyst",
    "science": "research scientist",
    "creative_writing": "creative writing expert",
    "business": "business strategist",
    "philosophy": "philosopher",
    "general": "reasoning assistant",
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

        return PERSONA_TEMPLATE.format(
            domain=DOMAIN_LABELS.get(domain, "reasoning assistant"),
            reasoning_style=persona_map["reasoning_style"],
            intent_description=persona_map["intent_description"],
            turn=turn,
            expertise_level=expertise_level,
        )

    @staticmethod
    def get_label(strategy: str) -> str:
        labels = {
            "none": "Direct answer",
            "cot": "Step-by-step reasoning",
            "budget_forcing": "Deep iterative analysis",
            "best_of_n": "Multi-perspective analysis",
            "tree_of_thoughts": "Systematic tree exploration",
            "auto": "Adaptive reasoning",
        }
        return labels.get(strategy, "Reasoning")

    @staticmethod
    def get_preview(domain: str) -> str:
        return f"World-class {DOMAIN_LABELS.get(domain, 'reasoning assistant')}"


class ReasoningEngine:
    """Orchestrates reasoning strategies over any LLM provider."""

    def __init__(self, provider: BaseLLMProvider, model: str):
        self.provider = provider
        self.model = model

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

        # Build dynamic persona
        persona = PersonaBuilder.build(domain, strategy.value, session_context)
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
        persona_messages = [LLMMessage(role="system", content=persona)] + messages
        req = LLMRequest(messages=persona_messages, model=self.model)
        async for chunk in self.provider.stream(req):
            if chunk.content:
                yield {"event": "content_delta", "data": {"content": chunk.content}}

    # ── Strategy: Chain-of-Thought Injection ──

    async def _run_cot(self, messages: list[LLMMessage], steps: list[ThinkingStep], persona: str) -> AsyncIterator[dict]:
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
            content="Applied Chain-of-Thought system prompt injection",
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
                        "label": f"Budget forcing round {round_num + 1}",
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
            "data": {"step": 1, "label": f"Generating {n} candidate answers...", "type": "best_of_n"},
        }

        # Generate N responses in parallel
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
        for r in results:
            if isinstance(r, Exception):
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
            yield {"event": "content_delta", "data": {"content": "Error: All candidates failed."}}
            return

        yield {
            "event": "thinking_step",
            "data": {"step": n + 1, "label": "Voting for the best answer...", "type": "voting"},
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
            "data": {"step": 1, "label": "Building reasoning tree...", "type": "tree_init"},
        }

        # Level 0: Generate initial thought branches
        step_num = 1
        tree: list[dict] = []

        for level in range(depth):
            yield {
                "event": "thinking_step",
                "data": {
                    "step": step_num,
                    "label": f"Depth {level + 1}: Exploring {breadth} branches...",
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
                    "label": f"Depth {level + 1}: Scored {len(scored_branches)} branches",
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
            "data": {"step": step_num + 1, "label": "Synthesizing final answer...", "type": "tree_synthesis"},
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
            max_tokens=10,
        )

        try:
            resp = await self.provider.complete(req)
            domain = resp.content.strip().lower().replace(" ", "_")
            if domain in VALID_DOMAINS:
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
            score = int(resp.content.strip()[0])
        except (ValueError, IndexError):
            score = 3  # Default to medium

        if score <= 1:
            return ReasoningStrategy.NONE
        elif score == 2:
            return ReasoningStrategy.COT
        elif score == 3:
            return ReasoningStrategy.BUDGET_FORCING
        elif score == 4:
            return ReasoningStrategy.BEST_OF_N
        else:
            return ReasoningStrategy.TREE_OF_THOUGHTS

    # ── Tree helpers ──

    async def _generate_branches(self, query: str, parent_thought: str | None, n: int) -> list[str]:
        if parent_thought:
            prompt = f"""Given this problem: {query}

And this line of reasoning: {parent_thought}

Generate {n} DIFFERENT follow-up lines of reasoning that build on this thought. Each should explore a distinct angle or approach. Return them numbered 1-{n}, one per line."""
        else:
            prompt = f"""Given this problem: {query}

Generate {n} DIFFERENT initial approaches to solving this problem. Each should take a distinct angle. Return them numbered 1-{n}, one per line."""

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
        prompt = f"""Rate how promising this line of reasoning is for answering the question.

Question: {query}
Reasoning: {thought}

Rate from 0.0 to 1.0 where 1.0 = extremely promising. Respond with ONLY a decimal number."""

        req = LLMRequest(
            messages=[LLMMessage(role="user", content=prompt)],
            model=self.model,
            temperature=0.0,
            max_tokens=10,
        )
        try:
            resp = await self.provider.complete(req)
            return float(resp.content.strip())
        except (ValueError, Exception):
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
        prompt = f"""Based on the following reasoning path, provide a comprehensive and well-structured answer to the question.

Question: {query}

Reasoning path (best thoughts at each depth):
{thoughts}

Synthesize these insights into a clear, complete answer. Be thorough but concise."""

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
        parts = [f"Question: {question}\n\nHere are {len(candidates)} candidate answers:\n"]
        for i, c in enumerate(candidates):
            parts.append(f"--- Candidate {i + 1} ---\n{c}\n")
        parts.append(
            f"\nWhich candidate provides the best, most accurate, and most complete answer? "
            f"Respond with ONLY the candidate number (1-{len(candidates)})."
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
