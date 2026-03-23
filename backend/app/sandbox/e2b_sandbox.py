"""E2B implementation of SandboxClient (compatible with e2b SDK v2.16.0)."""

from __future__ import annotations

import logging
import os
import time

from e2b import Sandbox
from e2b.exceptions import CommandExitException

from app.sandbox.base import SandboxClient, SandboxResult

logger = logging.getLogger(__name__)


def _set_api_key(api_key: str) -> None:
    """Ensure E2B_API_KEY is in the environment (SDK reads it automatically)."""
    if api_key:
        os.environ["E2B_API_KEY"] = api_key


class E2BSandboxClient(SandboxClient):
    """Runs code inside E2B cloud sandboxes.

    Lifecycle:
      1. initialize() — create a base sandbox with dependencies installed.
      2. fork()       — spin up a fresh sandbox for a single test run.
      3. execute()    — run code in the sandbox.
      4. destroy()    — tear down the sandbox.
    """

    def __init__(self, api_key: str, template: str = "base") -> None:
        self._api_key = api_key
        self._template = template
        self._sandbox: Sandbox | None = None

    async def initialize(self, requirements_txt: str = "") -> None:
        """Spin up a base sandbox and install Python dependencies."""
        _set_api_key(self._api_key)
        self._sandbox = Sandbox.create(template=self._template)
        if requirements_txt.strip():
            self._sandbox.files.write("/tmp/requirements.txt", requirements_txt)
            try:
                self._sandbox.commands.run("pip install -r /tmp/requirements.txt", timeout=120)
            except CommandExitException as exc:
                logger.error("pip install failed: %s", exc.stderr)
                raise RuntimeError(f"Failed to install dependencies: {exc.stderr}") from exc
        logger.info("E2B base sandbox ready (template=%s)", self._template)

    async def fork(self) -> "E2BSandboxClient":
        """Create a fresh sandbox clone for a single run."""
        if self._sandbox is None:
            raise RuntimeError("Base sandbox not initialized — call initialize() first")
        _set_api_key(self._api_key)
        child = E2BSandboxClient(api_key=self._api_key, template=self._template)
        child._sandbox = Sandbox.create(template=self._template)
        logger.debug("Forked sandbox")
        return child

    async def execute(self, code: str, timeout: int = 60) -> SandboxResult:
        """Write code to a file and run it with Python."""
        if self._sandbox is None:
            raise RuntimeError("Sandbox not initialized")
        self._sandbox.files.write("/tmp/run.py", code)
        t0 = time.perf_counter_ns()
        try:
            proc = self._sandbox.commands.run("python /tmp/run.py", timeout=timeout)
            duration_ms = (time.perf_counter_ns() - t0) // 1_000_000
            return SandboxResult(
                stdout=proc.stdout,
                stderr=proc.stderr,
                exit_code=proc.exit_code,
                duration_ms=duration_ms,
            )
        except CommandExitException as exc:
            duration_ms = (time.perf_counter_ns() - t0) // 1_000_000
            return SandboxResult(
                stdout=exc.stdout,
                stderr=exc.stderr,
                exit_code=exc.exit_code,
                duration_ms=duration_ms,
            )

    async def update_base(self, new_deps: str) -> None:
        """Install additional dependencies into the base sandbox."""
        if self._sandbox is None:
            raise RuntimeError("Base sandbox not initialized")
        self._sandbox.files.write("/tmp/extra_requirements.txt", new_deps)
        try:
            self._sandbox.commands.run("pip install -r /tmp/extra_requirements.txt", timeout=120)
        except CommandExitException as exc:
            raise RuntimeError(f"Failed to install extra deps: {exc.stderr}") from exc
        logger.info("Updated base sandbox with additional dependencies")

    async def destroy(self) -> None:
        """Kill the sandbox."""
        if self._sandbox is not None:
            try:
                self._sandbox.kill()
            except Exception:
                logger.warning("Error killing E2B sandbox", exc_info=True)
            self._sandbox = None
            logger.debug("E2B sandbox destroyed")
