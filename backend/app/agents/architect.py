"""Architect agent — uses Grounded Tree of Thoughts to explore the codebase."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.agents.base_agent import BaseAgent
from app.pipeline.context import DevLoopContext
from app.reasoning.engine import ReasoningStrategy

logger = logging.getLogger(__name__)

ARCHITECT_SYSTEM_PROMPT = """\
You are a senior software architect. You have just explored a repository \
using parallel tool calls. Based on the findings below, produce:
1. A concise specification (spec) describing *what* needs to change.
2. A list of design decisions explaining *why* each approach was chosen.

Respond in JSON:
{
  "spec": "...",
  "design_decisions": ["...", "..."]
}
"""

SYNTHESIS_PROMPT = """\
You explored the repository for the task below. Here are the relevant findings \
(sorted by relevance score):

{findings}

Task: {task}
Repository: {repo}

Prior issues (if any):
{prior_issues}

Based ONLY on these real findings from the codebase, produce a specification.
Respond in JSON:
{{"spec": "detailed spec of what to change and where", "design_decisions": ["decision 1", "decision 2"]}}
"""


class ArchitectAgent(BaseAgent):
    """Uses Grounded Tree of Thoughts to explore the codebase in parallel."""

    reasoning_strategy = ReasoningStrategy.TREE_OF_THOUGHTS
    system_prompt = ARCHITECT_SYSTEM_PROMPT

    async def run(self, context: DevLoopContext) -> DevLoopContext:
        if self.mcp_client is None:
            raise RuntimeError("ArchitectAgent requires an MCP client")

        from app.core.config import settings
        from app.providers.registry import get_provider
        from app.reasoning.gtot_engine import GToTEngine

        provider = get_provider("custom", settings.custom_api_key, settings.custom_base_url)

        # Run GToT exploration
        engine = GToTEngine(
            provider=provider,
            model=self.model,
            mcp_client=self.mcp_client,
            max_depth=2,
            max_breadth=4,
            pruning_threshold=0.5,
        )

        tree = await engine.run(
            task=context.task,
            repo=context.repo,
            event_callback=self._on_event,
        )

        # Gather top results for synthesis
        results = tree.get_all_results(min_score=0.5)
        results.sort(key=lambda n: n.score, reverse=True)

        findings = "\n\n".join(
            f"[Score {n.score:.2f}] {n.tool_name}({json.dumps(n.tool_args, ensure_ascii=False)})\n"
            f"Reasoning: {n.reasoning}\n"
            f"Result: {str(n.result)[:800]}"
            for n in results[:6]
        ) or "No relevant findings."

        prior_issues = "\n".join(
            f"- [{i.severity}] {i.description} ({i.file or 'unknown'})"
            for i in context.issues_found
        ) or "None"

        synthesis_prompt = SYNTHESIS_PROMPT.format(
            findings=findings,
            task=context.task,
            repo=context.repo,
            prior_issues=prior_issues,
        )

        # Final LLM call to synthesize spec
        from app.providers.base import LLMMessage
        from app.reasoning.engine import ReasoningEngine

        re_engine = ReasoningEngine(provider=provider, model=self.model)
        result = ""
        async for event in re_engine.run(
            messages=[
                LLMMessage(role="system", content=self.system_prompt),
                LLMMessage(role="user", content=synthesis_prompt),
            ],
            strategy=ReasoningStrategy.COT,
        ):
            if event.get("event") == "content_delta":
                chunk = event.get("data", {}).get("content", "")
                result += chunk
                await self._emit_thinking(chunk)

        # Parse
        import re
        cleaned = re.sub(r'<thinking>.*?</thinking>', '', result, flags=re.DOTALL).strip()
        try:
            parsed = json.loads(cleaned)
            context.spec = parsed.get("spec", cleaned)
            context.design_decisions = parsed.get("design_decisions", [])
        except json.JSONDecodeError:
            match = re.search(r'\{[\s\S]*"spec"[\s\S]*\}', cleaned)
            if match:
                try:
                    parsed = json.loads(match.group())
                    context.spec = parsed.get("spec", cleaned)
                    context.design_decisions = parsed.get("design_decisions", [])
                except json.JSONDecodeError:
                    context.spec = cleaned
                    context.design_decisions = []
            else:
                context.spec = cleaned
                context.design_decisions = []

        logger.info("Architect (GToT) finished — spec length=%d, decisions=%d, tree nodes=%d",
                     len(context.spec or ""), len(context.design_decisions), len(tree.get_all_results()))
        return context
