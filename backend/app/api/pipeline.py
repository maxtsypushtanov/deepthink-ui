"""API endpoints for the multi-agent development pipeline."""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from app.core.config import settings
from app.mcp.client import MCPClient
from app.pipeline.context import DevLoopContext
from app.pipeline.dev_loop import run as run_pipeline
from app.sandbox.e2b_sandbox import E2BSandboxClient

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/pipeline", tags=["pipeline"])

# ---------------------------------------------------------------------------
# In-memory task store (production would use a database)
# ---------------------------------------------------------------------------

_tasks: dict[str, dict[str, Any]] = {}
_task_events: dict[str, list[dict[str, Any]]] = {}
_task_futures: dict[str, asyncio.Task[Any]] = {}

# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class PipelineStartRequest(BaseModel):
    task: str
    repo: str
    max_iterations: int = Field(default=5, ge=1, le=20)


class PipelineStartResponse(BaseModel):
    task_id: str


class PipelineStatusResponse(BaseModel):
    task_id: str
    context: DevLoopContext | None = None
    events: list[dict[str, Any]] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_mcp_client() -> MCPClient:
    """Create and initialise an MCP client for the GitHub MCP Server."""
    token = settings.github_personal_access_token
    client = MCPClient(
        command="npx",
        args=["-y", "@modelcontextprotocol/server-github"],
        env={"GITHUB_PERSONAL_ACCESS_TOKEN": token} if token else None,
    )
    await client.initialize()
    return client


async def _create_sandbox() -> E2BSandboxClient:
    """Create and initialise an E2B sandbox."""
    api_key = settings.e2b_api_key
    sandbox = E2BSandboxClient(api_key=api_key)
    await sandbox.initialize()
    return sandbox


async def _run_task(task_id: str, task: str, repo: str, max_iterations: int) -> None:
    """Background coroutine that drives the pipeline for a single task."""
    mcp_client: MCPClient | None = None
    sandbox: E2BSandboxClient | None = None

    async def on_event(event: dict[str, Any]) -> None:
        _task_events.setdefault(task_id, []).append(event)

    try:
        mcp_client = await _create_mcp_client()
        sandbox = await _create_sandbox()

        context = await run_pipeline(
            task=task,
            repo=repo,
            mcp_client=mcp_client,
            sandbox=sandbox,
            max_iterations=max_iterations,
            stop_on_clean_iterations=settings.stop_on_clean_iterations,
            architect_model=settings.architect_model,
            developer_model=settings.developer_model,
            tester_model=settings.tester_model,
            orchestrator_model=settings.orchestrator_model,
            on_event=on_event,
        )
        _tasks[task_id] = {"status": "done", "context": context}
    except asyncio.CancelledError:
        _tasks[task_id] = {"status": "cancelled", "context": None}
        await on_event({"type": "error", "message": "Pipeline cancelled"})
    except Exception as exc:
        logger.error("Pipeline task %s failed", task_id, exc_info=True)
        _tasks[task_id] = {"status": "error", "context": None, "error": str(exc)}
        await on_event({"type": "error", "message": str(exc)})
    finally:
        if mcp_client is not None:
            await mcp_client.close()
        if sandbox is not None:
            await sandbox.destroy()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/run", response_model=PipelineStartResponse)
async def start_pipeline(req: PipelineStartRequest) -> PipelineStartResponse:
    """Start a new pipeline run in the background."""
    task_id = uuid.uuid4().hex[:12]
    _tasks[task_id] = {"status": "running", "context": None}
    _task_events[task_id] = []

    future = asyncio.create_task(_run_task(task_id, req.task, req.repo, req.max_iterations))
    _task_futures[task_id] = future

    logger.info("Pipeline started: task_id=%s task=%s repo=%s", task_id, req.task, req.repo)
    return PipelineStartResponse(task_id=task_id)


@router.get("/{task_id}/status", response_model=PipelineStatusResponse)
async def get_pipeline_status(task_id: str) -> PipelineStatusResponse:
    """Return the current status and context for a pipeline run."""
    entry = _tasks.get(task_id)
    if entry is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Task not found")
    return PipelineStatusResponse(
        task_id=task_id,
        context=entry.get("context"),
        events=_task_events.get(task_id, []),
    )


@router.delete("/{task_id}")
async def stop_pipeline(task_id: str) -> dict[str, str]:
    """Cancel a running pipeline."""
    future = _task_futures.get(task_id)
    if future is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Task not found")
    future.cancel()
    return {"status": "cancelled"}


@router.websocket("/{task_id}/stream")
async def stream_pipeline(websocket: WebSocket, task_id: str) -> None:
    """Stream pipeline events over a WebSocket connection."""
    await websocket.accept()

    if task_id not in _tasks:
        await websocket.send_json({"type": "error", "message": "Task not found"})
        await websocket.close()
        return

    sent_index = 0
    try:
        while True:
            events = _task_events.get(task_id, [])
            while sent_index < len(events):
                await websocket.send_json(events[sent_index])
                sent_index += 1

            # Check if pipeline is done
            entry = _tasks.get(task_id, {})
            if entry.get("status") in ("done", "error", "cancelled"):
                # Flush any remaining events
                events = _task_events.get(task_id, [])
                while sent_index < len(events):
                    await websocket.send_json(events[sent_index])
                    sent_index += 1
                await websocket.send_json({
                    "type": "pipeline_done",
                    "status": entry.get("status"),
                })
                break

            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        logger.debug("WebSocket client disconnected for task %s", task_id)
    finally:
        await websocket.close()
