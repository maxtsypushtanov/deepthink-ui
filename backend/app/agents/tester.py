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
You are a meticulous test engineer. You write pytest-compatible tests, \
run them, and report every issue found with severity and affected file.

Given the code changes, existing test output, and known issues from the \
repo tracker, produce:
1. A pytest test file to validate the changes.
2. After seeing the test output, a list of issues found.

When asked for analysis, respond in JSON:
{
  "issues_found": [
    {"description": "...", "severity": "low|medium|high|critical", "file": "path or null"},
    ...
  ]
}
"""


class TesterAgent(BaseAgent):
    """Uses Best-of-N — generates N test variants, picks the best."""

    reasoning_strategy = ReasoningStrategy.BEST_OF_N
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
        from app.reasoning.engine import ReasoningEngine

        provider = get_provider("openrouter", settings.openrouter_api_key)
        engine = ReasoningEngine(provider=provider, model=self.model)

        from app.providers.base import LLMMessage

        # Generate test code via Best-of-N
        test_code = ""
        async for event in engine.run(
            messages=[
                LLMMessage(role="system", content=self.system_prompt),
                LLMMessage(role="user", content=user_prompt),
            ],
            strategy=self.reasoning_strategy,
        ):
            if event.get("type") == "content_delta":
                test_code += event.get("content", "")

        # Write code changes + test into the sandbox and run pytest
        sandbox = await self.sandbox.fork()
        try:
            for change in context.code_changes:
                if change.action != "delete":
                    await sandbox.execute(
                        f"import pathlib; p = pathlib.Path('/workspace/{change.file}'); "
                        f"p.parent.mkdir(parents=True, exist_ok=True); "
                        f"p.write_text({repr(change.content)})"
                    )

            await sandbox.execute(
                f"import pathlib; pathlib.Path('/workspace/test_changes.py').write_text({repr(test_code)})"
            )

            result = await sandbox.execute(
                "cd /workspace && python -m pytest test_changes.py -v --tb=short 2>&1",
                timeout=120,
            )
            context.test_results = f"exit_code={result.exit_code}\n\nSTDOUT:\n{result.stdout}\n\nSTDERR:\n{result.stderr}"
        finally:
            await sandbox.destroy()

        # Analyse test results with the LLM
        analysis_prompt = (
            f"Test results:\n{context.test_results}\n\n"
            f"Analyse the output and list all issues found. "
            f"Respond in JSON with an 'issues_found' array."
        )

        analysis = ""
        async for event in engine.run(
            messages=[
                LLMMessage(role="system", content=self.system_prompt),
                LLMMessage(role="user", content=analysis_prompt),
            ],
            strategy=ReasoningStrategy.COT,
        ):
            if event.get("type") == "content_delta":
                analysis += event.get("content", "")

        try:
            parsed = json.loads(analysis)
            context.issues_found = [
                Issue(**i) for i in parsed.get("issues_found", [])
            ]
        except json.JSONDecodeError:
            logger.warning("Tester analysis was not valid JSON")
            context.issues_found = []

        logger.info("Tester finished — %d issues found", len(context.issues_found))
        return context
