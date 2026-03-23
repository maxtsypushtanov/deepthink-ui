"""Multi-agent development loop with adaptive strategy routing."""

from __future__ import annotations

import logging
from typing import Any

from app.agents.architect import ArchitectAgent
from app.agents.developer import DeveloperAgent
from app.agents.orchestrator import OrchestratorAgent
from app.agents.tester import TesterAgent
from app.mcp.client import MCPClient
from app.pipeline.context import DevLoopContext
from app.providers.base import LLMMessage, LLMRequest
from app.sandbox.base import SandboxClient

logger = logging.getLogger(__name__)


# ── Task complexity classification ──

async def classify_task(task: str, model: str = "openai/gpt-oss-120b") -> str:
    """One fast LLM call to classify task as simple/medium/complex."""
    from app.core.config import settings
    from app.providers.registry import get_provider

    provider = get_provider("custom", settings.custom_api_key, settings.custom_base_url)
    req = LLMRequest(
        messages=[LLMMessage(
            role="user",
            content=(
                "Classify this dev task. Reply with ONE word: simple/medium/complex\n"
                f"Task: {task}"
            ),
        )],
        model=model,
        temperature=0.0,
        max_tokens=10,
        stream=False,
    )
    try:
        resp = await provider.complete(req)
        raw = resp.content.strip().lower()
        for level in ("simple", "medium", "complex"):
            if level in raw:
                return level
    except Exception:
        logger.warning("Task classification failed, defaulting to medium")
    return "medium"


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
    """Execute the dev loop with adaptive strategy routing."""

    async def emit(event: dict[str, Any]) -> None:
        if on_event is not None:
            await on_event(event)

    # ── Classify task complexity ──
    complexity = await classify_task(task, architect_model)
    logger.info("Task classified as: %s", complexity)
    await emit({"type": "strategy_selected", "complexity": complexity})

    context = DevLoopContext(task=task, repo=repo)

    # ── Build agent pipeline based on complexity ──
    architect = ArchitectAgent(model=architect_model, mcp_client=mcp_client)
    developer = DeveloperAgent(model=developer_model, mcp_client=mcp_client)
    tester = TesterAgent(model=tester_model, mcp_client=mcp_client, sandbox=sandbox)
    orchestrator = OrchestratorAgent(model=orchestrator_model, mcp_client=mcp_client)

    if complexity == "simple":
        agents_in_order: list[tuple[str, Any]] = [("developer", developer)]
        max_iterations = 1
    elif complexity == "medium":
        agents_in_order = [
            ("architect", architect),
            ("developer", developer),
            ("tester", tester),
        ]
        max_iterations = min(max_iterations, 2)
    else:  # complex
        agents_in_order = [
            ("architect", architect),
            ("developer", developer),
            ("tester", tester),
            ("orchestrator", orchestrator),
        ]

    consecutive_clean = 0

    for iteration in range(1, max_iterations + 1):
        context.iteration = iteration
        logger.info("=== Pipeline iteration %d (%s) ===", iteration, complexity)

        for agent_name, agent in agents_in_order:
            await emit({"type": "agent_started", "agent": agent_name, "iteration": iteration})

            mcp_client.set_event_callback(emit, agent_name)
            agent.set_event_callback(emit, agent_name)

            context = await agent.run(context)

            # Developer retry: if no changes produced, retry once with stronger prompt
            if agent_name == "developer" and not context.code_changes and iteration == 1:
                logger.warning("Developer produced no changes — retrying with stronger prompt")
                await emit({"type": "agent_started", "agent": "developer", "iteration": iteration})
                context = await developer.run_retry(context)

            if agent_name == "tester":
                await emit({
                    "type": "sandbox_result",
                    "agent": "tester",
                    "iteration": iteration,
                    "test_results": context.test_results,
                })

        # Snapshot
        context.history.append(context.snapshot())
        await emit({
            "type": "iteration_complete",
            "iteration": iteration,
            "decision": context.decision,
            "issues_count": len(context.issues_found),
        })

        # Early-stop
        if not context.issues_found:
            consecutive_clean += 1
        else:
            consecutive_clean = 0

        if consecutive_clean >= stop_on_clean_iterations:
            context.status = "done"
            break

        if context.decision == "done":
            context.status = "done"
            break

        # Simple/medium tasks: stop after first iteration
        if complexity in ("simple", "medium"):
            context.status = "done"
            break
    else:
        context.status = "max_iterations_reached"

    if context.status == "running":
        context.status = "done"

    await emit({"type": "pipeline_done", "status": context.status, "complexity": complexity})
    logger.info("Pipeline finished — status=%s, complexity=%s, iterations=%d",
                context.status, complexity, context.iteration)
    return context
