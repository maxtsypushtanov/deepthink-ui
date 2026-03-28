# DeepThink — Полный аудит платформы

> Дата: 2026-03-27 | Тесты: 59 passed, 10 skipped

---

## 1. Результаты тестирования

### Движок рассуждений (engine.py)
| Тест | Результат | Детали |
|------|-----------|--------|
| Эвристика: короткий вопрос → score 1 | PASS | |
| Эвристика: код → score 4 | PASS | |
| Keyword detection: ТРИЗ, сравни, эксперты, почему, докажи | PASS | |
| Keyword detection: "отладить" | **BUG** | Не матчит — нет формы инфинитива |
| Эвристика: средний вопрос (6 слов) | **BUG** | Score 1 вместо 2, порог < 15 слов завышен для русского |
| Эвристика: мультивопрос (3 вопроса) | **BUG** | Score 2 из-за ошибки в OR-условии |
| Классификация: простой → NONE | PASS | |
| Классификация: код + LLM → persona_council | PASS | |
| Классификация: TRIZ через hint | PASS | |
| Классификация: LLM failure → fallback | PASS | |
| Классификация: пустые сообщения | PASS | |
| Домен: корректный → возвращает | PASS | |
| Домен: невалидный → "general" | PASS | |
| Домен: LLM ошибка → "general" | PASS | |
| run(): AUTO → все типы событий | PASS | |
| run(): NONE → passthrough | PASS | |
| run(): COT → thinking_step + content | PASS | |
| run(): prefill пропускает классификацию | PASS | |
| run(): не мутирует входные messages | PASS | |
| SessionContext: рост detected_domains | PASS (BUG зафиксирован — unbounded) | |
| Амбигуация: короткое → не ambiguous | PASS | |
| Prefill cache: put/get/remove/eviction/LRU | 5/5 PASS | |
| compare_queries: все edge cases | 8/8 PASS | |
| Chunker: single/overlap/empty/whitespace | 5/5 PASS | |
| search_chunks: keyword match | PASS | |
| should_use_python: все паттерны | 5/5 PASS | |

---

## 2. Обнаруженные баги (подтверждены тестами)

### BUG-1: Порог word_count < 15 завышен для русского языка
**Файл:** `engine.py:1850`
**Проблема:** Русские предложения в среднем на 30-40% короче английских из-за флективности. Вопрос "Как работает фотосинтез у растений?" (6 слов) — нормальный средний вопрос, но получает score = 1 (тривиальный).
**Рекомендация:** Снизить порог до `< 8` или использовать символьную длину вместо количества слов.

### BUG-2: OR-условие в scoring сломано
**Файл:** `engine.py:1852`
```python
elif word_count <= 50 or question_marks == 1:
    score = 2
```
**Проблема:** `question_marks == 1` в OR означает: любой вопрос с 1 знаком вопроса = score 2. А `word_count <= 50` ловит вообще всё до 50 слов, включая мультивопросы с 3+ вопросительными знаками.
**Рекомендация:** Разделить условия:
```python
if question_marks >= 3 or word_count > 50:
    score = 3
elif word_count <= 50:
    score = 2
```

### BUG-3: Русская морфология не учтена в keywords
**Файл:** `engine.py:1808`
**Проблема:** Ключевое слово "отладь" (императив) не матчит "отладить" (инфинитив), "отладка" (существительное), "отладки" (родительный). Та же проблема с "сравни"/"сравнение".
**Рекомендация:** Использовать стемминг (pymorphy3) или regex-основы: `r"отлад"`, `r"сравн"`, `r"изобрет"`.

---

## 3. Критические проблемы архитектуры

### CRITICAL-1: run() не ловит исключения стратегий
**Файл:** `engine.py:739-773`
Если стратегия падает после первого yield, клиент получает оборванный stream без error-ивента. Нужен try/except вокруг каждого `async for`.

### CRITICAL-2: asyncio.gather() без таймаутов
**Файлы:** `engine.py` (строки 668, 680, 691, 979, 1080, 1267, 1681)
Все параллельные LLM-вызовы без timeout. Если провайдер завис — вся стратегия зависает навсегда.
**Рекомендация:** `asyncio.wait_for(asyncio.gather(...), timeout=60)`

### CRITICAL-3: Python sandbox обходится
**Файл:** `python_sandbox.py:76-99`
`exec()` с ограниченным `__builtins__` обходится через `[].__class__.__bases__[0].__subclasses__()`. Нельзя использовать для выполнения пользовательского кода без настоящего sandboxing (Docker/subprocess с rlimit).
**Рекомендация:** Выполнять код в изолированном subprocess с `resource.setrlimit()` или Docker-контейнере.

### CRITICAL-4: Prompt injection через format strings
**Файл:** `engine.py:1735` (persona_council moderator prompt)
```python
moderator_prompt = self.COUNCIL_MODERATOR_PROMPT.format(question=user_query, opinions=opinions_text)
```
Если user_query содержит `{` и `}` — format() крашится с KeyError.
**Рекомендация:** Использовать `Template.safe_substitute()` или f-string с escape.

---

## 4. Проблемы средней серьёзности

### MED-1: SessionContext — unbounded list growth
**Файл:** `engine.py:75` — `detected_domains.append()` без ограничения. После 1000 ходов — memory leak.
**Фикс:** `self.detected_domains = self.detected_domains[-20:]`

### MED-2: Нет rate limiting на /api/chat
**Файл:** `routes.py` — Любой клиент может спамить запросы.

### MED-3: Vote step без system prompt
**Файл:** `engine.py:1012-1018` — Best-of-N голосование идёт без контекста persona. LLM может не понять формат.

### MED-4: Budget forcing — temperature creep undocumented
**Файл:** `engine.py:911` — `temperature=0.3 + (round * 0.1)`. К 3-му раунду T=0.5. Менее детерминистичный ответ.

### MED-5: Crash mid-stream → orphaned messages
**Файл:** `routes.py:1352-1357` — Если engine падает, user message сохранён, но assistant message — нет. БД в inconsistent state.

### MED-6: Провайдеры — нет retry при HTTP 429
**Файл:** `providers/base.py` — Нет exponential backoff при rate limit.

### MED-7: Memory decay никогда не запланирован
**Файл:** `db/database.py:486` — `decay_memories()` вызывается только после разговора, нет фонового scheduler'а.

### MED-8: Чанкер O(n²) на whitespace-heavy текстах
**Файл:** `chunker.py:50` — `start = max(start + 1, ...)` при пустых чанках продвигается по 1 символу.

### MED-9: Calendar delete по substring
**Файл:** `routes.py:132-140` — "Удали standup" удалит первое событие содержащее "standup" в названии. Может удалить не то.

### MED-10: Single DB connection — bottleneck
**Файл:** `db/database.py:92-101` — Один глобальный коннект для всех async-операций.

---

## 5. Инновационные предложения по устойчивости и скорости

### I-1: Speculative Strategy Execution (спекулятивный запуск)
**Проблема:** Классификация сложности = 1 LLM-вызов (200-500ms) + 1 LLM-вызов на домен.
**Решение:** Пока классификатор думает, спекулятивно запускать CoT (самая частая стратегия для score 3). Если классификатор вернул COT — ответ уже готов. Если другую — отменить спекулятивный и запустить правильную.
**Выигрыш:** -300-500ms latency для ~40% запросов.

### I-2: Adaptive Temperature Scheduling
**Проблема:** Temperature жёстко задан в коде для каждой стратегии.
**Решение:** Трекать метрики качества (user regeneration rate, confidence score) и автоматически тюнить temperature per strategy per domain. Если пользователь часто regenerates budget_forcing → повысить или понизить temperature.
**Выигрыш:** Лучше качество ответов, меньше regeneration.

### I-3: Strategy Cache — кэширование по семантическому fingerprint
**Проблема:** Одинаковые вопросы проходят полный pipeline каждый раз.
**Решение:** Для стратегий none/cot — кэш по Jaccard similarity > 0.9 с TTL. Best-of-N/Tree-of-Thoughts не кэшировать (каждый раз разные ветки).
**Выигрыш:** Мгновенный ответ для повторяющихся вопросов.

### I-4: Streaming Budget Forcing — показывать прогресс
**Проблема:** Промежуточные раунды буферизуются, пользователь видит "пустоту" 10-30 секунд.
**Решение:** Стримить промежуточные раунды в thinking panel в реальном времени (не ждать окончания раунда).
**Выигрыш:** Felt performance improvement — пользователь видит что движок работает.

### I-5: Connection Pool для SQLite
**Проблема:** Один глобальный коннект = bottleneck при конкурентных запросах.
**Решение:** Использовать `aiosqlite` connection pool (3-5 connections) или переход на `databases` пакет с async pool.
**Выигрыш:** Параллельные SQL-запросы не блокируют друг друга.

### I-6: Graceful Degradation Pipeline
**Проблема:** Если LLM-провайдер упал — всё сломалось.
**Решение:** Каскадный fallback: если основной провайдер 429/500 → retry 1x с backoff → fallback на более дешёвую модель → если все провайдеры down → вернуть кэшированный ответ или "извините, сервис недоступен" с ETA.
**Выигрыш:** Платформа работает даже при partial outage провайдера.

### I-7: Batch Classification — один LLM-вызов вместо трёх
**Проблема:** AUTO = 3 параллельных LLM-вызова (domain + complexity + ambiguity). Это 3× API cost.
**Решение:** Один промпт который возвращает `{"domain": "...", "complexity": 4, "ambiguous": false, "strategy": "..."}`. Structured JSON output вместо 3 отдельных вызовов.
**Выигрыш:** 3x меньше API-вызовов для классификации. Быстрее. Дешевле.

### I-8: Process-level Python Sandbox
**Проблема:** exec()-based sandbox легко обходится.
**Решение:** Выполнять код в `subprocess.Popen()` с `resource.setrlimit(RLIMIT_AS, 256MB)`, `RLIMIT_CPU, 15s`, `RLIMIT_NOFILE, 0` (запрет файлов). Плюс `seccomp` фильтр на Linux.
**Выигрыш:** Реальная изоляция, не обходится через __subclasses__.

### I-9: Stem-based Keyword Matching для русского
**Проблема:** Keyword matching по точному совпадению промахивается по русским формам слов.
**Решение:** Вместо `"отладь" in msg` → использовать stems: `r"отлад|дебаг|debug"` через regex. Один regex на стратегию вместо цикла по ключевым словам.
**Выигрыш:** Точнее keyword detection, ~5% больше правильно выбранных стратегий.

### I-10: Event-Driven Memory Decay
**Проблема:** Decay вызывается вручную после разговора. Нет фонового scheduler'а.
**Решение:** `asyncio.create_task` при старте приложения — background loop каждые 6 часов вызывает `decay_memories()`. Или SQLite trigger на INSERT в messages.
**Выигрыш:** Память не растёт бесконтрольно.

---

## 6. Приоритетный план действий

| Приоритет | Действие | Сложность | Влияние |
|-----------|---------|-----------|---------|
| P0 | Обернуть стратегии в try/except + yield error event | 15 min | Устраняет зависание клиента |
| P0 | Добавить asyncio timeout на все gather() | 30 min | Устраняет каскадные зависания |
| P0 | Исправить format string injection в persona_council | 10 min | Устраняет crash |
| P1 | Batch Classification (I-7) | 2 hr | 3x меньше API-вызовов |
| P1 | Исправить heuristic scoring (BUG-1, BUG-2) | 30 min | Точнее выбор стратегии |
| P1 | Regex stems для keywords (I-9) | 1 hr | Точнее keyword detection |
| P1 | Graceful Degradation (I-6) | 3 hr | Устойчивость к outage |
| P2 | Process sandbox (I-8) | 4 hr | Безопасность |
| P2 | Streaming budget forcing (I-4) | 2 hr | UX при долгих стратегиях |
| P2 | Speculative execution (I-1) | 4 hr | -300ms latency |
| P3 | Connection pool (I-5) | 2 hr | Масштабируемость |
| P3 | Event-driven decay (I-10) | 1 hr | Стабильность памяти |
