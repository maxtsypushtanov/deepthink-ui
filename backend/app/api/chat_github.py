"""GitHub chat mode — agentic streaming with MCP tool calls."""

from __future__ import annotations

import asyncio
import json
import logging
import re

from fastapi import APIRouter

from app.db import database as db
from app.mcp.client import MCPClient
from app.mcp.github_tools import GitHubTools
from app.providers.base import LLMMessage
from app.reasoning.engine import ReasoningEngine

logger = logging.getLogger(__name__)

router = APIRouter()

# Human-readable action titles for GitHub tool calls (module-level for reuse)
_TOOL_ACTIONS = {
    "search_code": "Ищу код в репозитории",
    "search_repositories": "Ищу репозитории",
    "search_issues": "Ищу issues и pull requests",
    "get_file_contents": "Читаю файл",
    "list_commits": "Загружаю историю коммитов",
    "list_issues": "Загружаю список issues",
    "get_issue": "Читаю issue",
    "list_pull_requests": "Загружаю список PR",
    "get_pull_request": "Читаю pull request",
    "get_pull_request_files": "Смотрю файлы PR",
    "create_pull_request": "Создаю pull request",
    "create_issue": "Создаю issue",
    "list_branches": "Загружаю список веток",
    "create_branch": "Создаю ветку",
}

GITHUB_SYSTEM_PROMPT = """\
Ты — ассистент с доступом к GitHub через инструменты. Отвечай на русском языке.

Когда пользователь просит что-то связанное с GitHub (код, issues, PR, репозитории), \
ты ДОЛЖЕН вызвать нужный инструмент и использовать результат в ответе.

Для вызова инструмента выведи JSON-блок в формате:
```tool_call
{"tool": "tool_name", "args": {...}}
```

Доступные инструменты:

ПОИСК:
- search_code: Поиск кода. args: {"q": "query repo:owner/repo"}
- search_repositories: Поиск репозиториев. args: {"query": "keyword"}
- search_issues: Поиск issues/PR. args: {"q": "query"}

КОНТЕНТ РЕПОЗИТОРИЯ:
- get_file_contents: Получить файл/директорию. args: {"owner": "...", "repo": "...", "path": "...", "branch": "..."}
- push_files: Запушить файлы одним коммитом. args: {"owner": "...", "repo": "...", "branch": "...", "files": [{"path": "...", "content": "..."}], "message": "..."}
- create_or_update_file: Создать/обновить файл. args: {"owner": "...", "repo": "...", "path": "...", "content": "...", "message": "...", "branch": "..."}

ВЕТКИ:
- create_branch: Создать ветку. args: {"owner": "...", "repo": "...", "branch": "...", "from_branch": "..."}
- list_branches: Список веток. args: {"owner": "...", "repo": "..."}

КОММИТЫ:
- list_commits: Список коммитов. args: {"owner": "...", "repo": "...", "sha": "branch"}

ISSUES:
- list_issues: Список issues. args: {"owner": "...", "repo": "...", "state": "open|closed|all"}
- get_issue: Детали issue. args: {"owner": "...", "repo": "...", "issue_number": N}
- create_issue: Создать issue. args: {"owner": "...", "repo": "...", "title": "...", "body": "...", "labels": [...]}
- update_issue: Обновить issue. args: {"owner": "...", "repo": "...", "issue_number": N, "state": "open|closed", ...}
- add_issue_comment: Комментарий. args: {"owner": "...", "repo": "...", "issue_number": N, "body": "..."}

PULL REQUESTS:
- create_pull_request: Создать PR. args: {"owner": "...", "repo": "...", "title": "...", "body": "...", "head": "...", "base": "..."}
- list_pull_requests: Список PR. args: {"owner": "...", "repo": "...", "state": "open|closed|all"}
- get_pull_request: Детали PR. args: {"owner": "...", "repo": "...", "pull_number": N}
- get_pull_request_files: Файлы PR. args: {"owner": "...", "repo": "...", "pull_number": N}
- get_pull_request_status: CI статус. args: {"owner": "...", "repo": "...", "pull_number": N}
- get_pull_request_comments: Комментарии PR. args: {"owner": "...", "repo": "...", "pull_number": N}
- get_pull_request_reviews: Ревью PR. args: {"owner": "...", "repo": "...", "pull_number": N}
- create_pull_request_review: Подать ревью. args: {"owner": "...", "repo": "...", "pull_number": N, "body": "...", "event": "APPROVE|REQUEST_CHANGES|COMMENT"}
- merge_pull_request: Мёрж PR. args: {"owner": "...", "repo": "...", "pull_number": N, "merge_method": "merge|squash|rebase"}

CODE SCANNING:
- list_code_scanning_alerts: Алерты безопасности. args: {"owner": "...", "repo": "..."}
- get_code_scanning_alert: Детали алерта. args: {"owner": "...", "repo": "...", "alertNumber": N}

ПРАВИЛА:
- Используй инструменты когда вопрос касается конкретного репо, кода, issues или PR.
- Можешь вызвать несколько инструментов последовательно.
- После получения результата — дай краткий ответ на русском.
- Если пользователь не указал репозиторий — спроси.
"""

TOOL_CALL_RE = re.compile(
    r'```tool_call\s*\n\s*(\{.*?\})\s*\n\s*```',
    re.DOTALL,
)


async def _github_event_stream(messages, provider, req, conversation_id):
    """Agentic LLM streaming with GitHub MCP tool calls."""
    from app.core.config import settings as app_settings
    from app.providers.base import LLMRequest

    yield {
        "event": "conversation",
        "data": json.dumps({"conversation_id": conversation_id}),
    }
    yield {
        "event": "strategy_selected",
        "data": json.dumps({
            "strategy": "none",
            "intent": "github",
            "domain": "software_engineering",
            "label": "GitHub Agent",
            "persona_preview": "GitHub-ассистент с MCP",
            "persona_detail": "Режим GitHub — доступ к инструментам через MCP",
        }),
    }
    yield {"event": "thinking_start", "data": json.dumps({"strategy": "github"})}

    # Helper must be defined before first use
    step_counter = 0
    accumulated_steps: list[dict] = []

    def _step(label: str, content: str, step_type: str = "reasoning"):
        nonlocal step_counter
        step_counter += 1
        accumulated_steps.append({
            "step_number": step_counter,
            "strategy": "github",
            "content": label,
            "duration_ms": 0,
            "metadata": {"type": step_type, "content": content[:800]},
        })
        return {
            "event": "thinking_step",
            "data": json.dumps({
                "step": step_counter, "label": label,
                "type": step_type, "content": content[:800],
            }, ensure_ascii=False),
        }

    # Initialize MCP client — try config (.env) first, then DB provider settings
    mcp_client: MCPClient | None = None
    token = app_settings.github_personal_access_token or await db.get_provider_key("github") or ""
    if not token:
        yield _step("GitHub токен не настроен", "Установите GITHUB_PERSONAL_ACCESS_TOKEN в .env или добавьте токен в Настройках (провайдер 'github')", "tool_error")
    if token:
        try:
            mcp_client = MCPClient(
                command="npx",
                args=["-y", "@modelcontextprotocol/server-github"],
                env={"GITHUB_PERSONAL_ACCESS_TOKEN": token},
            )
            await mcp_client.initialize()
        except Exception as e:
            logger.error("Failed to initialize GitHub MCP client: %s", e)
            mcp_client = None
            yield _step("Ошибка MCP", f"Не удалось подключить GitHub MCP: {e}", "tool_error")

    github = GitHubTools(mcp_client) if mcp_client else None

    # Agentic loop: LLM can request tool calls, we execute and feed results back
    MAX_TOOL_ROUNDS = 6
    current_messages = list(messages)
    final_answer = ""

    try:
        for round_idx in range(MAX_TOOL_ROUNDS + 1):
            llm_req = LLMRequest(
                messages=current_messages,
                model=req.model,
                temperature=0.3,
                max_tokens=max(req.max_tokens, 4096),
                stream=True,
            )

            raw_content = ""
            gh_reasoning_buf = ""
            async for chunk in provider.stream(llm_req):
                if hasattr(chunk, "reasoning_content") and chunk.reasoning_content:
                    gh_reasoning_buf += chunk.reasoning_content
                    if len(gh_reasoning_buf) >= 200:
                        yield _step("Размышление", gh_reasoning_buf)
                        gh_reasoning_buf = ""
                    continue
                content = chunk.content or ""
                if content:
                    raw_content += content
            if gh_reasoning_buf:
                yield _step("Размышление", gh_reasoning_buf)

            # Check for tool_call blocks in response
            tool_matches = TOOL_CALL_RE.findall(raw_content)

            if not tool_matches or not mcp_client:
                # No tool calls — this is the final answer
                # Strip tool call blocks and thinking from final answer
                final_answer = TOOL_CALL_RE.sub('', raw_content).strip()
                final_answer = re.sub(r'<thinking>.*?</thinking>', '', final_answer, flags=re.DOTALL).strip()
                break

            # Execute tool calls
            tool_results: list[str] = []
            for match in tool_matches:
                try:
                    call = json.loads(match)
                    tool_name = call.get("tool", "")
                    tool_args = call.get("args", {})

                    action_title = _TOOL_ACTIONS.get(tool_name, f"Вызываю {tool_name}")
                    yield _step(action_title, json.dumps(tool_args, ensure_ascii=False)[:300], "tool_call")

                    result = await asyncio.wait_for(
                        mcp_client.call_tool(tool_name, tool_args),
                        timeout=30.0,
                    )
                    result_text = result.get("content", "")
                    if len(result_text) > 3000:
                        result_text = result_text[:3000] + "\n... (обрезано)"

                    yield _step(f"Получен результат: {tool_name}", result_text[:400], "tool_result")
                    tool_results.append(f"Tool `{tool_name}` result:\n{result_text}")

                except asyncio.TimeoutError:
                    yield _step(f"Timeout: {tool_name}", "Таймаут 30с", "tool_error")
                    tool_results.append(f"Tool `{tool_name}` timed out after 30s.")
                except json.JSONDecodeError:
                    yield _step("Parse error", match[:200], "tool_error")
                    tool_results.append(f"Failed to parse tool call: {match[:200]}")
                except Exception as e:
                    yield _step(f"Error: {tool_name}", str(e)[:300], "tool_error")
                    tool_results.append(f"Tool `{tool_name}` error: {e}")

            # Feed tool results back to LLM for next round
            # Strip tool calls from assistant message, add tool results
            assistant_text = TOOL_CALL_RE.sub('', raw_content).strip()
            current_messages.append(LLMMessage(role="assistant", content=raw_content))
            current_messages.append(LLMMessage(
                role="user",
                content="Результаты вызовов инструментов:\n\n" + "\n\n---\n\n".join(tool_results)
                + "\n\nИспользуй эти результаты для ответа. Если нужно больше данных — вызови ещё инструменты. Иначе — дай финальный ответ на русском.",
            ))

    except Exception as e:
        yield {"event": "error", "data": json.dumps({"error": str(e)})}
        if mcp_client:
            await mcp_client.close()
        return

    # Close MCP client
    if mcp_client:
        await mcp_client.close()

    yield {
        "event": "thinking_end",
        "data": json.dumps({
            "strategy": "github",
            "steps": accumulated_steps,
            "total_duration_ms": 0,
        }, ensure_ascii=False),
    }

    # Clean and stream final answer
    final_answer = ReasoningEngine._strip_meta_text(final_answer)
    final_answer = re.sub(r'\n{3,}', '\n\n', final_answer).strip()

    if final_answer:
        yield {
            "event": "content_delta",
            "data": json.dumps({"content": final_answer}, ensure_ascii=False),
        }

    await db.add_message(
        conversation_id, "assistant", final_answer or "",
        model=req.model, provider=req.provider,
        reasoning_strategy="github",
    )

    yield {"event": "done", "data": json.dumps({})}
