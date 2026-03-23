"""Abstract sandbox interface for isolated code execution."""

from __future__ import annotations

from abc import ABC, abstractmethod

from pydantic import BaseModel


class SandboxResult(BaseModel):
    """Result of executing code inside a sandbox."""

    stdout: str = ""
    stderr: str = ""
    exit_code: int = 0
    duration_ms: int = 0


class SandboxClient(ABC):
    """Abstract interface for sandbox providers (E2B, Docker, etc.)."""

    @abstractmethod
    async def initialize(self, requirements_txt: str = "") -> None:
        """Create the base sandbox environment and install dependencies."""
        ...

    @abstractmethod
    async def fork(self) -> "SandboxClient":
        """Create a lightweight clone of the current sandbox for a single run."""
        ...

    @abstractmethod
    async def execute(self, code: str, timeout: int = 60) -> SandboxResult:
        """Run *code* inside the sandbox and return the result."""
        ...

    @abstractmethod
    async def run_command(self, cmd: str, timeout: int = 60) -> SandboxResult:
        """Run a shell command inside the sandbox and return the result."""
        ...

    @abstractmethod
    async def write_file(self, path: str, content: str) -> None:
        """Write a file inside the sandbox."""
        ...

    @abstractmethod
    async def destroy(self) -> None:
        """Tear down this sandbox and release resources."""
        ...
