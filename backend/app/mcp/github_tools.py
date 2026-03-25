"""High-level wrappers around GitHub MCP Server tools.

Exposes the full surface of @modelcontextprotocol/server-github so that
every pipeline agent can use any GitHub capability it needs.
"""

from __future__ import annotations

import logging
from typing import Any

from app.mcp.client import MCPClient

logger = logging.getLogger(__name__)


class GitHubTools:
    """Convenience layer over raw MCP calls to the GitHub MCP Server."""

    def __init__(self, client: MCPClient) -> None:
        self._client = client

    # ==================================================================
    # Code & repository search
    # ==================================================================

    async def search_code(self, query: str, repo: str | None = None) -> dict[str, Any]:
        """Search code on GitHub. Optionally scoped to a single repo."""
        q = f"{query} repo:{repo}" if repo else query
        return await self._client.call_tool("search_code", {"q": q})

    async def search_repositories(self, query: str) -> dict[str, Any]:
        """Search repositories by keyword."""
        return await self._client.call_tool("search_repositories", {"query": query})

    async def search_users(self, query: str) -> dict[str, Any]:
        """Search GitHub users."""
        return await self._client.call_tool("search_users", {"q": query})

    # ==================================================================
    # Repository management
    # ==================================================================

    async def create_repository(
        self,
        name: str,
        description: str = "",
        private: bool = False,
        auto_init: bool = True,
    ) -> dict[str, Any]:
        """Create a new GitHub repository."""
        return await self._client.call_tool(
            "create_repository",
            {"name": name, "description": description, "private": private, "autoInit": auto_init},
        )

    async def fork_repository(self, owner: str, repo: str, organization: str | None = None) -> dict[str, Any]:
        """Fork a repository. Optionally into an organization."""
        params: dict[str, Any] = {"owner": owner, "repo": repo}
        if organization:
            params["organization"] = organization
        return await self._client.call_tool("fork_repository", params)

    async def get_file_contents(self, owner: str, repo: str, path: str, branch: str | None = None) -> dict[str, Any]:
        """Retrieve the decoded contents of a file or directory."""
        params: dict[str, Any] = {"owner": owner, "repo": repo, "path": path}
        if branch:
            params["branch"] = branch
        return await self._client.call_tool("get_file_contents", params)

    async def create_or_update_file(
        self,
        owner: str,
        repo: str,
        path: str,
        content: str,
        message: str,
        branch: str,
        sha: str | None = None,
    ) -> dict[str, Any]:
        """Create or update a single file in a repository."""
        params: dict[str, Any] = {
            "owner": owner,
            "repo": repo,
            "path": path,
            "content": content,
            "message": message,
            "branch": branch,
        }
        if sha:
            params["sha"] = sha
        return await self._client.call_tool("create_or_update_file", params)

    async def push_files(
        self,
        owner: str,
        repo: str,
        branch: str,
        files: list[dict[str, str]],
        message: str,
    ) -> dict[str, Any]:
        """Push multiple files in a single commit.

        files: list of {"path": "...", "content": "..."}
        """
        return await self._client.call_tool(
            "push_files",
            {"owner": owner, "repo": repo, "branch": branch, "files": files, "message": message},
        )

    # ==================================================================
    # Branches
    # ==================================================================

    async def create_branch(self, owner: str, repo: str, branch: str, from_branch: str | None = None) -> dict[str, Any]:
        """Create a new branch, optionally from a specific source branch."""
        params: dict[str, Any] = {"owner": owner, "repo": repo, "branch": branch}
        if from_branch:
            params["from_branch"] = from_branch
        return await self._client.call_tool("create_branch", params)

    async def list_branches(self, owner: str, repo: str) -> dict[str, Any]:
        """List all branches of a repository."""
        return await self._client.call_tool(
            "list_branches",
            {"owner": owner, "repo": repo},
        )

    # ==================================================================
    # Commits
    # ==================================================================

    async def list_commits(self, owner: str, repo: str, branch: str | None = None) -> dict[str, Any]:
        """List recent commits, optionally filtered by branch."""
        params: dict[str, Any] = {"owner": owner, "repo": repo}
        if branch:
            params["sha"] = branch
        return await self._client.call_tool("list_commits", params)

    # ==================================================================
    # Issues
    # ==================================================================

    async def list_issues(self, owner: str, repo: str, state: str = "open") -> dict[str, Any]:
        """List issues for a repository."""
        return await self._client.call_tool(
            "list_issues",
            {"owner": owner, "repo": repo, "state": state},
        )

    async def get_issue(self, owner: str, repo: str, issue_number: int) -> dict[str, Any]:
        """Get details of a specific issue."""
        return await self._client.call_tool(
            "get_issue",
            {"owner": owner, "repo": repo, "issue_number": issue_number},
        )

    async def create_issue(
        self,
        owner: str,
        repo: str,
        title: str,
        body: str = "",
        labels: list[str] | None = None,
        assignees: list[str] | None = None,
    ) -> dict[str, Any]:
        """Create a new issue."""
        params: dict[str, Any] = {"owner": owner, "repo": repo, "title": title, "body": body}
        if labels:
            params["labels"] = labels
        if assignees:
            params["assignees"] = assignees
        return await self._client.call_tool("create_issue", params)

    async def update_issue(
        self,
        owner: str,
        repo: str,
        issue_number: int,
        title: str | None = None,
        body: str | None = None,
        state: str | None = None,
        labels: list[str] | None = None,
        assignees: list[str] | None = None,
    ) -> dict[str, Any]:
        """Update an existing issue (title, body, state, labels, assignees)."""
        params: dict[str, Any] = {"owner": owner, "repo": repo, "issue_number": issue_number}
        if title is not None:
            params["title"] = title
        if body is not None:
            params["body"] = body
        if state is not None:
            params["state"] = state
        if labels is not None:
            params["labels"] = labels
        if assignees is not None:
            params["assignees"] = assignees
        return await self._client.call_tool("update_issue", params)

    async def add_issue_comment(self, owner: str, repo: str, issue_number: int, body: str) -> dict[str, Any]:
        """Add a comment to an issue or pull request."""
        return await self._client.call_tool(
            "add_issue_comment",
            {"owner": owner, "repo": repo, "issue_number": issue_number, "body": body},
        )

    async def search_issues(self, query: str) -> dict[str, Any]:
        """Search issues and pull requests across GitHub."""
        return await self._client.call_tool("search_issues", {"q": query})

    # ==================================================================
    # Pull requests
    # ==================================================================

    async def create_pull_request(
        self,
        owner: str,
        repo: str,
        title: str,
        body: str,
        head: str,
        base: str,
        draft: bool = False,
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
                "draft": draft,
            },
        )

    async def list_pull_requests(
        self,
        owner: str,
        repo: str,
        state: str = "open",
        sort: str = "created",
        direction: str = "desc",
    ) -> dict[str, Any]:
        """List pull requests for a repository."""
        return await self._client.call_tool(
            "list_pull_requests",
            {"owner": owner, "repo": repo, "state": state, "sort": sort, "direction": direction},
        )

    async def get_pull_request(self, owner: str, repo: str, pull_number: int) -> dict[str, Any]:
        """Get details of a specific pull request."""
        return await self._client.call_tool(
            "get_pull_request",
            {"owner": owner, "repo": repo, "pull_number": pull_number},
        )

    async def get_pull_request_files(self, owner: str, repo: str, pull_number: int) -> dict[str, Any]:
        """Get list of files changed in a pull request."""
        return await self._client.call_tool(
            "get_pull_request_files",
            {"owner": owner, "repo": repo, "pull_number": pull_number},
        )

    async def get_pull_request_status(self, owner: str, repo: str, pull_number: int) -> dict[str, Any]:
        """Get combined CI/check status of a pull request."""
        return await self._client.call_tool(
            "get_pull_request_status",
            {"owner": owner, "repo": repo, "pull_number": pull_number},
        )

    async def get_pull_request_comments(self, owner: str, repo: str, pull_number: int) -> dict[str, Any]:
        """Get review comments on a pull request."""
        return await self._client.call_tool(
            "get_pull_request_comments",
            {"owner": owner, "repo": repo, "pull_number": pull_number},
        )

    async def get_pull_request_reviews(self, owner: str, repo: str, pull_number: int) -> dict[str, Any]:
        """Get reviews submitted on a pull request."""
        return await self._client.call_tool(
            "get_pull_request_reviews",
            {"owner": owner, "repo": repo, "pull_number": pull_number},
        )

    async def create_pull_request_review(
        self,
        owner: str,
        repo: str,
        pull_number: int,
        body: str,
        event: str = "COMMENT",
        comments: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Submit a review on a pull request.

        event: APPROVE | REQUEST_CHANGES | COMMENT
        comments: inline comments [{path, position, body}]
        """
        params: dict[str, Any] = {
            "owner": owner,
            "repo": repo,
            "pull_number": pull_number,
            "body": body,
            "event": event,
        }
        if comments:
            params["comments"] = comments
        return await self._client.call_tool("create_pull_request_review", params)

    async def merge_pull_request(
        self,
        owner: str,
        repo: str,
        pull_number: int,
        commit_title: str | None = None,
        merge_method: str = "merge",
    ) -> dict[str, Any]:
        """Merge a pull request. merge_method: merge | squash | rebase."""
        params: dict[str, Any] = {"owner": owner, "repo": repo, "pull_number": pull_number, "merge_method": merge_method}
        if commit_title:
            params["commit_title"] = commit_title
        return await self._client.call_tool("merge_pull_request", params)

    async def update_pull_request_branch(self, owner: str, repo: str, pull_number: int) -> dict[str, Any]:
        """Update a pull request branch with the latest changes from the base branch."""
        return await self._client.call_tool(
            "update_pull_request_branch",
            {"owner": owner, "repo": repo, "pull_number": pull_number},
        )

    # ==================================================================
    # Code scanning
    # ==================================================================

    async def get_code_scanning_alert(self, owner: str, repo: str, alert_number: int) -> dict[str, Any]:
        """Get details of a code scanning alert."""
        return await self._client.call_tool(
            "get_code_scanning_alert",
            {"owner": owner, "repo": repo, "alertNumber": alert_number},
        )

    async def list_code_scanning_alerts(self, owner: str, repo: str, severity: str | None = None) -> dict[str, Any]:
        """List code scanning alerts for a repository."""
        params: dict[str, Any] = {"owner": owner, "repo": repo}
        if severity:
            params["severity"] = severity
        return await self._client.call_tool("list_code_scanning_alerts", params)
