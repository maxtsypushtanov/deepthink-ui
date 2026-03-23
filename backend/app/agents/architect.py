"""Architect agent — analyses the codebase and produces a spec + design decisions."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.agents.base_agent import BaseAgent
from app.mcp.github_tools import GitHubTools
from app.pipeline.context import DevLoopContext
from app.reasoning.engine import ReasoningStrategy

logger = logging.getLogger(__name__)

ARCHITECT_SYSTEM_PROMPT = """\
You are a senior software architect. Your job is to read real code before \
making any decisions. Never guess — use the MCP tools to search and read \
the actual repository.

Given the task and (optionally) issues from a previous iteration, produce:
1. A concise specification (spec) describing *what* needs to change.
2. A list of design decisions explaining *why* each approach was chosen.

Respond in JSON:
{
  "spec": "...",
  "design_decisions": ["...", "..."]
}
"""


class ArchitectAgent(BaseAgent):
    """Uses Tree of Thoughts to explore design alternatives."""

    reasoning_strategy = ReasoningStrategy.TREE_OF_THOUGHTS
    system_prompt = ARCHITECT_SYSTEM_PROMPT

    async def run(self, context: DevLoopContext) -> DevLoopContext:
        if self.mcp_client is None:
            raise RuntimeError("ArchitectAgent requires an MCP client")

        github = GitHubTools(self.mcp_client)

        # Parse owner/repo from "owner/repo" string
        owner, repo = context.repo.split("/", 1)

        # Gather context from the real codebase
        code_results = await github.search_code(context.task, repo=context.repo)
        commits = await github.list_commits(owner, repo)

        # If there are prior issues, fetch related files
        file_contents: list[dict[str, Any]] = []
        for issue in context.issues_found:
            if issue.file:
                contents = await github.get_file(owner, repo, issue.file)
                file_contents.append({"file": issue.file, "contents": contents})

        # Build the user prompt for the LLM
        prior_issues = ""
        if context.issues_found:
            prior_issues = "\n\nIssues from previous iteration:\n" + "\n".join(
                f"- [{i.severity}] {i.description} ({i.file or 'unknown file'})"
                for i in context.issues_found
            )

        user_prompt = (
            f"Task: {context.task}\n"
            f"Repository: {context.repo}\n"
            f"Iteration: {context.iteration}\n\n"
            f"Code search results:\n{code_results.get('content', '')}\n\n"
            f"Recent commits:\n{commits.get('content', '')}\n"
            f"{prior_issues}\n\n"
            f"File contents already fetched:\n"
            + "\n".join(
                f"--- {fc['file']} ---\n{fc['contents'].get('content', '')}"
                for fc in file_contents
            )
        )

        # Use the reasoning engine via the provider
        from app.core.config import settings
        from app.providers.registry import get_provider
        from app.reasoning.engine import ReasoningEngine

        provider = get_provider("custom", settings.custom_api_key)
        engine = ReasoningEngine(provider=provider, model=self.model)

        from app.providers.base import LLMMessage

        result = ""
        async for event in engine.run(
            messages=[
                LLMMessage(role="system", content=self.system_prompt),
                LLMMessage(role="user", content=user_prompt),
            ],
            strategy=self.reasoning_strategy,
        ):
            if event.get("type") == "content_delta":
                result += event.get("content", "")

        # Parse structured output
        try:
            parsed = json.loads(result)
            context.spec = parsed.get("spec", result)
            context.design_decisions = parsed.get("design_decisions", [])
        except json.JSONDecodeError:
            logger.warning("Architect output was not valid JSON, using raw text as spec")
            context.spec = result
            context.design_decisions = []

        logger.info("Architect finished — spec length=%d, decisions=%d",
                     len(context.spec or ""), len(context.design_decisions))
        return context
