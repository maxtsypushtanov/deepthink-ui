"""Orchestrator agent — decides whether to iterate or finalise."""

from __future__ import annotations

import json
import logging

from app.agents.base_agent import BaseAgent
from app.mcp.github_tools import GitHubTools
from app.pipeline.context import DevLoopContext
from app.reasoning.engine import ReasoningStrategy

logger = logging.getLogger(__name__)

ORCHESTRATOR_SYSTEM_PROMPT = """\
You are a project orchestrator. You review test results and issues, then \
decide whether the pipeline should iterate again or is done.

Decision criteria:
- If there are critical or high severity issues -> next_iteration
- If tests pass cleanly -> done
- If tests were skipped but developer made file changes -> done
- If we've been iterating without progress -> done (with note)

Respond in JSON:
{
  "decision": "next_iteration" | "done",
  "decision_reasoning": "..."
}
"""


class OrchestratorAgent(BaseAgent):
    """Uses Auto reasoning to evaluate the pipeline state."""

    reasoning_strategy = ReasoningStrategy.AUTO
    system_prompt = ORCHESTRATOR_SYSTEM_PROMPT

    async def run(self, context: DevLoopContext) -> DevLoopContext:
        # Fast-path: tests skipped but developer made changes → done
        if context.test_results and '"status": "skipped"' in context.test_results:
            if context.code_changes:
                context.decision = "done"
                context.decision_reasoning = "Tests skipped (sandbox unavailable), but code changes were produced."
                logger.info("Orchestrator fast-path: tests skipped + changes exist → done")
                return context

        # Fast-path: iteration >= 2 and no new changes → stop looping
        if context.iteration >= 2 and not context.code_changes:
            context.decision = "done"
            context.decision_reasoning = "No new code changes in iteration — stopping to avoid infinite loop."
            logger.info("Orchestrator fast-path: no new changes in iteration %d → done", context.iteration)
            return context

        # Fast-path: iteration >= 2 and developer produced same changes as before
        if context.iteration >= 2 and context.history:
            prev = context.history[-1]
            prev_files = {c.file for c in prev.code_changes}
            curr_files = {c.file for c in context.code_changes}
            if prev_files == curr_files and prev_files:
                context.decision = "done"
                context.decision_reasoning = "Same files changed as previous iteration — no progress."
                logger.info("Orchestrator fast-path: no progress → done")
                return context

        issues_summary = "\n".join(
            f"- [{i.severity}] {i.description} ({i.file or 'unknown'})"
            for i in context.issues_found
        ) or "No issues found."

        history_summary = "\n".join(
            f"  Iteration {s.iteration}: {len(s.issues_found)} issues, decision={s.decision}"
            for s in context.history
        ) or "No previous iterations."

        user_prompt = (
            f"Task: {context.task}\n"
            f"Repository: {context.repo}\n"
            f"Current iteration: {context.iteration}\n\n"
            f"Test results:\n{context.test_results or 'No tests run.'}\n\n"
            f"Issues found this iteration:\n{issues_summary}\n\n"
            f"Iteration history:\n{history_summary}\n\n"
            f"Decide: should we iterate again or are we done?"
        )

        from app.core.config import settings
        from app.providers.registry import get_provider
        from app.reasoning.engine import ReasoningEngine
        from app.providers.base import LLMMessage

        provider = get_provider("custom", settings.custom_api_key, settings.custom_base_url)
        engine = ReasoningEngine(provider=provider, model=self.model)

        result = ""
        async for event in engine.run(
            messages=[
                LLMMessage(role="system", content=self.system_prompt),
                LLMMessage(role="user", content=user_prompt),
            ],
            strategy=self.reasoning_strategy,
        ):
            if event.get("event") == "content_delta":
                chunk = event.get("data", {}).get("content", "")
                result += chunk
                await self._emit_thinking(chunk)

        try:
            parsed = json.loads(result)
            context.decision = parsed.get("decision", "done")
            context.decision_reasoning = parsed.get("decision_reasoning", "")
        except json.JSONDecodeError:
            logger.warning("Orchestrator output was not valid JSON — defaulting to done")
            context.decision = "done"
            context.decision_reasoning = result

        # If done and MCP is available, create a pull request
        if context.decision == "done" and self.mcp_client is not None and context.code_changes:
            github = GitHubTools(self.mcp_client)
            owner, repo = context.repo.split("/", 1)
            try:
                pr_result = await github.create_pull_request(
                    owner=owner,
                    repo=repo,
                    title=f"[DeepThink] {context.task[:60]}",
                    body=(
                        f"## Auto-generated by DeepThink pipeline\n\n"
                        f"**Task:** {context.task}\n\n"
                        f"**Iterations:** {context.iteration}\n\n"
                        f"**Design decisions:**\n"
                        + "\n".join(f"- {d}" for d in context.design_decisions)
                        + f"\n\n**Test results:**\n```\n{context.test_results or 'N/A'}\n```"
                    ),
                    head=f"deepthink/{context.task[:30].replace(' ', '-').lower()}",
                    base="main",
                )
                context.pull_request_url = pr_result.get("content", "")
                logger.info("PR created: %s", context.pull_request_url)
            except Exception:
                logger.error("Failed to create pull request", exc_info=True)

        logger.info("Orchestrator decided: %s — %s", context.decision, context.decision_reasoning)
        return context
