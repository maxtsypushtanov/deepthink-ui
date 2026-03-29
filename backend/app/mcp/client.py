"""MCP client for stdio-based tool servers (e.g. GitHub MCP Server)."""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any, Callable, Awaitable

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

logger = logging.getLogger(__name__)

EventCallback = Callable[[dict[str, Any]], Awaitable[None]]


class MCPClient:
    """Connects to an MCP server via stdio subprocess."""

    def __init__(
        self,
        command: str,
        args: list[str] | None = None,
        env: dict[str, str] | None = None,
    ) -> None:
        self._server_params = StdioServerParameters(
            command=command,
            args=args or [],
            env=env,
        )
        self._session: ClientSession | None = None
        self._read: Any = None
        self._write: Any = None
        self._cm: Any = None
        self._session_cm: Any = None
        self._on_event: EventCallback | None = None
        self._current_agent: str | None = None

    def set_event_callback(self, callback: EventCallback, agent: str) -> None:
        """Attach an event callback so tool calls are streamed to the frontend."""
        self._on_event = callback
        self._current_agent = agent

    async def _emit(self, event: dict[str, Any]) -> None:
        if self._on_event is not None:
            await self._on_event(event)

    async def initialize(self) -> None:
        """Start the subprocess and initialize the MCP session."""
        self._cm = stdio_client(self._server_params)
        self._read, self._write = await self._cm.__aenter__()
        self._session_cm = ClientSession(self._read, self._write)
        self._session = await self._session_cm.__aenter__()
        await self._session.initialize()
        logger.info("MCP session initialized (command=%s)", self._server_params.command)

    async def call_tool(self, name: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        """Invoke a tool on the MCP server and return the result."""
        if self._session is None:
            raise RuntimeError("MCPClient not initialized — call initialize() first")

        call_id = uuid.uuid4().hex[:8]
        safe_params = params or {}

        # Emit tool_call event
        input_preview = ""
        if "q" in safe_params:
            input_preview = str(safe_params["q"])[:120]
        elif "path" in safe_params:
            input_preview = str(safe_params["path"])[:120]
        elif "owner" in safe_params and "repo" in safe_params:
            input_preview = f"{safe_params['owner']}/{safe_params['repo']}"

        await self._emit({
            "type": "tool_call",
            "agent": self._current_agent,
            "tool": name,
            "input": input_preview,
            "call_id": call_id,
        })

        from app.core.config import settings as app_settings
        logger.debug("MCP call_tool: %s(%s)", name, safe_params)
        result = await asyncio.wait_for(
            self._session.call_tool(name, arguments=safe_params),
            timeout=float(app_settings.mcp_timeout),
        )

        # Flatten TextContent list into a single dict
        content_parts = []
        for block in result.content:
            if hasattr(block, "text"):
                content_parts.append(block.text)
        output = "\n".join(content_parts)

        # Emit tool_result event
        output_preview = output[:300] if output else ""
        await self._emit({
            "type": "tool_result",
            "call_id": call_id,
            "agent": self._current_agent,
            "tool": name,
            "output": output_preview,
            "success": not result.isError,
        })

        return {"content": output, "is_error": result.isError}

    async def list_tools(self) -> list[dict[str, Any]]:
        """List available tools on the server."""
        if self._session is None:
            raise RuntimeError("MCPClient not initialized — call initialize() first")
        result = await self._session.list_tools()
        return [{"name": t.name, "description": t.description} for t in result.tools]

    async def close(self) -> None:
        """Shut down the session and subprocess."""
        if self._session_cm is not None:
            try:
                await self._session_cm.__aexit__(None, None, None)
            except Exception:
                logger.warning("Error closing MCP session", exc_info=True)
        if self._cm is not None:
            try:
                await self._cm.__aexit__(None, None, None)
            except Exception:
                logger.warning("Error closing MCP stdio transport", exc_info=True)
        self._session = None
        self._cm = None
        self._session_cm = None
        logger.info("MCP client closed")
