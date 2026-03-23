"""Abstract base class for all pipeline agents."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Awaitable, Callable

from app.mcp.client import MCPClient
from app.pipeline.context import DevLoopContext
from app.reasoning.engine import ReasoningStrategy

EventCallback = Callable[[dict[str, Any]], Awaitable[None]]


class BaseAgent(ABC):
    """Every agent owns a reasoning strategy, an MCP client, and a system prompt."""

    reasoning_strategy: ReasoningStrategy
    system_prompt: str

    def __init__(
        self,
        *,
        model: str,
        mcp_client: MCPClient | None = None,
        extra_tools: dict[str, Any] | None = None,
    ) -> None:
        self.model = model
        self.mcp_client = mcp_client
        self.extra_tools = extra_tools or {}
        self._on_event: EventCallback | None = None
        self._agent_name: str = ""

    def set_event_callback(self, callback: EventCallback, agent_name: str) -> None:
        self._on_event = callback
        self._agent_name = agent_name

    async def _emit(self, event: dict[str, Any]) -> None:
        if self._on_event is not None:
            await self._on_event(event)

    async def _emit_thinking(self, chunk: str) -> None:
        """Emit a thinking token chunk for real-time streaming."""
        await self._emit({
            "type": "agent_thinking",
            "agent": self._agent_name,
            "chunk": chunk,
        })

    @abstractmethod
    async def run(self, context: DevLoopContext) -> DevLoopContext:
        """Execute this agent's phase and return the updated context."""
        ...
