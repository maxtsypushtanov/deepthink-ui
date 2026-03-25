# DeepThink UI

Personal LLM Web UI with an advanced reasoning engine, multi-agent development pipeline, and AI-powered calendar.

![DeepThink UI](https://img.shields.io/badge/DeepThink-UI-blue?style=flat-square)
![Python](https://img.shields.io/badge/Python-3.11+-green?style=flat-square)
![React](https://img.shields.io/badge/React-19-blue?style=flat-square)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)

## Idea

A beautiful, minimalist chat interface where **any model gains reasoning superpowers** through a built-in orchestration layer. No need for expensive frontier models — even a cheap model thinks deeply and structurally through middleware reasoning strategies.

Three core modules:
- **Chat** with 5 reasoning strategies that wrap any LLM
- **Pipeline** — multi-agent development loop (Architect > Developer > Tester) with GitHub integration and code sandbox
- **Calendar** — AI-driven event management directly from chat

## Reasoning Engine — 5 Strategies

### CoT Injection (Chain-of-Thought)

Forces step-by-step thinking via system prompt injection. The model produces reasoning inside `<thinking>` tags following a 5-step framework, then delivers a concise answer. Single-pass, low temperature (0.3).

### Budget Forcing

Iterative deepening inspired by the s1 approach. When a model tries to stop, the engine appends a continuation prompt ("you haven't finished yet...") and forces additional rounds of analysis. Default 3 rounds with gradually increasing temperature (0.3 + round * 0.1). Only the final round streams to the user; intermediate rounds serve as self-correction passes.

### Best-of-N

Generates N parallel candidate responses (default 3) with varied temperatures, then asks the model to vote on the best answer at low temperature (0.1). The winner is streamed to the user. Metadata includes candidate indices and vote reasoning.

### Tree of Thoughts

Multi-path exploration with configurable breadth (default 3) and depth (default 2). At each level, branches are scored 0.0-1.0 by the model. The engine follows parent-child links to find the highest-scoring path through the tree, then synthesizes a final answer. The full tree structure with node IDs, scores, and parent links is preserved in metadata.

### Auto

Runs three classification tasks in parallel:
1. **Ambiguity detection** — returns a clarification question if the query is unclear
2. **Complexity rating** (1-5) — maps to the appropriate strategy
3. **Domain detection** — classifies into one of 10 domains (software_engineering, mathematics, medicine, law, finance, science, creative_writing, business, philosophy, general)

Mapping: complexity 1-2 = passthrough/CoT, 3 = CoT/Budget Forcing, 4-5 = Tree of Thoughts/Best-of-N.

## Multi-Agent Pipeline

An automated development loop that takes a task description and a GitHub repository, then iterates through specialized agents:

| Agent | Role |
|---|---|
| **Architect** | Analyzes the repo via MCP tools, produces a structured implementation plan with file changes |
| **Developer** | Reads relevant files, generates code changes following the architect's plan |
| **Tester** | Spins up an E2B sandbox, writes test files, runs pytest, reports issues |
| **Orchestrator** | Reviews iteration results, decides: next iteration, done, or create PR |

Features:
- **Task complexity classification** — simple (1 iteration), medium (max 2), complex (max 5)
- **GitHub integration** via MCP — repository search, file reading, PR creation
- **E2B sandbox** — isolated code execution with pip dependency installation
- **Real-time streaming** via WebSocket — agent events, thinking steps, tool calls
- **Grounded Tree of Thoughts (GToT)** — parallel MCP tool calls organized as a scored tree for exploration planning
- **Automatic state reset** between iterations to prevent stale data bleed

## Calendar

AI-powered event management integrated into the chat interface:
- Toggle calendar mode in chat input to create/update/delete events via natural language
- The LLM response is parsed for calendar actions (JSON extraction with regex fallback)
- Weekly view with event chips sized by duration
- Free slot finder — specify a date and duration, get available windows
- Full CRUD API with ISO 8601 datetime validation and `end > start` enforcement

## Multi-Provider Support

| Provider | Base URL | Notes |
|---|---|---|
| **OpenRouter** | `openrouter.ai/api/v1` | 200+ models via single API key |
| **DeepSeek** | `api.deepseek.com/v1` | Including R1 with native reasoning |
| **Cloud.ru** | `api.cloud.ru/v1` | Russian foundation model servers |
| **Custom** | Any OpenAI-compatible URL | SSRF-protected: internal/private IPs blocked |

Models are fetched dynamically from provider APIs with a fallback to a built-in known models list.

## Design

- Dark-first minimalist UI inspired by Linear, iA Writer, and Vercel
- **Geist** font family (Sans + Mono)
- Collapsible thinking panel with color-coded step badges
- Interactive reasoning tree visualization (React Flow)
- Drag-and-drop conversation organization with folders
- Light theme available via settings toggle

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Frontend | React, TypeScript, Vite | 19.0, 5.7, 6.0 |
| Styling | TailwindCSS, shadcn/ui, Radix UI | 3.4 |
| State | Zustand | 5.0 |
| Visualization | React Flow (@xyflow) | 12.4 |
| Markdown | react-markdown + remark-gfm | 9.0 |
| DnD | @dnd-kit | - |
| Icons | Lucide React | 0.469 |
| Backend | FastAPI, Uvicorn | 0.115, 0.34 |
| Database | SQLite via aiosqlite | 0.20 |
| HTTP | httpx (async) | 0.28 |
| Streaming | sse-starlette (SSE) | 2.2 |
| Validation | Pydantic + pydantic-settings | 2.10 |
| Tools | MCP (Model Context Protocol) | 1.0+ |
| Sandbox | E2B (code execution) | 1.0+ |

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+
- At least one LLM provider API key

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env      # Add your API keys
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The Vite dev server proxies `/api` requests to `localhost:8000`.

## Configuration

### Environment Variables

Copy `backend/.env.example` to `backend/.env` and fill in:

```env
# Provider API keys (at least one required)
OPENROUTER_API_KEY=sk-or-...
DEEPSEEK_API_KEY=sk-...
CLOUDRU_API_KEY=...
CUSTOM_API_KEY=...
CUSTOM_BASE_URL=http://localhost:11434/v1

# Database
DATABASE_URL=sqlite+aiosqlite:///./deepthink.db

# Pipeline (optional — only needed for multi-agent mode)
GITHUB_PERSONAL_ACCESS_TOKEN=ghp_...
E2B_API_KEY=e2b_...

# Agent models (optional — override per-agent model selection)
ARCHITECT_MODEL=openai/gpt-4o
DEVELOPER_MODEL=anthropic/claude-sonnet-4-20250514
TESTER_MODEL=anthropic/claude-sonnet-4-20250514
ORCHESTRATOR_MODEL=openai/gpt-4o

# Pipeline limits
MAX_ITERATIONS=5
STOP_ON_CLEAN_ITERATIONS=2

# Server
HOST=0.0.0.0
PORT=8000
CORS_ORIGINS=["http://localhost:5173"]
```

### In-App Settings

1. Open the app and click the settings icon
2. Add API keys for your providers
3. Select a model and reasoning strategy
4. Start chatting

## API Reference

### Chat

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/chat` | Stream a chat response with reasoning (SSE) |

SSE event types: `strategy_selected`, `thinking_start`, `thinking_step`, `content_delta`, `thinking_end`, `done`, `error`, `clarification_needed`, `conversation`.

### Conversations

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/conversations` | List all conversations |
| POST | `/api/conversations` | Create a conversation |
| GET | `/api/conversations/{id}` | Get conversation details |
| GET | `/api/conversations/{id}/messages` | Get message history |
| PATCH | `/api/conversations/{id}` | Update title |
| DELETE | `/api/conversations/{id}` | Delete conversation |
| PUT | `/api/conversations/{id}/folder` | Move to folder |

### Folders

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/folders` | List folders |
| POST | `/api/folders` | Create folder |
| PUT | `/api/folders/{id}` | Rename folder |
| DELETE | `/api/folders/{id}` | Delete folder (reparents children) |
| PUT | `/api/folders/{id}/move` | Move folder (cycle-safe) |

### Calendar

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/calendar/events?start=...&end=...` | List events in range |
| POST | `/api/calendar/events` | Create event |
| GET | `/api/calendar/events/{id}` | Get event |
| PATCH | `/api/calendar/events/{id}` | Update event |
| DELETE | `/api/calendar/events/{id}` | Delete event |
| POST | `/api/calendar/free-slots` | Find free slots (date + duration) |

### Pipeline

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/pipeline/run` | Start multi-agent pipeline |
| GET | `/api/pipeline/{id}/status` | Get task status and context |
| DELETE | `/api/pipeline/{id}` | Cancel pipeline task |
| WS | `/api/pipeline/{id}/stream` | Real-time event stream (WebSocket) |

### Settings & Models

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/settings/providers` | Get provider configs (keys masked) |
| POST | `/api/settings/providers` | Save provider settings |
| GET | `/api/models/{provider}` | List available models |

### Health

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Health check |

## Project Structure

```
deepthink-ui/
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI entry, CORS, lifespan
│   │   ├── api/
│   │   │   ├── routes.py           # Chat, conversations, folders, settings, models
│   │   │   ├── pipeline.py         # Multi-agent pipeline endpoints
│   │   │   ├── calendar.py         # Calendar CRUD + free slots
│   │   │   └── schemas.py          # Pydantic request/response models
│   │   ├── core/
│   │   │   └── config.py           # Settings from .env
│   │   ├── db/
│   │   │   ├── database.py         # SQLite: conversations, messages, folders, settings
│   │   │   └── calendar.py         # SQLite: calendar events
│   │   ├── providers/
│   │   │   ├── base.py             # BaseLLMProvider (stream + complete)
│   │   │   └── registry.py         # OpenRouter, DeepSeek, Cloud.ru, Custom
│   │   ├── reasoning/
│   │   │   ├── engine.py           # ReasoningEngine: 5 strategies + PersonaBuilder
│   │   │   └── gtot_engine.py      # Grounded Tree of Thoughts for pipeline
│   │   ├── agents/
│   │   │   ├── base_agent.py       # Abstract agent with event emission
│   │   │   ├── architect.py        # Repo analysis + implementation plan
│   │   │   ├── developer.py        # Code change generation
│   │   │   ├── tester.py           # Sandbox test execution
│   │   │   ├── orchestrator.py     # Iteration decision + PR creation
│   │   │   └── utils.py            # Shared JSON parsing utilities
│   │   ├── pipeline/
│   │   │   ├── dev_loop.py         # Main iteration loop
│   │   │   └── context.py          # Pipeline state (CodeChange, Issue, DevLoopContext)
│   │   ├── mcp/
│   │   │   ├── client.py           # MCP client with timeout protection
│   │   │   └── github_tools.py     # GitHub MCP tool wrappers
│   │   └── sandbox/
│   │       └── e2b_sandbox.py      # E2B sandbox (async-safe)
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.tsx                 # Layout: Sidebar + tab routing (Chat/Pipeline/Calendar)
│   │   ├── components/
│   │   │   ├── chat/               # ChatArea, ChatInput, ChatMessage, StreamingMessage,
│   │   │   │                       # ModelSelector, EmptyState
│   │   │   ├── Pipeline/           # PipelineView, AgentFeed, AgentCard, IterationTimeline,
│   │   │   │                       # ReasoningTree, GroundedTree, MCPCallLog, SandboxOutput
│   │   │   ├── Calendar/           # CalendarView (weekly grid with event chips)
│   │   │   ├── reasoning/          # PersonaIndicator
│   │   │   ├── settings/           # SettingsDialog
│   │   │   └── sidebar/            # Sidebar, ChatExplorer (folders + DnD)
│   │   ├── stores/
│   │   │   ├── chatStore.ts        # Conversations, messages, SSE streaming
│   │   │   ├── pipelineStore.ts    # Pipeline tasks, WebSocket events
│   │   │   ├── calendarStore.ts    # Calendar events, week navigation
│   │   │   └── themeStore.ts       # Dark/light theme toggle
│   │   ├── lib/
│   │   │   ├── api.ts              # Typed API client + SSE stream parser
│   │   │   └── utils.ts            # Helpers (generateId, formatTimestamp, cn)
│   │   └── types/
│   │       ├── index.ts            # Core types: Message, Conversation, ReasoningStrategy
│   │       └── pipeline.ts         # Pipeline types: PipelineEvent, GToTNode, DevLoopContext
│   ├── package.json
│   ├── vite.config.ts              # Dev proxy /api -> localhost:8000
│   └── tailwind.config.js
└── README.md
```

## Architecture

```
Browser (React 19 + Zustand)
    │
    ├── SSE stream ──────────────> POST /api/chat
    ├── WebSocket ───────────────> WS /api/pipeline/{id}/stream
    └── REST ────────────────────> GET/POST/PATCH/DELETE /api/*
                                        │
                                   FastAPI (async)
                                        │
                    ┌───────────────────┼───────────────────┐
                    │                   │                   │
             ReasoningEngine      DevLoop Pipeline    Calendar DB
              (5 strategies)           │
                    │            ┌─────┼─────┐
                    │         Architect  Developer  Tester
                    │            │         │         │
                    └────────────┴────┬────┘    E2B Sandbox
                                      │
                              LLM Providers          MCP / GitHub
                         (OpenRouter, DeepSeek,
                          Cloud.ru, Custom)
```

## Session & Persona System

Each conversation maintains a `SessionContext` that tracks:
- **Domain history** — detected domains across messages with frequency-based dominant domain
- **User expertise signals** — inferred from conversation depth (beginner/intermediate/expert)
- **Auto-retune** — re-evaluates domain every 2 turns

The `PersonaBuilder` constructs a system prompt establishing the "DeepThink" identity with domain-specific expertise, adapted to the user's inferred level. All reasoning happens inside `<thinking>` tags; the final answer follows the principle "think deeply, answer briefly."

## License

MIT
