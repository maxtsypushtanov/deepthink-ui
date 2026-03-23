"""MCP client for stdio-based tool servers (e.g. GitHub MCP Server)."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

logger = logging.getLogger(__name__)


class MCPClient:
    """Connects to an MCP server via stdio subprocess."""

    def __init__(self, command: str, args: list[str] | None = None, env: dict[str, str] | None = None) -> None:
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
        logger.debug("MCP call_tool: %s(%s)", name, params)
        result = await self._session.call_tool(name, arguments=params or {})
        # Flatten TextContent list into a single dict
        content_parts = []
        for block in result.content:
            if hasattr(block, "text"):
                content_parts.append(block.text)
        return {"content": "\n".join(content_parts), "is_error": result.isError}

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
        logger.info("MCP client closed")
