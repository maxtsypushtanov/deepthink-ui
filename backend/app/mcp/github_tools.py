"""High-level wrappers around GitHub MCP Server tools."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.mcp.client import MCPClient

logger = logging.getLogger(__name__)


class GitHubTools:
    """Convenience layer over raw MCP calls to the GitHub MCP Server."""

    def __init__(self, client: MCPClient) -> None:
        self._client = client

    # ------------------------------------------------------------------
    # Code search
    # ------------------------------------------------------------------

    async def search_code(self, query: str, repo: str | None = None) -> dict[str, Any]:
        """Search code on GitHub. Optionally scoped to a single repo."""
        q = f"{query} repo:{repo}" if repo else query
        return await self._client.call_tool("search_code", {"q": q})

    # ------------------------------------------------------------------
    # File operations
    # ------------------------------------------------------------------

    async def get_file(self, owner: str, repo: str, path: str) -> dict[str, Any]:
        """Retrieve metadata for a file (or directory listing)."""
        return await self._client.call_tool(
            "get_file_contents",
            {"owner": owner, "repo": repo, "path": path},
        )

    async def get_file_contents(self, owner: str, repo: str, path: str) -> dict[str, Any]:
        """Retrieve the decoded contents of a file."""
        return await self._client.call_tool(
            "get_file_contents",
            {"owner": owner, "repo": repo, "path": path},
        )

    # ------------------------------------------------------------------
    # Issues
    # ------------------------------------------------------------------

    async def list_issues(self, owner: str, repo: str) -> dict[str, Any]:
        """List open issues for a repository."""
        return await self._client.call_tool(
            "list_issues",
            {"owner": owner, "repo": repo},
        )

    async def search_issues(self, query: str) -> dict[str, Any]:
        """Search issues across GitHub."""
        return await self._client.call_tool("search_issues", {"q": query})

    # ------------------------------------------------------------------
    # Pull requests
    # ------------------------------------------------------------------

    async def create_pull_request(
        self,
        owner: str,
        repo: str,
        title: str,
        body: str,
        head: str,
        base: str,
    ) -> dict[str, Any]:
        """Open a new pull request."""
        return await self._client.call_tool(
            "create_pull_request",
            {
                "owner": owner,
                "repo": repo,
                "title": title,
                "body": body,
                "head": head,
                "base": base,
            },
        )

    # ------------------------------------------------------------------
    # Commits
    # ------------------------------------------------------------------

    async def list_commits(self, owner: str, repo: str, branch: str | None = None) -> dict[str, Any]:
        """List recent commits, optionally filtered by branch."""
        params: dict[str, Any] = {"owner": owner, "repo": repo}
        if branch:
            params["sha"] = branch
        return await self._client.call_tool("list_commits", params)
