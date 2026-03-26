# DeepThink UI — Полное описание проекта

> Последнее обновление: 2026-03-25

## Обзор

**DeepThink UI** — персональный веб-интерфейс для LLM с продвинутым движком рассуждений (9 стратегий), управлением календарём, интеграцией с GitHub через MCP и анализом файлов.

**Стек:**
- Frontend: React 19 + TypeScript + Zustand + Tailwind CSS + Radix UI
- Backend: FastAPI + aiosqlite + SSE streaming
- Deploy: Docker Compose
- БД: SQLite (основная + календарь)

---

## Архитектура

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (Vite)                    │
│  React 19 · Zustand · Tailwind · Radix UI           │
│  ┌──────────┐ ┌──────────┐ ┌───────────────────┐    │
│  │ ChatArea │ │ Calendar │ │ CommandPalette     │    │
│  │ Input    │ │ View     │ │ Settings           │    │
│  │ Message  │ │ Chat     │ │ Sidebar            │    │
│  └──────────┘ └──────────┘ └───────────────────┘    │
│         ↕ SSE/WS          ↕ REST                     │
├─────────────────────────────────────────────────────┤
│                  Backend (FastAPI)                    │
│  ┌───────────┐ ┌──────────┐ ┌─────────────────┐    │
│  │ Reasoning │ │ Calendar │ │ Files            │    │
│  │ Engine    │ │ CRUD     │ │ Parser/Chunker   │    │
│  │ 9 strats  │ │          │ │ 30+ форматов     │    │
│  └───────────┘ └──────────┘ └─────────────────┘    │
│  ┌───────────┐ ┌──────────┐ ┌─────────────────┐    │
│  │ Providers │ │ MCP/     │ │ Prefill Cache   │    │
│  │ OpenRouter│ │ GitHub   │ │ WebSocket       │    │
│  │ DeepSeek  │ │ 40+ tools│ │ Predictive      │    │
│  └───────────┘ └──────────┘ └─────────────────┘    │
│                    ↕ SQL                             │
│              SQLite (aiosqlite)                      │
└─────────────────────────────────────────────────────┘
```

---

## Стратегии рассуждений (9 штук)

| Стратегия | Описание | LLM вызовов | Иконка |
|-----------|----------|-------------|--------|
| **auto** | Автовыбор на основе сложности и домена | 1-8 | ⚡ |
| **none** | Прямой ответ без рассуждений | 1 | 🎯 |
| **cot** | Chain of Thought — пошаговое рассуждение | 1 | 🧠 |
| **budget_forcing** | Многораундовый анализ с самопроверкой | 3-5 | ✨ |
| **best_of_n** | Генерация N вариантов + голосование | 4-6 | 🔀 |
| **tree_of_thoughts** | Дерево подходов с оценкой ветвей | 6-8 | 🌲 |
| **persona_council** | Совет экспертов — несколько точек зрения | 4-6 | 👥 |
| **rubber_duck** | Объясни → проверь → исправь | 3 | 🐛 |
| **socratic** | 3 подвопроса → ответы → синтез | 5 | ❓ |

---

## Frontend — Компоненты

### Чат

| Компонент | Назначение |
|-----------|-----------|
| **ChatArea** | Контейнер сообщений, автоскролл, план/черновик календаря, retry при ошибках, live-статус в header |
| **ChatInput** | Поле ввода с файлами (drag-drop), голосовой ввод, режимы Calendar/GitHub, DepthSlider, вращающиеся плейсхолдеры |
| **ChatMessage** | Рендер сообщения: markdown, подсветка кода, аватарки, действия (copy/edit/fork/regen), цветная полоса стратегии |
| **StreamingMessage** | Live-контент: markdown в реальном времени, ReasoningTimeline, streaming cursor, пульсирующий аватар |
| **EmptyState** | Стартовый экран: адаптивное приветствие, 3 случайных стартера, недавние чаты, подсказки возможностей, ambient-анимация |
| **DepthSlider** | Ползунок глубины мышления 1-5 (замена 9 кнопок стратегий), кнопка Авто/Ручной, Advanced-выпадашка |
| **CollapsibleMessage** | Автосвёртка старых сообщений (>8 в беседе → первые сворачиваются в 1 строку) |
| **ChatSearch** | Поиск по чату (Cmd+Shift+F), подсветка совпадений, навигация вперёд/назад |
| **QuoteToolbar** | Выделение текста → цитирование в ответе |
| **ForkView** | Split-view для сравнения веток беседы |

### Календарь

| Компонент | Назначение |
|-----------|-----------|
| **CalendarView** | Недельная сетка Пн-Пт 8:00-20:00, drag-resize событий, now-line с пульсацией, автоскролл к текущему времени, glass-morphism карточки, мини-навигатор по месяцам |
| **CalendarChat** | Встроенный чат-ассистент для CRUD событий голосом/текстом |
| **QuickStatsBar** | Сводка дня: кол-во встреч, свободное время, countdown до следующей |
| **TodayAgendaPanel** | Правая панель с повесткой дня + AI-брифинг |

### Навигация и утилиты

| Компонент | Назначение |
|-----------|-----------|
| **Sidebar** | Список бесед с папками, drag-drop, поиск, тема, настройки. На мобилке — slide-over |
| **CommandPalette** | ⌘K меню: стратегии, навигация, режимы, тема, экспорт |
| **SettingsDialog** | Провайдеры API, модели, параметры reasoning |
| **ErrorBoundary** | Graceful fallback вместо белого экрана |
| **ToastContainer** | Уведомления success/error/info с auto-dismiss |
| **Skeleton** | Shimmer-плейсхолдеры при загрузке |

### Reasoning

| Компонент | Назначение |
|-----------|-----------|
| **ReasoningTimeline** | Горизонтальный timeline шагов мышления с hover-tooltip и expand |
| **ThinkingPanel** | Полный список шагов мышления (для вопросов уточнения) |
| **ReasoningTree** | Визуализация дерева мыслей через ReactFlow (@xyflow/react) |
| **PersonaIndicator** | Индикатор текущей персоны/эксперта в header |

---

## Frontend — Stores (Zustand)

### chatStore
- **State:** conversations, folders, activeConversationId, messages, streaming (isStreaming, currentContent, thinkingSteps, strategyUsed, tokensGenerated...), settings, calendarMode, githubMode, calendarDraft, executionPlan, error
- **Actions:** loadConversations, selectConversation, createConversation, deleteConversation, sendMessage, stopStreaming, updateSettings, toggleCalendarMode/GitHubMode, confirmCalendarDraft, acceptPlan, handleFileAnalysisStream, folder CRUD
- **Default model:** `google/gemini-3.1-flash-lite-preview` via OpenRouter

### calendarStore
- **State:** weekOffset, events, loading, error, briefing
- **Actions:** loadWeekEvents, prev/nextWeek, goToday, createEvent, deleteEvent, updateEvent, checkConflicts, loadBriefing

### forkStore
- **State:** activeFork, branches (Map)
- **Actions:** createFork (max 2 per conversation), closeFork, setActiveFork

### themeStore
- **State:** mode (dark/light)
- **Actions:** toggle, setMode

---

## Frontend — Hooks

| Hook | Назначение |
|------|-----------|
| **useToast** | Zustand store для toast-уведомлений. `toast.success()`, `toast.error()`, `toast.info()` |
| **useVoiceInput** | Обёртка над Web Speech API. isListening, toggle, continuous mode |
| **useWebSocketReasoning** | WebSocket `/api/chat/ws/{session}` для предиктивного prefill при наборе текста |

---

## Frontend — Клавиатурные сочетания

| Комбинация | Действие |
|-----------|----------|
| `Cmd+N` | Новый чат |
| `Cmd+/` | Фокус на поле ввода |
| `Cmd+1` | Вкладка "Чат" |
| `Cmd+2` | Вкладка "Календарь" |
| `Cmd+,` | Настройки |
| `Cmd+K` | Палитра команд |
| `Cmd+Shift+F` | Поиск по чату |
| `Enter` | Отправить сообщение |
| `Shift+Enter` | Новая строка |
| `N` (в календаре) | Новое событие на текущее время |
| `Escape` | Закрыть модальные окна |
| `↑ / ↓` | Навигация в палитре команд |

---

## Backend — API Endpoints

### Чат и беседы
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/conversations` | Список всех бесед |
| POST | `/api/conversations` | Создать беседу |
| GET | `/api/conversations/{id}/messages` | Сообщения беседы |
| PATCH | `/api/conversations/{id}` | Обновить заголовок |
| DELETE | `/api/conversations/{id}` | Удалить беседу |
| PUT | `/api/conversations/{id}/folder` | Переместить в папку |
| POST | `/api/chat` | **SSE streaming чат** с reasoning |
| POST | `/api/chat/plan` | Получить план выполнения |
| POST | `/api/chat/fork` | Создать ветку беседы |

### Папки
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/folders` | Список папок |
| POST | `/api/folders` | Создать папку |
| PUT | `/api/folders/{id}` | Переименовать |
| DELETE | `/api/folders/{id}` | Удалить |
| PUT | `/api/folders/{id}/move` | Переместить |

### Календарь
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/calendar/events` | События в диапазоне дат |
| POST | `/api/calendar/events` | Создать событие |
| PATCH | `/api/calendar/events/{id}` | Обновить событие |
| DELETE | `/api/calendar/events/{id}` | Удалить событие |
| POST | `/api/calendar/confirm` | Подтвердить черновик действия |
| POST | `/api/calendar/free-slots` | Найти свободные слоты |
| POST | `/api/calendar/briefing` | AI-повестка дня |

### Файлы
| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/files/upload` | Загрузить файл (30+ форматов, max 10MB) |
| POST | `/api/files/analyze` | Анализ файлов с запросом (SSE) |
| GET | `/api/files/{id}` | Метаданные файла |

### Провайдеры
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/settings/providers` | Список провайдеров |
| POST | `/api/settings/providers` | Сохранить API ключ |
| GET | `/api/models/{provider}` | Список моделей |

### WebSocket
| Путь | Описание |
|------|----------|
| WS `/api/chat/ws/{sessionId}` | Предиктивный reasoning (prefill) при наборе текста |

### Утилиты
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/health` | Health check |

---

## Backend — Движок рассуждений

### ReasoningEngine (`reasoning/engine.py`)
- **9 стратегий** с автоматическим выбором
- **Детекция домена**: software_engineering, mathematics, medicine, law, finance, science, creative_writing, business, philosophy, general
- **Классификация сложности**: 1-5 шкала
- **Детекция неоднозначности**: задаёт уточняющие вопросы
- **PersonaBuilder**: динамические системные промпты на основе домена + стратегии
- **Session Context**: отслеживает домен, экспертизу, номер хода

### GToT Engine (`reasoning/gtot_engine.py`)
- Grounded Tree of Thoughts — исследование репозиториев через MCP
- Параллельные tool calls организованы как дерево
- LLM-судья для скоринга ветвей

### Prefill Cache (`reasoning/prefill_cache.py`)
- Кэш результатов reasoning для похожих запросов
- Jaccard similarity (порог 0.7)
- LRU, max 100 записей, timeout 10s

---

## Backend — Провайдеры LLM

| Провайдер | URL | Описание |
|-----------|-----|----------|
| OpenRouter | `openrouter.ai/api/v1` | Агрегатор 100+ моделей (по умолчанию) |
| DeepSeek | `api.deepseek.com/v1` | Native reasoning tokens |
| CloudRu | `api.cloud.ru/v1` | Российский провайдер |
| Custom | Настраиваемый | Любой OpenAI-совместимый API |

---

## Backend — MCP/GitHub интеграция

**40+ GitHub инструментов** через Model Context Protocol:
- Поиск: код, репозитории, issues, пользователи
- Репозитории: файлы, ветки, коммиты, форки
- Issues: CRUD + комментарии
- Pull Requests: создание, ревью, мерж, статус
- Code Scanning: alerts

**Агентный цикл**: LLM генерирует tool_call → выполнение → результат → LLM → ... (до 6 раундов)

---

## Backend — Анализ файлов

**30+ форматов**: txt, md, py, js, ts, tsx, json, yaml, pdf, docx, pptx, xlsx, csv, html, css, sql, go, rs, java, c, cpp, png, jpg, gif, webp...

| Модуль | Назначение |
|--------|-----------|
| `parser.py` | Извлечение текста из файлов (pypdf, python-docx, openpyxl, Pillow для изображений) |
| `chunker.py` | Разбиение на чанки (3000 символов, 500 overlap, semantic breaks) |
| `synthesizer.py` | Сборка контекста файла для LLM |
| `router.py` | Автовыбор стратегии для типа анализа |

---

## База данных

### Основная БД (SQLite)
```
folders          (id, name, parent_folder_id, created_at, updated_at)
conversations    (id, title, folder_id, created_at, updated_at)
messages         (id, conversation_id, role, content, model, provider,
                  reasoning_strategy, reasoning_trace, tokens_used, created_at)
provider_settings (id, provider, api_key, base_url, enabled, extra)
```

### Календарь БД (отдельный SQLite)
```
calendar_events  (id, title, description, start_time, end_time, color, created_at)
```

---

## ТРИЗ-инновации (применённые)

| Принцип | Где применён | Результат |
|---------|-------------|-----------|
| **1 — Дробление** | CollapsibleMessage | Старые сообщения сворачиваются в 1 строку |
| **2 — Вынесение** | ReasoningTimeline | Шаги мышления вынесены в горизонтальный timeline |
| **3 — Местное качество** | CalendarView | Колонка "сегодня" подсвечена, EmptyState зонирован |
| **10 — Предварительное действие** | Prefill Cache, auto-scroll | WebSocket prefill + календарь скроллит к "сейчас" |
| **13 — Наоборот** | EmptyState, DepthSlider | Система выбирает стратегию, не пользователь |
| **15 — Динамичность** | Everywhere | Адаптивное приветствие, live status, пульсирующий аватар, now-line |
| **17 — Другое измерение** | ReasoningTimeline, DepthSlider | Горизонтальный timeline, ползунок вместо списка |
| **25 — Самообслуживание** | EmptyState, QuickStatsBar | Недавние чаты, countdown до встречи, hints возможностей |
| **28 — Замена механической схемы** | EmptyState | Ambient-анимация мысле-частиц |
| **35 — Изменение параметров** | EventChip, ChatInput | Glass-morphism карточки, glow при фокусе |

---

## Docker

```bash
# Запуск всего проекта
docker-compose up --build

# Или по отдельности
cd backend && python3 -m uvicorn app.main:app --reload --port 8000
cd frontend && npm run dev
```

**Порты:**
- Backend: `localhost:8000`
- Frontend: `localhost:5173` (dev) / `localhost:3000` (docker)

---

## Безопасность

- **Rate limiting**: 30 req/min на POST /api/chat (token bucket per IP)
- **SSRF защита**: блокировка приватных IP в CustomProvider
- **CORS**: настроен на localhost:5173
- **Параметризованные SQL запросы**: защита от инъекций
- **Файловый кэш**: TTL 1 час, max 30 файлов, 10MB лимит

### Известные проблемы безопасности
- API ключи в БД хранятся plaintext (нужно шифрование)
- Нет аутентификации пользователей
- WebSocket без rate limiting
- `.env` содержит секреты (нужно отозвать засвеченные токены)

---

## Структура проекта

```
deepthink-ui/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── chat/           # ChatArea, ChatInput, ChatMessage, StreamingMessage,
│   │   │   │                   # EmptyState, DepthSlider, CollapsibleMessage,
│   │   │   │                   # ChatSearch, QuoteToolbar, ForkView, ModelSelector
│   │   │   ├── Calendar/       # CalendarView, CalendarChat
│   │   │   ├── reasoning/      # ReasoningTimeline, ThinkingPanel, ReasoningTree,
│   │   │   │                   # PersonaIndicator, PersonaCard
│   │   │   ├── layout/         # Sidebar
│   │   │   ├── settings/       # SettingsDialog
│   │   │   ├── sidebar/        # ChatExplorer
│   │   │   ├── icons/          # DeepThinkLogo
│   │   │   ├── CommandPalette.tsx
│   │   │   ├── ErrorBoundary.tsx
│   │   │   ├── Toast.tsx
│   │   │   └── Skeleton.tsx
│   │   ├── hooks/              # useToast, useVoiceInput, useWebSocketReasoning
│   │   ├── lib/                # api, constants, utils, strategies
│   │   ├── stores/             # chatStore, calendarStore, forkStore, themeStore
│   │   ├── types/              # index.ts (все TypeScript типы)
│   │   ├── styles/             # globals.css
│   │   └── App.tsx
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   └── vite.config.ts
├── backend/
│   ├── app/
│   │   ├── api/                # routes, calendar, files, ws, schemas
│   │   ├── reasoning/          # engine, gtot_engine, prefill_cache
│   │   ├── providers/          # base, registry
│   │   ├── mcp/                # client, github_tools
│   │   ├── db/                 # database, calendar
│   │   ├── files/              # parser, chunker, synthesizer, router
│   │   ├── core/               # config
│   │   └── main.py
│   ├── Dockerfile
│   └── requirements.txt
├── docker-compose.yml
├── PROJECT_STATE.md            # ← этот файл
├── AUDIT_REPORT.md
└── README.md
```
