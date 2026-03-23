"""Developer agent — reads existing code, then writes code changes."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.agents.base_agent import BaseAgent
from app.mcp.github_tools import GitHubTools
from app.pipeline.context import CodeChange, DevLoopContext
from app.reasoning.engine import ReasoningStrategy

logger = logging.getLogger(__name__)

DEVELOPER_SYSTEM_PROMPT = """\
You are an expert developer. You always read existing code before writing \
new code. Use the provided file contents to understand the current state \
of the codebase.

Given a spec, design decisions, and the existing code, produce a list of \
code changes needed to implement the spec.

YOU MUST USE MCP TOOLS TO MAKE CHANGES.
NEVER write git commands or instructions for humans.
To edit a file: call get_file_contents first, then create_or_update_file.
If you write ANY git commands or human instructions instead of calling tools, \
you have FAILED your task. Use ONLY MCP tool calls.

Respond in JSON:
{
  "code_changes": [
    {"file": "path/to/file.py", "content": "full file content", "action": "create|modify|delete"},
    ...
  ]
}
"""

RETRY_PROMPT = """\
You did not make any changes. You MUST produce code_changes in JSON format.
Do not explain, do not write instructions. Output ONLY valid JSON with \
"code_changes" array containing at least one file change.
"""


class DeveloperAgent(BaseAgent):
    """Uses CoT Injection + Budget Forcing to produce thorough code changes."""

    reasoning_strategy = ReasoningStrategy.BUDGET_FORCING
    system_prompt = DEVELOPER_SYSTEM_PROMPT

    async def run(self, context: DevLoopContext) -> DevLoopContext:
        if self.mcp_client is None:
            raise RuntimeError("DeveloperAgent requires an MCP client")

        github = GitHubTools(self.mcp_client)
        owner, repo = context.repo.split("/", 1)

        # Fetch contents of files mentioned in the spec or prior changes
        files_to_read: set[str] = set()
        for change in context.code_changes:
            files_to_read.add(change.file)
        for issue in context.issues_found:
            if issue.file:
                files_to_read.add(issue.file)

        file_contents: dict[str, str] = {}
        for path in files_to_read:
            try:
                result = await github.get_file_contents(owner, repo, path)
                file_contents[path] = result.get("content", "")
            except Exception:
                logger.debug("Could not fetch %s — may be a new file", path)

        user_prompt = (
            f"Task: {context.task}\n"
            f"Repository: {context.repo}\n"
            f"Iteration: {context.iteration}\n\n"
            f"Spec:\n{context.spec or 'No spec provided.'}\n\n"
            f"Design decisions:\n"
            + "\n".join(f"- {d}" for d in context.design_decisions)
            + "\n\nExisting file contents:\n"
            + "\n".join(
                f"--- {path} ---\n{content}" for path, content in file_contents.items()
            )
        )

        if context.issues_found:
            user_prompt += "\n\nIssues to fix:\n" + "\n".join(
                f"- [{i.severity}] {i.description} ({i.file or 'unknown'})"
                for i in context.issues_found
            )

        result = await self._call_llm(user_prompt)
        context.code_changes = self._parse_changes(result)

        logger.info("Developer finished — %d code changes", len(context.code_changes))
        return context

    async def run_retry(self, context: DevLoopContext) -> DevLoopContext:
        """Retry with a stronger prompt when no changes were produced."""
        user_prompt = (
            f"Task: {context.task}\n"
            f"Repository: {context.repo}\n"
            f"Spec:\n{context.spec or 'Implement the task directly.'}\n\n"
            f"{RETRY_PROMPT}"
        )
        result = await self._call_llm(user_prompt)
        context.code_changes = self._parse_changes(result)
        logger.info("Developer retry — %d code changes", len(context.code_changes))
        return context

    async def _call_llm(self, user_prompt: str) -> str:
        from app.core.config import settings
        from app.providers.registry import get_provider
        from app.reasoning.engine import ReasoningEngine
        from app.providers.base import LLMMessage

        provider = get_provider("custom", settings.custom_api_key, settings.custom_base_url)
        engine = ReasoningEngine(provider=provider, model=self.model)

        cot_system = (
            "Before writing any code, think step-by-step about what changes are needed "
            "and why. Wrap your reasoning in <thinking>...</thinking> tags.\n\n"
            + self.system_prompt
        )

        result = ""
        async for event in engine.run(
            messages=[
                LLMMessage(role="system", content=cot_system),
                LLMMessage(role="user", content=user_prompt),
            ],
            strategy=self.reasoning_strategy,
        ):
            if event.get("event") == "content_delta":
                chunk = event.get("data", {}).get("content", "")
                result += chunk
                await self._emit_thinking(chunk)
        return result

    @staticmethod
    def _parse_changes(result: str) -> list[CodeChange]:
        # Strip thinking tags if present
        import re
        cleaned = re.sub(r'<thinking>.*?</thinking>', '', result, flags=re.DOTALL).strip()
        # Try to find JSON in the output
        try:
            parsed = json.loads(cleaned)
            return [CodeChange(**c) for c in parsed.get("code_changes", [])]
        except json.JSONDecodeError:
            # Try to find JSON block within the text
            match = re.search(r'\{[\s\S]*"code_changes"[\s\S]*\}', cleaned)
            if match:
                try:
                    parsed = json.loads(match.group())
                    return [CodeChange(**c) for c in parsed.get("code_changes", [])]
                except json.JSONDecodeError:
                    pass
            logger.warning("Developer output was not valid JSON")
            return []
