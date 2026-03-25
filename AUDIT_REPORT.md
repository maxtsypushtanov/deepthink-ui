# Аудит проекта DeepThink UI

Дата: 2026-03-25
Аудитор: Claude Code (Opus 4.6)

---

## Executive Summary

- **Overall rating: 7/10**
- **Critical issues: 3**
- **High: 6**
- **Low: 5**

DeepThink UI -- это зрелый прототип LLM Web UI с продвинутым reasoning engine, поддержкой множества стратегий рассуждений (CoT, Budget Forcing, Best-of-N, Tree of Thoughts, Persona Council, Rubber Duck, Socratic), календарем, файловым анализом и интеграцией GitHub через MCP. Архитектура в целом хорошо продумана, код читаемый, разделение ответственности соблюдается. Основные проблемы связаны с безопасностью хранения секретов, отсутствием аутентификации, потенциальными утечками памяти и высоким расходом LLM-вызовов в режиме "auto".

---

## Architecture Overview

### Компонентная схема

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend (React + Vite)              │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │ ChatArea  │  │ CalendarView │  │ Settings/Sidebar   │ │
│  └────┬─────┘  └──────┬───────┘  └────────┬───────────┘ │
│       │               │                    │             │
│  ┌────┴───────────────┴────────────────────┴──────────┐  │
│  │        Zustand Stores (chat, calendar, fork)       │  │
│  └────────────────────┬───────────────────────────────┘  │
│                       │ SSE / REST / WebSocket            │
└───────────────────────┼─────────────────────────────────┘
                        │
┌───────────────────────┼─────────────────────────────────┐
│              Backend (FastAPI + aiosqlite)               │
│                       │                                  │
│  ┌────────────────────┴───────────────────────────────┐  │
│  │              API Layer (routes, calendar, files, ws)│  │
│  └──────┬─────────────┬──────────────┬────────────────┘  │
│         │             │              │                    │
│  ┌──────┴──────┐ ┌────┴─────┐ ┌─────┴──────┐            │
│  │  Reasoning  │ │ Files    │ │ MCP Client │            │
│  │  Engine     │ │ Pipeline │ │ (GitHub)   │            │
│  │  (8 стратегий)│ │ (parse, │ └────────────┘            │
│  └──────┬──────┘ │ chunk,   │                            │
│         │        │ route,   │                            │
│  ┌──────┴──────┐ │ synth)   │                            │
│  │  Providers  │ └──────────┘                            │
│  │  Registry   │                                         │
│  │ (OpenRouter,│                                         │
│  │  DeepSeek,  │                                         │
│  │  CloudRu,   │                                         │
│  │  Custom)    │                                         │
│  └──────┬──────┘                                         │
│         │                                                │
│  ┌──────┴──────────────────────────────────────────────┐ │
│  │           SQLite (aiosqlite + WAL mode)             │ │
│  │  conversations, messages, folders, provider_settings,│ │
│  │  calendar_events                                    │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### Ключевые потоки данных

1. **Chat flow**: Frontend -> SSE POST `/api/chat` -> ReasoningEngine.run() -> LLM provider -> SSE events -> Frontend
2. **Calendar flow**: Chat с `calendar_mode=true` -> Direct streaming (без ReasoningEngine) -> Calendar draft -> User confirms -> `/api/calendar/confirm` -> DB
3. **File analysis**: Upload -> Parse -> Chunk (если > 100K символов) -> Route (выбор стратегии) -> ReasoningEngine -> SSE stream
4. **GitHub flow**: Chat с `github_mode=true` -> Agentic loop (до 6 раундов) -> MCP tool calls -> SSE stream
5. **Predictive reasoning (WS)**: WebSocket -> prefill domain/complexity while user types -> reuse if query similar enough

---

## Critical Issues

### C1. API-ключи хранятся в БД в открытом виде (plaintext)

**Файл**: `/backend/app/db/database.py:56-62` (schema), `/backend/app/db/database.py:298-312` (save_provider_settings)

**Проблема**: Поле `api_key` в таблице `provider_settings` хранится как `TEXT NOT NULL DEFAULT ''` без шифрования. При получении ключа (`get_provider_key`, строка 349) он читается напрямую. Любой, кто получит доступ к файлу `deepthink.db`, получит все API-ключи в открытом виде.

**Риск**: Утечка всех API-ключей провайдеров при компрометации файловой системы.

**Рекомендация**: Шифровать api_key перед записью (например, Fernet из cryptography с мастер-ключом из переменной окружения). Как минимум -- ограничить права доступа к файлу БД.

---

### C2. Отсутствие аутентификации и авторизации

**Файл**: `/backend/app/main.py:31-37`, все эндпоинты в `/backend/app/api/routes.py`

**Проблема**: Ни один эндпоинт не требует аутентификации. Любой, кто может достучаться до порта 8000 (а `host` по умолчанию `0.0.0.0` в `/backend/app/core/config.py:19`), получает полный доступ ко всем данным: чтение/удаление чатов, управление API-ключами, выполнение GitHub-операций с сохраненным токеном.

**Риск**: Полный несанкционированный доступ к данным и ресурсам при развертывании в сети.

**Рекомендация**: Добавить минимальную аутентификацию (хотя бы Bearer token или basic auth). Сменить `host` по умолчанию на `127.0.0.1` для локального использования.

---

### C3. Подтверждение календарных действий принимает произвольный dict

**Файл**: `/backend/app/api/routes.py:667-675`

```python
@router.post("/api/calendar/confirm")
async def confirm_calendar_action(req: dict = Body(...)):
    result = await _execute_calendar_action(req)
```

**Проблема**: Эндпоинт `/api/calendar/confirm` принимает произвольный `dict` без Pydantic-валидации и передает его напрямую в `_execute_calendar_action`. Функция `_execute_calendar_action` (строки 105-159) доверяет полям `event_id`, `title`, `start_time`, `end_time` из входного dict без проверки типов. Хотя SQL-инъекция маловероятна (используются параметризованные запросы), отсутствие схемы валидации означает, что клиент может отправить неожиданные поля.

**Риск**: Обход валидации, потенциальное удаление/обновление чужих событий через подмену `event_id`.

**Рекомендация**: Заменить `dict = Body(...)` на строго типизированную Pydantic-модель.

---

## High Issues

### H1. Глобальное singleton-подключение к SQLite без connection pooling

**Файл**: `/backend/app/db/database.py:19-20, 77-86`

```python
_db_connection: aiosqlite.Connection | None = None
_db_lock = asyncio.Lock()
```

**Проблема**: Используется одно глобальное подключение к SQLite, которое разделяется между всеми запросами. Lock используется только при первой инициализации. При concurrent записи из нескольких корутин (например, несколько одновременных чатов с commit), возможны ошибки "database is locked" или повреждение данных.

**Риск**: Потеря данных или ошибки при конкурентном доступе.

**Рекомендация**: Использовать пул подключений или мьютекс для операций записи.

---

### H2. Утечка памяти в `_session_contexts` и `_file_cache`

**Файл**: `/backend/app/api/routes.py:37-38`, `/backend/app/api/files.py:25-26`

**Проблема**: `_session_contexts` (dict, макс. 1000 записей) и `_file_cache` (dict, макс. 50 записей) используют наивную LRU-стратегию -- при достижении лимита удаляется первый элемент (`next(iter(...))`). Однако:
- `_session_contexts` не имеет TTL -- контексты для давно неактивных разговоров занимают память бесконечно.
- `_file_cache` хранит полный распарсенный текст файлов (до 20MB каждый). 50 файлов * 20MB = до 1GB RAM.
- Нет механизма очистки при перезагрузке или по таймеру.

**Риск**: OOM при долгой работе сервера.

**Рекомендация**: Добавить TTL (например, 1 час для файлов), использовать `cachetools.TTLCache` или аналогичную библиотеку.

---

### H3. В режиме "auto" делается 3 параллельных LLM-вызова на каждое сообщение

**Файл**: `/backend/app/reasoning/engine.py:382-388`

```python
(is_ambiguous, clarification_q), classified_strategy, domain = await asyncio.gather(
    self._check_ambiguity(messages),
    self._classify_complexity(messages),
    self._detect_domain(messages),
)
```

**Проблема**: При `strategy=auto` (дефолт) каждое сообщение пользователя порождает 3 дополнительных LLM-вызова для классификации ПЕРЕД основным запросом. Для стратегий вроде Tree of Thoughts (до `breadth * depth + 2` вызовов) или Persona Council (4 + 1 вызов) суммарное количество LLM-вызовов на одно сообщение может достигать 20+.

**Стоимость LLM-вызовов по стратегии (auto mode)**:
- none: 3 (classification) + 1 = 4
- cot: 3 + 1 = 4
- budget_forcing (3 rounds): 3 + 3 = 6
- best_of_n (3): 3 + 3 + 1 (vote) = 7
- tree_of_thoughts (3x2): 3 + 6 (branches) + 6 (scores) + 1 (synthesis) = 16
- persona_council: 3 + 4 (experts) + 1 (moderator) = 8
- socratic: 3 + 1 (questions) + 3 (answers) + 1 (synthesis) = 8
- rubber_duck: 3 + 1 (draft) + 1 (review) + 1 (fix) = 6

**Риск**: Высокая стоимость и задержка, особенно для простых вопросов, которые всё равно получат `strategy=none`.

**Рекомендация**: Объединить domain + complexity в один LLM-вызов. Рассмотреть кеширование domain detection на уровне сессии (частично реализовано через `retune_if_needed`, но classification всё равно вызывается каждый раз).

---

### H4. WebSocket предсказательный reasoning выполняет спекулятивные LLM-вызовы

**Файл**: `/backend/app/api/ws.py:59-120`

**Проблема**: Функция `_run_prefill` при каждом `partial_query` (каждом нажатии клавиши после дебаунса) запускает:
1. `_detect_domain` (1 LLM-вызов)
2. `_classify_complexity` (1 LLM-вызов)
3. Для стратегий CoT/None: полный draft CoT (1 streaming LLM-вызов)

Если пользователь печатает быстро, предыдущие задачи отменяются, но LLM-вызовы уже могут быть в процессе (HTTP-запрос не отменяется при `task.cancel()`). Threshold сходства (`SIMILARITY_THRESHOLD = 0.7`) означает, что ~30% prefill результатов будут отброшены как нерелевантные.

**Риск**: Расточительное потребление LLM-квоты и compute.

**Рекомендация**: Увеличить дебаунс. Не запускать draft CoT при partial query -- ограничиться domain + complexity. Добавить отмену HTTP-запроса при cancel задачи.

---

### H5. SSRF-защита для CustomProvider обходится по DNS

**Файл**: `/backend/app/providers/registry.py:12-32, 59-69`

**Проблема**: Функция `_is_internal_url` проверяет hostname на момент конфигурации, но DNS-запись может измениться между проверкой и фактическим HTTP-запросом (TOCTOU). Кроме того:
- Не блокируются IPv6-адреса вида `[::1]`, `[::ffff:127.0.0.1]`
- Не блокируется `0.0.0.0`
- Резолвинг DNS не выполняется (проверяется только literal IP)
- При `base_url=None` дефолт `http://localhost:11434/v1` разрешается (строка 60), но если пользователь явно передает `localhost` -- блокируется (строка 65). Это непоследовательно.

**Риск**: SSRF через DNS rebinding или IPv6-адреса.

**Рекомендация**: Резолвить DNS и проверять результирующий IP. Блокировать `0.0.0.0`, `[::]`, IPv6-mapped IPv4. Выполнять проверку при каждом запросе, не только при инициализации.

---

### H6. GitHub PAT передается в окружение subprocess без ограничения scope

**Файл**: `/backend/app/api/routes.py:280-284`

```python
mcp_client = MCPClient(
    command="npx",
    args=["-y", "@modelcontextprotocol/server-github"],
    env={"GITHUB_PERSONAL_ACCESS_TOKEN": token},
)
```

**Проблема**: GitHub PAT с потенциально широкими правами передается в subprocess (npx), который скачивает пакет из npm при каждом вызове (`-y` автоподтверждение). При supply chain атаке на `@modelcontextprotocol/server-github` токен будет скомпрометирован. Кроме того, GitHubTools предоставляет операции записи (create_issue, merge_pull_request, push_files) без дополнительного подтверждения пользователя.

**Риск**: Компрометация GitHub-аккаунта при supply chain атаке; непреднамеренные мутирующие операции (merge, push).

**Рекомендация**: Закрепить версию npm-пакета. Разделить read-only и write-операции и требовать подтверждения для мутирующих действий. Рекомендовать fine-grained PAT с минимальными scope.

---

## Low Issues

### L1. Неиспользуемый `system_prompt` в `build_file_context`

**Файл**: `/backend/app/files/synthesizer.py:62-76`

**Проблема**: Функция `build_file_context` строит подробный `system_prompt` (строки 62-76), но в `/backend/app/api/files.py:151-153` messages создаются БЕЗ system prompt -- используется только `user` сообщение. ReasoningEngine.run() затем заменяет messages[0] на persona prompt, а system_prompt из synthesizer полностью игнорируется.

**Рекомендация**: Либо использовать `ctx["system_prompt"]` в messages, либо удалить мертвый код.

---

### L2. `_TOOL_ACTIONS` dict создается при каждом tool call

**Файл**: `/backend/app/api/routes.py:342-357`

**Проблема**: Словарь `_TOOL_ACTIONS` определяется внутри цикла `for match in tool_matches:`, т.е. пересоздается для каждого tool call в каждом раунде. Это мелкая неоптимальность, но засоряет hot path.

**Рекомендация**: Вынести на уровень модуля.

---

### L3. Дефолтная модель в WebSocket не синхронизирована с фронтендом

**Файл**: `/backend/app/api/ws.py:132` vs `/frontend/src/stores/chatStore.ts:77`

**Проблема**: WebSocket endpoint использует дефолтную модель `openai/gpt-4o-mini`, а фронтенд -- `google/gemini-3.1-flash-lite-preview`. При первом partial_query без явного model клиент и сервер будут использовать разные модели.

**Рекомендация**: Использовать единую константу или всегда передавать model из фронтенда.

---

### L4. `search_conversations` уязвим к wildcard LIKE-запросу

**Файл**: `/backend/app/db/database.py:332-346`

```python
pattern = f"%{query}%"
cursor = await db.execute(
    "...WHERE c.title LIKE ? OR m.content LIKE ?...",
    (pattern, pattern),
)
```

**Проблема**: Символы `%` и `_` в пользовательском вводе не экранируются, что позволяет пользователю влиять на паттерн LIKE (например, ввести `%` для получения всех записей, или `_` как wildcard). Это не SQL-инъекция (используются параметры), но позволяет обходить ожидаемую семантику поиска.

**Рекомендация**: Экранировать `%` и `_` в query перед вставкой в LIKE-паттерн.

---

### L5. Отсутствие rate limiting

**Файл**: Все эндпоинты.

**Проблема**: Ни один эндпоинт не имеет rate limiting. `/api/chat` запускает дорогостоящие LLM-вызовы (до 16 на запрос). `/api/calendar/briefing` делает полный LLM-вызов. WebSocket endpoint запускает спекулятивные LLM-вызовы при каждом partial_query.

**Рекомендация**: Добавить rate limiting хотя бы для `/api/chat` и WebSocket (slowapi или кастомный middleware).

---

## Security Audit

### Secrets Handling

| Аспект | Статус | Детали |
|--------|--------|--------|
| API-ключи в .env | OK | Загружаются через pydantic-settings, файл не коммитится |
| API-ключи в БД | **CRITICAL** | Хранятся plaintext в SQLite (`provider_settings.api_key`) |
| Маскировка при GET | OK | `/api/settings/providers` маскирует ключи: `key[:8]...key[-4:]` (`routes.py:1396-1399`) |
| GitHub PAT | **HIGH** | Передается в subprocess env; `npx -y` скачивает пакет без версии |

### Injection Risks

| Тип | Статус | Детали |
|-----|--------|--------|
| SQL Injection | **SAFE** | Все запросы используют параметризованные `?` |
| Prompt Injection | **LOW RISK** | Пользовательский ввод передается в LLM-промпты напрямую, но это ожидаемое поведение для LLM UI. Calendar system prompt содержит internal event IDs -- утечка через prompt injection маловероятна, но возможна |
| XXE | **N/A** | XML не парсится |
| Path Traversal | **SAFE** | Файлы загружаются в tempfile с фиксированным suffix |
| XSS | **LOW RISK** | Frontend рендерит LLM-ответы как markdown; содержимое не санитизируется на бэкенде |

### File Handling Security

| Аспект | Статус | Детали |
|--------|--------|--------|
| Размер файла | OK | Лимит 20MB (`files.py:27`) |
| Расширения | OK | Whitelist из `SUPPORTED_EXTENSIONS` (`parser.py:10-15`) |
| Temp files | OK | Создаются через `tempfile.NamedTemporaryFile`, удаляются в `finally` |
| Image base64 | **LOW RISK** | Base64-encoded image хранится в памяти в `_file_cache` без ограничения на размер decoded data |

---

## Performance Notes

### Async correctness

- **aiosqlite**: Корректно используется async/await. Однако single connection (см. H1) -- потенциальное узкое место.
- **httpx.AsyncClient**: Создается заново при каждом LLM-вызове (`async with httpx.AsyncClient(timeout=120.0)` в `base.py:85, 110`). Это дорого -- создается новый TCP connection pool каждый раз. Рекомендуется переиспользовать client.
- **asyncio.gather**: Правильно используется для параллелизации (domain detection, branch scoring, expert opinions). `return_exceptions=True` корректно обрабатывается.
- **MCP subprocess**: Создается новый процесс `npx` при КАЖДОМ GitHub-запросе (`_github_event_stream`). Процесс закрывается после каждого чата. Это очень дорого (~2-5 секунд на spawn).

### Memory Concerns

- `_session_contexts`: до 1000 entries x ~1KB = ~1MB -- приемлемо
- `_file_cache`: до 50 entries x до 20MB = **до 1GB** -- критично
- `prefill_cache`: до 100 entries с draft_reasoning (до ~4KB каждый) = ~400KB -- приемлемо
- SSE event_stream: аккумулирует `full_content`, `all_thinking`, `thinking_buffer`, `content_buffer` -- всё в памяти, но ограничено одним ответом

### LLM Call Counts Per Strategy (auto mode)

| Стратегия | Classification | Strategy calls | Total |
|-----------|---------------|----------------|-------|
| none | 3 | 1 | **4** |
| cot | 3 | 1 | **4** |
| budget_forcing (3r) | 3 | 3 | **6** |
| best_of_n (3) | 3 | 3 + 1 vote | **7** |
| tree_of_thoughts (3x2) | 3 | 6 branches + 6 scores + 1 synthesis | **16** |
| persona_council | 3 | 4 experts + 1 moderator | **8** |
| socratic | 3 | 1 questions + 3 answers + 1 synthesis | **8** |
| rubber_duck | 3 | 1 draft + 1 review + 1 fix | **6** |
| calendar (bypass) | 0 | 1 | **1** |
| github (up to 6 rounds) | 0 | 1-6 | **1-6** |

---

## Recommendations

### R1. Добавить аутентификацию
Минимально -- Bearer token через env variable. Для production -- OAuth2 или session-based auth. Сменить дефолтный host на `127.0.0.1`.

### R2. Шифровать API-ключи в БД
Использовать симметричное шифрование (Fernet) с мастер-ключом из env. Альтернатива -- хранить ключи только в .env и не дублировать в БД.

### R3. Переиспользовать httpx.AsyncClient
Создать один `httpx.AsyncClient` на провайдера (или глобальный) и переиспользовать connection pool. Это значительно ускорит LLM-вызовы за счет keep-alive.

### R4. Объединить classification LLM-вызовы
Вместо 3 отдельных вызовов (ambiguity, complexity, domain) -- один вызов с инструкцией вернуть JSON `{"domain": "...", "complexity": N, "ambiguous": false}`. Экономия 2 LLM-вызова на каждое сообщение в auto mode.

### R5. Кешировать MCP subprocess
Вместо создания нового `npx` процесса при каждом GitHub-запросе -- держать persistent MCP client на уровне приложения (с graceful restart при ошибках).

### R6. Добавить TTL к in-memory кешам
Использовать `cachetools.TTLCache` для `_file_cache` (TTL ~30 min), `_session_contexts` (TTL ~2 hours), `prefill_cache` (уже есть timeout, но нет автоочистки expired entries).

### R7. Добавить Pydantic-модель для calendar confirm
Заменить `dict = Body(...)` на строго типизированную модель с validation для всех полей.

### R8. Добавить structured logging и метрики
Добавить request ID для трассировки. Логировать время и стоимость каждого LLM-вызова. Рассмотреть OpenTelemetry для production.

### R9. Добавить тесты
В проекте отсутствуют тесты (не обнаружено файлов `test_*.py` или `*_test.py`). Критически важно покрыть тестами:
- ReasoningEngine (unit tests для каждой стратегии)
- Database layer (integration tests)
- Calendar CRUD
- SSE streaming (end-to-end)

### R10. Закрепить версию MCP npm-пакета
Заменить `npx -y @modelcontextprotocol/server-github` на конкретную версию для предотвращения supply chain атак.
