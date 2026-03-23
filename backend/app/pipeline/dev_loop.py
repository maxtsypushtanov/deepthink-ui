"""Multi-agent development loop: Architect → Developer → Tester → Orchestrator."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, AsyncIterator

from app.agents.architect import ArchitectAgent
from app.agents.developer import DeveloperAgent
from app.agents.orchestrator import OrchestratorAgent
from app.agents.tester import TesterAgent
from app.mcp.client import MCPClient
from app.pipeline.context import DevLoopContext
from app.sandbox.base import SandboxClient

logger = logging.getLogger(__name__)


async def run(
    task: str,
    repo: str,
    *,
    mcp_client: MCPClient,
    sandbox: SandboxClient,
    max_iterations: int = 5,
    stop_on_clean_iterations: int = 2,
    architect_model: str = "openai/gpt-oss-120b",
    developer_model: str = "zai-org/GLM-4.7",
    tester_model: str = "zai-org/GLM-4.7-Flash",
    orchestrator_model: str = "zai-org/GLM-4.6",
    on_event: Any | None = None,
) -> DevLoopContext:
    """Execute the dev loop and return the final context.

    Args:
        task: Natural-language description of what to build / fix.
        repo: GitHub repository in "owner/repo" format.
        mcp_client: Initialised MCP client connected to GitHub MCP Server.
        sandbox: Initialised SandboxClient for running tests.
        max_iterations: Hard cap on loop iterations.
        stop_on_clean_iterations: Stop early after N consecutive clean iterations.
        architect_model: Model ID for the Architect agent.
        developer_model: Model ID for the Developer agent.
        tester_model: Model ID for the Tester agent.
        orchestrator_model: Model ID for the Orchestrator agent.
        on_event: Optional async callback ``(event: dict) -> None`` for streaming.
    """

    async def emit(event: dict[str, Any]) -> None:
        if on_event is not None:
            await on_event(event)

    context = DevLoopContext(task=task, repo=repo)

    architect = ArchitectAgent(model=architect_model, mcp_client=mcp_client)
    developer = DeveloperAgent(model=developer_model, mcp_client=mcp_client)
    tester = TesterAgent(model=tester_model, mcp_client=mcp_client, sandbox=sandbox)
    orchestrator = OrchestratorAgent(model=orchestrator_model, mcp_client=mcp_client)

    consecutive_clean = 0

    for iteration in range(1, max_iterations + 1):
        context.iteration = iteration
        logger.info("=== Pipeline iteration %d ===", iteration)

        # --- Architect ---
        await emit({"type": "agent_started", "agent": "architect", "iteration": iteration})
        context = await architect.run(context)

        # --- Developer ---
        await emit({"type": "agent_started", "agent": "developer", "iteration": iteration})
        context = await developer.run(context)

        # --- Tester ---
        await emit({"type": "agent_started", "agent": "tester", "iteration": iteration})
        context = await tester.run(context)
        await emit({
            "type": "sandbox_result",
            "iteration": iteration,
            "test_results": context.test_results,
        })

        # --- Orchestrator ---
        await emit({"type": "agent_started", "agent": "orchestrator", "iteration": iteration})
        context = await orchestrator.run(context)

        # Snapshot the iteration
        context.history.append(context.snapshot())
        await emit({
            "type": "iteration_complete",
            "iteration": iteration,
            "decision": context.decision,
            "issues_count": len(context.issues_found),
        })

        # Early-stop: consecutive clean iterations
        if not context.issues_found:
            consecutive_clean += 1
        else:
            consecutive_clean = 0

        if consecutive_clean >= stop_on_clean_iterations:
            logger.info("Stopping early — %d consecutive clean iterations", consecutive_clean)
            context.status = "done"
            break

        if context.decision == "done":
            context.status = "done"
            break

        # Clear transient fields before the next iteration
        # (issues_found persists so Architect can read them)
    else:
        context.status = "max_iterations_reached"

    if context.status == "running":
        context.status = "done"

    await emit({"type": "pipeline_done", "status": context.status})
    logger.info("Pipeline finished — status=%s, iterations=%d", context.status, context.iteration)
    return context
