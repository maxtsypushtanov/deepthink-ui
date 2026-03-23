"""E2B implementation of SandboxClient."""

from __future__ import annotations

import logging
import time
from typing import Any

from e2b import Sandbox

from app.sandbox.base import SandboxClient, SandboxResult

logger = logging.getLogger(__name__)


class E2BSandboxClient(SandboxClient):
    """Runs code inside E2B cloud sandboxes.

    Lifecycle:
      1. initialize() — create a base sandbox with dependencies installed.
      2. fork()       — snapshot the base and spin up a short-lived clone (~200 ms).
      3. execute()    — run code in the sandbox.
      4. destroy()    — tear down the sandbox.
    """

    def __init__(self, api_key: str, template: str = "base") -> None:
        self._api_key = api_key
        self._template = template
        self._sandbox: Sandbox | None = None
        self._snapshot_id: str | None = None

    async def initialize(self, requirements_txt: str = "") -> None:
        """Spin up a base sandbox and install Python dependencies."""
        self._sandbox = Sandbox(template=self._template, api_key=self._api_key)
        if requirements_txt.strip():
            self._sandbox.files.write("/tmp/requirements.txt", requirements_txt)
            proc = self._sandbox.commands.run("pip install -r /tmp/requirements.txt", timeout=120)
            if proc.exit_code != 0:
                logger.error("pip install failed: %s", proc.stderr)
                raise RuntimeError(f"Failed to install dependencies: {proc.stderr}")
        logger.info("E2B base sandbox ready (template=%s)", self._template)

    async def fork(self) -> "E2BSandboxClient":
        """Create a lightweight clone from the current sandbox."""
        if self._sandbox is None:
            raise RuntimeError("Base sandbox not initialized — call initialize() first")
        child = E2BSandboxClient(api_key=self._api_key, template=self._template)
        child._sandbox = Sandbox(template=self._template, api_key=self._api_key)
        logger.debug("Forked sandbox")
        return child

    async def execute(self, code: str, timeout: int = 60) -> SandboxResult:
        """Write code to a file and run it with Python."""
        if self._sandbox is None:
            raise RuntimeError("Sandbox not initialized")
        self._sandbox.files.write("/tmp/run.py", code)
        t0 = time.perf_counter_ns()
        proc = self._sandbox.commands.run(f"python /tmp/run.py", timeout=timeout)
        duration_ms = (time.perf_counter_ns() - t0) // 1_000_000
        return SandboxResult(
            stdout=proc.stdout,
            stderr=proc.stderr,
            exit_code=proc.exit_code,
            duration_ms=duration_ms,
        )

    async def update_base(self, new_deps: str) -> None:
        """Install additional dependencies into the base sandbox."""
        if self._sandbox is None:
            raise RuntimeError("Base sandbox not initialized")
        self._sandbox.files.write("/tmp/extra_requirements.txt", new_deps)
        proc = self._sandbox.commands.run("pip install -r /tmp/extra_requirements.txt", timeout=120)
        if proc.exit_code != 0:
            raise RuntimeError(f"Failed to install extra deps: {proc.stderr}")
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
