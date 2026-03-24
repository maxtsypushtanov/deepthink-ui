"""Developer agent — produces code changes as JSON, no reasoning wrapper."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.agents.base_agent import BaseAgent
from app.mcp.github_tools import GitHubTools
from app.pipeline.context import CodeChange, DevLoopContext
from app.reasoning.engine import ReasoningStrategy

logger = logging.getLogger(__name__)

DEVELOPER_SYSTEM_PROMPT = """\
You are a code generation agent. You produce file changes as JSON.

RULES:
- Output ONLY valid JSON. No explanations, no markdown, no thinking tags.
- Do NOT use <thinking> tags. Do NOT write Russian text.
- Do NOT write git commands or instructions for humans.

OUTPUT FORMAT (strict JSON, nothing else):
{"code_changes": [{"file": "path/to/file.py", "content": "full file content here", "action": "create"}]}

Valid actions: create, modify, delete.
"content" must contain the COMPLETE file content for create/modify.
"""

RETRY_PROMPT = """\
Your previous response was not valid JSON. Try again.
Output ONLY this JSON structure, nothing else:
{"code_changes": [{"file": "path/to/file.py", "content": "full file content", "action": "create"}]}
"""


class DeveloperAgent(BaseAgent):
    """Produces code changes as structured JSON — no reasoning wrapper."""

    reasoning_strategy = ReasoningStrategy.NONE  # No CoT/Budget — direct output
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
            f"Repository: {context.repo}\n\n"
            f"Spec:\n{context.spec or 'Implement the task directly.'}\n\n"
            f"Design decisions:\n"
            + "\n".join(f"- {d}" for d in context.design_decisions)
        )

        if file_contents:
            user_prompt += "\n\nExisting file contents:\n" + "\n".join(
                f"--- {path} ---\n{content}" for path, content in file_contents.items()
            )

        if context.issues_found:
            user_prompt += "\n\nIssues to fix:\n" + "\n".join(
                f"- [{i.severity}] {i.description} ({i.file or 'unknown'})"
                for i in context.issues_found
            )

        user_prompt += "\n\nOutput ONLY the JSON with code_changes. No other text."

        result = await self._call_llm(user_prompt)
        context.code_changes = self._parse_changes(result)

        logger.info("Developer finished — %d code changes", len(context.code_changes))
        return context

    async def run_retry(self, context: DevLoopContext) -> DevLoopContext:
        """Retry with a forced prompt when no changes were produced."""
        user_prompt = (
            f"Task: {context.task}\n"
            f"Spec:\n{context.spec or 'Implement the task directly.'}\n\n"
            f"{RETRY_PROMPT}"
        )
        result = await self._call_llm(user_prompt)
        context.code_changes = self._parse_changes(result)
        logger.info("Developer retry — %d code changes", len(context.code_changes))
        return context

    async def _call_llm(self, user_prompt: str) -> str:
        """Direct LLM call with NO reasoning engine wrapper — pure completion."""
        from app.core.config import settings
        from app.providers.registry import get_provider
        from app.providers.base import LLMMessage, LLMRequest

        provider = get_provider("custom", settings.custom_api_key, settings.custom_base_url)

        req = LLMRequest(
            messages=[
                LLMMessage(role="system", content=self.system_prompt),
                LLMMessage(role="user", content=user_prompt),
            ],
            model=self.model,
            temperature=0.1,  # Low temp for structured output
            max_tokens=4096,
            stream=True,
        )

        result = ""
        async for chunk in provider.stream(req):
            if chunk.content:
                result += chunk.content
                await self._emit_thinking(chunk.content)
        return result

    @staticmethod
    def _parse_changes(result: str) -> list[CodeChange]:
        # Strip thinking tags and markdown fences
        cleaned = re.sub(r'<thinking>.*?</thinking>', '', result, flags=re.DOTALL).strip()
        cleaned = cleaned.removeprefix("```json").removeprefix("```").removesuffix("```").strip()

        # Try direct parse
        try:
            parsed = json.loads(cleaned)
            return [CodeChange(**c) for c in parsed.get("code_changes", [])]
        except (json.JSONDecodeError, AttributeError):
            pass

        # Try to find JSON block within the text
        match = re.search(r'\{[\s\S]*"code_changes"\s*:\s*\[[\s\S]*\]\s*\}', cleaned)
        if match:
            try:
                parsed = json.loads(match.group())
                return [CodeChange(**c) for c in parsed.get("code_changes", [])]
            except (json.JSONDecodeError, AttributeError):
                pass

        logger.warning("Developer output was not valid JSON: %s", cleaned[:200])
        return []
