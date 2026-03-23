"""Shared context object that flows through the multi-agent dev loop."""

from __future__ import annotations

from pydantic import BaseModel, Field


class CodeChange(BaseModel):
    """A single file-level code change proposed by the Developer agent."""

    file: str
    content: str
    action: str = "create"  # create | modify | delete


class Issue(BaseModel):
    """A problem discovered by the Tester agent."""

    description: str
    severity: str = "medium"  # low | medium | high | critical
    file: str | None = None


class IterationSnapshot(BaseModel):
    """Frozen record of one iteration for audit / replay."""

    iteration: int
    spec: str | None = None
    design_decisions: list[str] = Field(default_factory=list)
    code_changes: list[CodeChange] = Field(default_factory=list)
    test_results: str | None = None
    issues_found: list[Issue] = Field(default_factory=list)
    decision: str | None = None
    decision_reasoning: str | None = None


class DevLoopContext(BaseModel):
    """Mutable state passed between agents in the pipeline."""

    task: str
    repo: str
    iteration: int = 0
    status: str = "running"
    spec: str | None = None
    design_decisions: list[str] = Field(default_factory=list)
    code_changes: list[CodeChange] = Field(default_factory=list)
    issues_found: list[Issue] = Field(default_factory=list)
    test_results: str | None = None
    pull_request_url: str | None = None
    decision: str | None = None
    decision_reasoning: str | None = None
    history: list[IterationSnapshot] = Field(default_factory=list)

    def snapshot(self) -> IterationSnapshot:
        """Capture the current iteration state."""
        return IterationSnapshot(
            iteration=self.iteration,
            spec=self.spec,
            design_decisions=list(self.design_decisions),
            code_changes=[c.model_copy() for c in self.code_changes],
            test_results=self.test_results,
            issues_found=[i.model_copy() for i in self.issues_found],
            decision=self.decision,
            decision_reasoning=self.decision_reasoning,
        )
