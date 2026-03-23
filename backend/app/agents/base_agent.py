"""Abstract base class for all pipeline agents."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, AsyncIterator

from app.mcp.client import MCPClient
from app.pipeline.context import DevLoopContext
from app.reasoning.engine import ReasoningStrategy


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

    @abstractmethod
    async def run(self, context: DevLoopContext) -> DevLoopContext:
        """Execute this agent's phase and return the updated context."""
        ...
