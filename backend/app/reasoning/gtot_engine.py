"""Grounded Tree of Thoughts (GToT) engine.

Explores a repository via parallel MCP tool calls organized as a tree.
Each node is a tool call; results are scored by an LLM judge.
High-scoring branches are expanded deeper; low-scoring ones are pruned.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Awaitable, Callable

from app.mcp.client import MCPClient
from app.providers.base import BaseLLMProvider, LLMMessage, LLMRequest

logger = logging.getLogger(__name__)

EventCallback = Callable[[dict[str, Any]], Awaitable[None]]


def _extract_json(raw: str | None) -> Any:
    """Safely extract JSON from an LLM response, stripping markdown fences."""
    if not raw:
        return None
    text = raw.strip()
    # Strip markdown code fences
    if text.startswith("```"):
        text = text.removeprefix("```json").removeprefix("```")
        text = text.removesuffix("```").strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try to find a balanced JSON object or array
    for start_char, end_char in [('{', '}'), ('[', ']')]:
        start = text.find(start_char)
        if start == -1:
            continue
        # Walk forward to find balanced closing
        depth = 0
        for i in range(start, len(text)):
            if text[i] == start_char:
                depth += 1
            elif text[i] == end_char:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except json.JSONDecodeError:
                        break
    return None


# ── Data structures ──

class NodeStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    PRUNED = "pruned"


@dataclass
class ThoughtNode:
    id: str
    tool_name: str
    tool_args: dict
    parent_id: str | None = None
    children: list["ThoughtNode"] = field(default_factory=list)
    result: Any = None
    result_preview: str = ""
    score: float = 0.0
    score_reason: str = ""
    status: NodeStatus = NodeStatus.PENDING
    reasoning: str = ""
    latency_ms: float = 0.0

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "tool_name": self.tool_name,
            "tool_args": self.tool_args,
            "parent_id": self.parent_id,
            "children": [c.id for c in self.children],
            "result_preview": self.result_preview,
            "score": self.score,
            "score_reason": self.score_reason,
            "status": self.status.value,
            "reasoning": self.reasoning,
            "latency_ms": self.latency_ms,
        }


@dataclass
class ThoughtTree:
    task: str
    root_nodes: list[ThoughtNode] = field(default_factory=list)
    max_depth: int = 3
    max_breadth: int = 5
    pruning_threshold: float = 0.6

    def _all_nodes(self) -> list[ThoughtNode]:
        result: list[ThoughtNode] = []
        stack = list(self.root_nodes)
        while stack:
            node = stack.pop()
            result.append(node)
            stack.extend(node.children)
        return result

    def get_best_path(self) -> list[ThoughtNode]:
        """Return the highest-scoring root-to-leaf path."""
        best: list[ThoughtNode] = []
        best_score = -1.0

        def dfs(node: ThoughtNode, path: list[ThoughtNode], total: float, count: int) -> None:
            nonlocal best, best_score
            path.append(node)
            new_total = total + node.score
            new_count = count + 1
            if not node.children:
                avg = new_total / new_count if new_count else 0
                if avg > best_score:
                    best_score = avg
                    best = list(path)
            else:
                for child in node.children:
                    if child.status != NodeStatus.PRUNED:
                        dfs(child, path, new_total, new_count)
            path.pop()

        for root in self.root_nodes:
            dfs(root, [], 0.0, 0)
        return best

    def get_all_results(self, min_score: float = 0.0) -> list[ThoughtNode]:
        return [n for n in self._all_nodes()
                if n.status == NodeStatus.COMPLETED and n.score >= min_score]

    def to_dict(self) -> dict:
        return {
            "task": self.task,
            "nodes": [n.to_dict() for n in self._all_nodes()],
            "best_path": [n.id for n in self.get_best_path()],
        }


# ── GToT Engine ──

PLAN_PROMPT = """\
You are a search planner for a code repository. Plan 2-6 parallel tool calls \
to explore the codebase and gather information relevant to the task.

Available tools:

Search & discovery:
- search_code: Search code. Args: {{"q": "query repo:owner/repo"}}
- search_repositories: Search repos. Args: {{"query": "keyword"}}
- search_issues: Search issues/PRs. Args: {{"q": "query"}}
- search_users: Search users. Args: {{"q": "query"}}

Repository content:
- get_file_contents: Get file or directory listing. Args: {{"owner": "...", "repo": "...", "path": "...", "branch": "..."}}
- list_commits: Recent commits. Args: {{"owner": "...", "repo": "...", "sha": "branch"}}
- list_branches: All branches. Args: {{"owner": "...", "repo": "..."}}

Issues:
- list_issues: List repo issues. Args: {{"owner": "...", "repo": "...", "state": "open|closed|all"}}
- get_issue: Single issue details. Args: {{"owner": "...", "repo": "...", "issue_number": N}}

Pull requests:
- list_pull_requests: List PRs. Args: {{"owner": "...", "repo": "...", "state": "open|closed|all"}}
- get_pull_request: PR details. Args: {{"owner": "...", "repo": "...", "pull_number": N}}
- get_pull_request_files: Files changed in a PR. Args: {{"owner": "...", "repo": "...", "pull_number": N}}
- get_pull_request_status: CI/check status. Args: {{"owner": "...", "repo": "...", "pull_number": N}}
- get_pull_request_comments: Review comments. Args: {{"owner": "...", "repo": "...", "pull_number": N}}
- get_pull_request_reviews: Submitted reviews. Args: {{"owner": "...", "repo": "...", "pull_number": N}}

Code scanning:
- list_code_scanning_alerts: Security alerts. Args: {{"owner": "...", "repo": "...", "severity": "critical|high|medium|low"}}
- get_code_scanning_alert: Alert details. Args: {{"owner": "...", "repo": "...", "alertNumber": N}}

Task: {task}
Repository: {repo}

Output JSON array: [{{"tool": "tool_name", "args": {{...}}, "reasoning": "why this call helps"}}]
Output ONLY the JSON array, no other text.
"""

SCORE_PROMPT = """\
Rate how relevant this tool result is for the given task.
Task: {task}
Tool: {tool}({args})
Result (first 500 chars): {result}

Output JSON: {{"score": 0.0-1.0, "reason": "brief explanation"}}
Output ONLY JSON.
"""

EXPAND_PROMPT = """\
Based on this tool result, should we make follow-up tool calls to get more detail?
Task: {task}
Tool: {tool}({args}) — Score: {score}
Result (first 500 chars): {result}

You can use ANY of these tools for follow-up:
search_code, search_repositories, search_issues, search_users,
get_file_contents, list_commits, list_branches,
list_issues, get_issue,
list_pull_requests, get_pull_request, get_pull_request_files,
get_pull_request_status, get_pull_request_comments, get_pull_request_reviews,
list_code_scanning_alerts, get_code_scanning_alert.

If yes, output JSON array of follow-up calls: [{{"tool": "...", "args": {{...}}, "reasoning": "..."}}]
If no follow-up needed, output: []
Output ONLY the JSON array.
"""


class GToTEngine:
    """Grounded Tree of Thoughts — parallel MCP exploration with LLM scoring."""

    def __init__(
        self,
        provider: BaseLLMProvider,
        model: str,
        mcp_client: MCPClient,
        *,
        max_depth: int = 3,
        max_breadth: int = 5,
        pruning_threshold: float = 0.6,
    ) -> None:
        self.provider = provider
        self.model = model
        self.mcp_client = mcp_client
        self.max_depth = max_depth
        self.max_breadth = max_breadth
        self.pruning_threshold = pruning_threshold
        self._emit: EventCallback | None = None

    async def _event(self, event: dict[str, Any]) -> None:
        if self._emit:
            await self._emit(event)

    # ── 1. Plan initial exploration ──

    async def plan_exploration(self, task: str, repo: str) -> list[ThoughtNode]:
        prompt = PLAN_PROMPT.format(task=task, repo=repo)
        resp = await self.provider.complete(LLMRequest(
            messages=[LLMMessage(role="user", content=prompt)],
            model=self.model,
            temperature=0.3,
            max_tokens=512,
            stream=False,
        ))

        plans = _extract_json(resp.content)
        if not plans:
            logger.warning("GToT plan_exploration: empty or unparseable LLM response, using fallback")
            return [ThoughtNode(
                id=uuid.uuid4().hex[:8],
                tool_name="search_code",
                tool_args={"q": f"{task} repo:{repo}"},
                reasoning="Fallback: LLM returned empty response",
            )]

        nodes: list[ThoughtNode] = []
        if not isinstance(plans, list):
            plans = [plans]
        for plan in plans[:self.max_breadth]:
            try:
                node = ThoughtNode(
                    id=uuid.uuid4().hex[:8],
                    tool_name=plan["tool"],
                    tool_args=plan.get("args", {}),
                    reasoning=plan.get("reasoning", ""),
                )
                nodes.append(node)
            except (KeyError, TypeError) as e:
                logger.debug("Skipping malformed plan node: %s", e)

        if not nodes:
            return [ThoughtNode(
                id=uuid.uuid4().hex[:8],
                tool_name="search_code",
                tool_args={"q": f"{task} repo:{repo}"},
                reasoning="Fallback: could not parse LLM plan",
            )]

        return nodes

    # ── 2. Execute nodes in parallel ──

    async def execute_parallel(self, nodes: list[ThoughtNode]) -> list[ThoughtNode]:
        async def execute_one(node: ThoughtNode) -> ThoughtNode:
            node.status = NodeStatus.RUNNING
            await self._event({
                "type": "gtot_node_start",
                "node_id": node.id,
                "tool": node.tool_name,
                "args": node.tool_args,
                "parent_id": node.parent_id,
            })

            t0 = time.perf_counter()
            try:
                result = await asyncio.wait_for(
                    self.mcp_client.call_tool(node.tool_name, node.tool_args),
                    timeout=30.0,
                )
                node.result = result.get("content", "")
                node.result_preview = str(node.result)[:300]
                node.status = NodeStatus.COMPLETED
            except asyncio.TimeoutError:
                node.result = "TIMEOUT"
                node.result_preview = "Timeout after 30s"
                node.status = NodeStatus.FAILED
            except Exception as e:
                node.result = str(e)
                node.result_preview = f"Error: {e}"
                node.status = NodeStatus.FAILED

            node.latency_ms = (time.perf_counter() - t0) * 1000

            await self._event({
                "type": "gtot_node_result",
                "node_id": node.id,
                "tool": node.tool_name,
                "result_preview": node.result_preview,
                "latency_ms": round(node.latency_ms),
                "status": node.status.value,
            })
            return node

        await asyncio.gather(*(execute_one(n) for n in nodes))
        return nodes

    # ── 3. Score results via LLM-as-judge (parallel) ──

    async def score_results(self, nodes: list[ThoughtNode], task: str) -> list[ThoughtNode]:
        async def score_one(node: ThoughtNode) -> ThoughtNode:
            if node.status == NodeStatus.FAILED:
                node.score = 0.0
                node.score_reason = "tool call failed"
                await self._event({
                    "type": "gtot_node_scored",
                    "node_id": node.id,
                    "score": 0.0,
                    "reason": node.score_reason,
                })
                return node

            if node.status != NodeStatus.COMPLETED:
                node.score = 0.0
                return node

            # Check if result contains error indicators
            result_str = str(node.result or "")
            if any(err in result_str.lower() for err in ["error", "invalid", "not found", "timeout", "failed"]):
                # Penalize error results but still score them
                error_penalty = True
            else:
                error_penalty = False

            prompt = SCORE_PROMPT.format(
                task=task,
                tool=node.tool_name,
                args=json.dumps(node.tool_args, ensure_ascii=False),
                result=result_str[:500],
            )
            try:
                resp = await self.provider.complete(LLMRequest(
                    messages=[LLMMessage(role="user", content=prompt)],
                    model=self.model,
                    temperature=0.0,
                    max_tokens=150,
                    stream=False,
                ))
                raw = resp.content or ""
                logger.debug("Scorer raw response for %s: %s", node.id, raw[:200])

                parsed = _extract_json(raw)
                if parsed and isinstance(parsed, dict):
                    node.score = min(1.0, max(0.0, float(parsed.get("score", 0.5))))
                    node.score_reason = parsed.get("reason", "")
                else:
                    # Flexible regex fallback: various score formats
                    score_match = re.search(
                        r'(?:score|Score|SCORE)\s*[":=\s]+\s*(0(?:\.\d+)?|1(?:\.0)?)',
                        raw
                    )
                    if not score_match:
                        # Try bare float pattern: "0.8" or "0.75"
                        score_match = re.search(r'\b(0\.\d+|1\.0|0|1)\b', raw)
                    if score_match:
                        node.score = min(1.0, max(0.0, float(score_match.group(1))))
                        reason_match = re.search(r'(?:reason|Reason)\s*[":=\s]+\s*"?([^"\n]+)"?', raw)
                        node.score_reason = reason_match.group(1).strip() if reason_match else "extracted from response"
                    else:
                        node.score = 0.3  # Uncertain rather than neutral
                        node.score_reason = f"unparseable response: {raw[:60]}"
                        logger.warning("Scorer unparseable for %s: %s", node.id, raw[:120])

                # Apply error penalty
                if error_penalty and node.score > 0.3:
                    node.score = min(node.score, 0.3)
                    node.score_reason = f"error in result — {node.score_reason}"

            except Exception as e:
                logger.warning("Scoring failed for node %s: %s", node.id, e)
                node.score = 0.1
                node.score_reason = f"scoring error: {e}"

            # Truncate stored result to limit memory usage
            node.result = node.result[:1000] if node.result else None

            await self._event({
                "type": "gtot_node_scored",
                "node_id": node.id,
                "score": round(node.score, 2),
                "reason": node.score_reason,
            })
            return node

        await asyncio.gather(*(score_one(n) for n in nodes))
        return nodes

    # ── 4. Prune low-scoring nodes ──

    def prune(self, nodes: list[ThoughtNode]) -> list[ThoughtNode]:
        surviving: list[ThoughtNode] = []
        for node in nodes:
            if node.score < self.pruning_threshold and node.status == NodeStatus.COMPLETED:
                node.status = NodeStatus.PRUNED
            else:
                surviving.append(node)
        return surviving

    # ── 5. Expand high-scoring nodes ──

    async def expand_tree(self, tree: ThoughtTree, scored_nodes: list[ThoughtNode], task: str, depth: int) -> list[ThoughtNode]:
        if depth >= tree.max_depth:
            return []

        eligible = [n for n in scored_nodes
                     if n.status == NodeStatus.COMPLETED and n.score >= self.pruning_threshold]
        if not eligible:
            return []

        async def _expand_one(node: ThoughtNode) -> list[ThoughtNode]:
            prompt = EXPAND_PROMPT.format(
                task=task,
                tool=node.tool_name,
                args=json.dumps(node.tool_args, ensure_ascii=False),
                score=str(node.score),
                result=str(node.result)[:500],
            )
            try:
                resp = await self.provider.complete(LLMRequest(
                    messages=[LLMMessage(role="user", content=prompt)],
                    model=self.model,
                    temperature=0.3,
                    max_tokens=512,
                    stream=False,
                ))
                expansions = _extract_json(resp.content)
                if not isinstance(expansions, list) or len(expansions) == 0:
                    return []

                child_nodes: list[ThoughtNode] = []
                for exp in expansions[:2]:  # max 2 children per node
                    child = ThoughtNode(
                        id=uuid.uuid4().hex[:8],
                        tool_name=exp["tool"],
                        tool_args=exp.get("args", {}),
                        parent_id=node.id,
                        reasoning=exp.get("reasoning", ""),
                    )
                    child_nodes.append(child)
                    node.children.append(child)

                if child_nodes:
                    await self._event({
                        "type": "gtot_expand",
                        "parent_id": node.id,
                        "new_nodes": [{"id": c.id, "tool": c.tool_name, "args": c.tool_args, "reasoning": c.reasoning} for c in child_nodes],
                    })
                return child_nodes

            except (json.JSONDecodeError, KeyError):
                return []

        results = await asyncio.gather(*(_expand_one(n) for n in eligible))
        new_nodes: list[ThoughtNode] = []
        for child_list in results:
            new_nodes.extend(child_list)
        return new_nodes

    # ── Main run loop ──

    async def run(
        self,
        task: str,
        repo: str,
        event_callback: EventCallback | None = None,
    ) -> ThoughtTree:
        self._emit = event_callback

        tree = ThoughtTree(
            task=task,
            max_depth=self.max_depth,
            max_breadth=self.max_breadth,
            pruning_threshold=self.pruning_threshold,
        )

        # Phase 1: Plan
        logger.info("GToT: planning exploration for '%s'", task[:80])
        root_nodes = await self.plan_exploration(task, repo)
        if not root_nodes:
            logger.warning("GToT: no exploration plan generated")
            return tree

        tree.root_nodes = root_nodes
        await self._event({
            "type": "gtot_plan",
            "planned_nodes": [{"id": n.id, "tool": n.tool_name, "args": n.tool_args, "reasoning": n.reasoning} for n in root_nodes],
        })

        # Iterative: execute → score → prune → expand
        current_nodes = root_nodes
        for depth in range(self.max_depth):
            if not current_nodes:
                break

            # Execute
            await self.execute_parallel(current_nodes)

            # Score
            await self.score_results(current_nodes, task)

            # Prune
            surviving = self.prune(current_nodes)
            pruned = [n for n in current_nodes if n.status == NodeStatus.PRUNED]
            for n in pruned:
                await self._event({
                    "type": "gtot_pruned",
                    "node_id": n.id,
                    "score": round(n.score, 2),
                    "reason": n.score_reason,
                })

            # Expand
            current_nodes = await self.expand_tree(tree, surviving, task, depth + 1)

        # Complete
        best_path = tree.get_best_path()
        all_results = tree.get_all_results(min_score=0.0)
        await self._event({
            "type": "gtot_complete",
            "total_nodes": len(all_results),
            "best_score": round(best_path[-1].score if best_path else 0.0, 2),
            "best_path": [n.id for n in best_path],
        })

        logger.info("GToT complete: %d nodes, best score %.2f",
                     len(all_results), best_path[-1].score if best_path else 0)
        return tree
