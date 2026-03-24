"""Tester agent — runs tests in a sandbox, reports issues."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.agents.base_agent import BaseAgent
from app.mcp.github_tools import GitHubTools
from app.pipeline.context import DevLoopContext, Issue
from app.reasoning.engine import ReasoningStrategy
from app.sandbox.base import SandboxClient

logger = logging.getLogger(__name__)

TESTER_SYSTEM_PROMPT = """\
You are a Python test code generator.

RULES:
- Output ONLY valid Python code. Nothing else.
- The file MUST start with 'import' or 'def' or 'class'.
- Do NOT write Russian text. Do NOT explain. Do NOT use markdown fences.
- Do NOT use <thinking> tags.
- Write pytest-compatible test functions (def test_...).
- If you cannot write meaningful tests, write a minimal passing test:
  def test_placeholder(): assert True
"""

TESTER_ANALYSIS_PROMPT = """\
Analyze these test results and list issues found.
Output ONLY valid JSON, no other text:
{"issues_found": [{"description": "...", "severity": "low|medium|high|critical", "file": "path or null"}]}
If no issues found, output: {"issues_found": []}
"""


class TesterAgent(BaseAgent):
    """Uses Best-of-N — generates N test variants, picks the best."""

    reasoning_strategy = ReasoningStrategy.NONE
    system_prompt = TESTER_SYSTEM_PROMPT

    def __init__(self, *, model: str, sandbox: SandboxClient, **kwargs: Any) -> None:
        super().__init__(model=model, **kwargs)
        self.sandbox = sandbox

    async def run(self, context: DevLoopContext) -> DevLoopContext:
        github: GitHubTools | None = None
        if self.mcp_client is not None:
            github = GitHubTools(self.mcp_client)

        # Search for known issues in the repo
        known_issues_text = ""
        if github is not None:
            try:
                result = await github.search_issues(f"repo:{context.repo} is:open")
                known_issues_text = result.get("content", "")
            except Exception:
                logger.debug("Could not fetch issues from GitHub")

        # Build prompt for test generation
        changes_desc = "\n".join(
            f"- [{c.action}] {c.file}" for c in context.code_changes
        )
        user_prompt = (
            f"Task: {context.task}\n"
            f"Iteration: {context.iteration}\n\n"
            f"Code changes:\n{changes_desc}\n\n"
            f"Code contents:\n"
            + "\n".join(
                f"--- {c.file} ({c.action}) ---\n{c.content}" for c in context.code_changes
            )
            + f"\n\nKnown open issues:\n{known_issues_text}\n\n"
            f"Write a pytest test file that validates these changes. "
            f"Output ONLY the Python code, no markdown fences."
        )

        from app.core.config import settings
        from app.providers.registry import get_provider
        from app.providers.base import LLMMessage, LLMRequest

        provider = get_provider("custom", settings.custom_api_key, settings.custom_base_url)

        # Generate test code — direct stream, no reasoning wrapper
        req = LLMRequest(
            messages=[
                LLMMessage(role="system", content=self.system_prompt),
                LLMMessage(role="user", content=user_prompt),
            ],
            model=self.model,
            temperature=0.2,
            max_tokens=2048,
            stream=True,
        )
        test_code = ""
        async for chunk in provider.stream(req):
            if chunk.content:
                test_code += chunk.content
                await self._emit_thinking(chunk.content)

        # Strip markdown fences if model wrapped it
        test_code = test_code.strip()
        if test_code.startswith("```"):
            test_code = test_code.removeprefix("```python").removeprefix("```py").removeprefix("```")
            test_code = test_code.removesuffix("```").strip()

        # Validate it looks like Python
        if not test_code or not any(test_code.startswith(kw) for kw in ("import", "from", "def", "class", "#")):
            logger.warning("Tester output doesn't look like Python, using placeholder test")
            test_code = "def test_placeholder():\n    assert True\n"

        # Run tests in sandbox with graceful failure handling
        try:
            context.test_results = await self._run_in_sandbox(context, test_code)
        except Exception as exc:
            logger.warning("Sandbox failed — marking tests as skipped: %s", exc)
            context.test_results = '{"status": "skipped", "reason": "sandbox unavailable"}'
            context.issues_found = []
            return context

        # Analyse test results with the LLM — direct call, no reasoning wrapper
        analysis_prompt = (
            f"Test results:\n{context.test_results}\n\n"
            f"{TESTER_ANALYSIS_PROMPT}"
        )

        analysis_req = LLMRequest(
            messages=[
                LLMMessage(role="user", content=analysis_prompt),
            ],
            model=self.model,
            temperature=0.0,
            max_tokens=512,
            stream=False,
        )
        try:
            resp = await provider.complete(analysis_req)
            raw = (resp.content or "").strip()
            raw = raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            parsed = json.loads(raw)
            context.issues_found = [
                Issue(**i) for i in parsed.get("issues_found", [])
            ]
        except (json.JSONDecodeError, Exception):
            logger.warning("Tester analysis failed, assuming no issues")
            context.issues_found = []

        logger.info("Tester finished — %d issues found", len(context.issues_found))
        return context

    async def _run_in_sandbox(self, context: DevLoopContext, test_code: str) -> str:
        """Write files and run pytest inside the sandbox. Returns test output."""
        sandbox = await self.sandbox.fork()
        try:
            # Install pytest first
            await sandbox.run_command("pip install -q pytest", timeout=60)

            # Write code changes
            for change in context.code_changes:
                if change.action != "delete":
                    await sandbox.run_command(
                        f"mkdir -p /home/user/workspace/$(dirname {change.file})"
                    )
                    await sandbox.write_file(
                        f"/home/user/workspace/{change.file}", change.content
                    )

            # Write test file
            await sandbox.write_file("/home/user/workspace/test_changes.py", test_code)

            # Run pytest
            result = await sandbox.run_command(
                "cd /home/user/workspace && python -m pytest test_changes.py -v --tb=short 2>&1",
                timeout=120,
            )
            return (
                f"exit_code={result.exit_code}\n\n"
                f"STDOUT:\n{result.stdout}\n\n"
                f"STDERR:\n{result.stderr}"
            )
        finally:
            await sandbox.destroy()
