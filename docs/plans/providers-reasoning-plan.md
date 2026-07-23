# План: новые провайдеры, reasoning, фреймворки

## Приоритеты

1. **P0** — быстрые победы (1-2 часа, чистый профит)
2. **P1** — новая функциональность (полдня-день)
3. **P2** — архитектурные улучшения (день+)

---

## P0: Быстрые победы

### P0.1: Включить reasoning_effort для OpenAI provider

**Файл:** `src/agent/providers/openai.ts:101-103`

**Проблема:** `reasoningEffort: undefined` явно зашит.
**Фикс:** Убрать оверайд. `openaiCompatTransport.buildBody()` уже умеет отправлять `reasoning_effort` — просто не занулять.

```diff
- opts: opts ? { ...opts, reasoningEffort: undefined } : opts,
+ opts,
```

**Риски:** `gpt-5` начнёт получать `reasoning_effort`. `openaiCompatTransport` мапит `"none"` → `"minimal"` — обратная совместимость есть.
**Тесты:** `tests/openai-provider.test.ts` — проверить, что `reasoningEffort` передаётся в body.
**Проверка:** `bun test tests/openai-provider.test.ts`

---

### P0.2: Добавить `reasoning` в `AgentResult`

**Файлы:** `src/agent/types.ts`, все транспорты, `loop.ts`

**Проблема:** Reasoning доступен только через `onReasoning` коллбэк. После стрима накопленный текст теряется для программных потребителей (логи, тесты, auto-eval).

**Фикс:**

```typescript
// types.ts
export interface AgentResult {
  text: string;
  toolCalls?: ToolCall[];
  reasoning?: string; // <-- добавить
}
```

В каждом транспорте накопить reasoning в локальной переменной, вернуть в результате:

- `transports/openaiCompat.ts:consumeSseStream` — уже есть `sawReasoning`, добавить `reasoningBuf += delta`
- `transports/anthropic.ts:consumeAnthropicSseStream` — аналогично
- `transports/openaiResponses.ts` — аналогично
- `transports/google.ts` — аналогично
- `providers/claude-cli.ts` — аналогично
- `providers/ollama.ts` — уже парсит, добавить в возврат

**Точек подключения:** 6 транспортов/провайдеров + 1 тип.

**Зачем:** Без этого поля автоматическая оценка качества reasoning невозможна. UI уже рендерит из `AgentEvent` — не сломается.

---

### P0.3: Cap `events` массива

**Файл:** `ui/reasoning.ts` (функция `reduceEvents`)

**Проблема:** `AgentEvent[]` растёт без контроля. `toLines()` режет на 200 строк вывода, но сам массив держит всё.

**Фикс:** В `reduceEvents` добавить лимит на длину (например, 500 событий), компактить старые reasoning-сегменты в одну строку по типу `[250 reasoning deltas omitted]`.

---

## P1: Новые провайдеры

### P1.1: `claude-direct` — Anthropic Messages API

**Новый файл:** `src/agent/providers/claude-direct.ts`
**Транспорт:** `transports/anthropic.ts` уже готов (переиспользуется)

**Что нужно сделать:**

1. **Класс `ClaudeDirectProvider`** — обёртка над `anthropicTransport`:
   - Энва: `CLAUDE_API_KEY`, `CLAUDE_API_URL` (дефолт `https://api.anthropic.com/v1`), `CLAUDE_MODEL` (дефолт `claude-sonnet-4-20250514`)
   - Auth: `x-api-key` + `anthropic-version: 2023-06-01`
   - 429-обработка: `retry-after` из header
   - Отличается от `opencode-zen/anthropic` только URL + заголовками

2. **`src/config.ts`** — добавить поля:
   - `claudeDirectApiKey: string`
   - `claudeDirectApiUrl: string`
   - `claudeDirectModel: string`
   - `FileConfig` + env mapping + saveConfig mirror в `process.env`

3. **`src/hooks/useProviders.ts`** — добавить case `"claude-direct"`

4. **`src/ui/ProviderList.tsx`** — добавить в список

5. **`src/ui/ModelPicker.tsx`** — добавить страницу конфига с `PROVIDER_CONFIGS`:
   - `claudeDirectApiKey` (secret)
   - `claudeDirectApiUrl` (text)
   - `claudeDirectModel` (text)

**Чем отличается от `claude-cli`:** нативные tool calls, нативное multi-turn (не flatten), reasoning через `thinking`.
**Чем отличается от `opencode-zen/anthropic`:** прямой API Anthropic (без opencode gateway), свой API key.

**Риски:** API key Anthropic. Нужно обновить AGENTS.md и README.md (правило трёх мест).

**Тесты:** `tests/provider-contract.test.ts` — добавить contract test.

---

### P1.2: `google-ai` — Google AI Studio / Gemini API

**Новый файл:** `src/agent/providers/google-ai.ts`
**Транспорт:** `transports/google.ts` уже готов

Аналогично P1.1, но с эндпоинтом `https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent`.

**Энва:** `GOOGLE_API_KEY`, `GOOGLE_MODEL` (дефолт `gemini-2.0-flash`)

**Точек подключения:** config + useProviders + ProviderList + ModelPicker — те же 5 файлов.

---

### P1.3: Generic `openai-compat` provider

**Идея:** Дать пользователю указать любую OpenAI-совместимую API без написания кода.

**Файл:** `src/agent/providers/openai.ts` уже поддерживает `baseUrl`. Этого достаточно — пользователь может в `/model` выставить `baseUrl` на `https://api.deepseek.com/v1` и `model` на `deepseek-chat`.

**Единственное что нужно:** В ModelPicker подсказать эту возможность (description field).

---

## P1: Оптимизации reasoning

### P1.4: Generic `reasoningEffort` в конфиг

**Проблема:** `claudeEffort` есть только для Claude CLI. Нет возможности выставить reasoning-effort для всех провайдеров в `/settings`.

**Фикс:**

1. **`src/config.ts`** — добавить `defaultReasoningEffort: "none" | "low" | "medium" | "high"` (дефолт `undefined` — поведение не меняется)
2. **`src/agent/loop.ts`** — при формировании `genOpts`, если у `effort` нет значения от шага (forced/rescue), использовать `config.defaultReasoningEffort`
3. **`src/ui/ModelPicker.tsx`** — добавить поле в конфиг-страницы (или на уровень провайдера)
4. **`src/hooks/useProviders.ts`** — не нужно, потому что effort идёт через loop.ts, а не через provider config

**Важно:** Не ломать логику loop.ts, где механические шаги (forced, rescue) принудительно ставят `"low"`.

### P1.5: configurable `REASONING_BUDGET_TOKENS`

**Проблема:** Хардкод 2048/6000/12000.

**Фикс:** Сделать `REASONING_BUDGET_TOKENS` функцией, которая принимает опциональные оверрайды от конфига. Добавить в `FileConfig`:
- `reasoningBudgetLow?: number` (default 2048)
- `reasoningBudgetMedium?: number` (default 6000)  
- `reasoningBudgetHigh?: number` (default 12000)

---

## P2: Архитектурные фреймворки

### P2.1: Rate limiter / retry middleware

**Сейчас:** retry есть только в `loop.ts` (transient errors) и `spotify/client.ts`. Каждый провайдер сам разбирает `Retry-After`.

**Предложение:** Сделать общий `withRetry` / `rateLimitedFetch` в `src/agent/providers/transports/`:

```typescript
// src/agent/providers/transports/retry.ts
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts?: { 
    maxRetries?: number;
    onRetry?: (attempt: number, delay: number) => void;
    signal?: AbortSignal;
  }
): Promise<Response>
```

Общий парсинг `Retry-After`, единый backoff (500, 1500, 3000...), jitter.

**Плюсы:** Убирает дублирование `parseRetryAfter()` (сейчас он в `opencode.ts` и `openai.ts`).

### P2.2: Circuit breaker для Spotify API

**Проблема:** 429-ответы от Spotify ведут к повторным запросам, которые тоже 429.

**Предложение:** Легковесный circuit breaker в `src/spotify/client.ts`:
- После N 429 подряд — разомкнуть цепь на T секунд
- Все запросы мгновенно фейлятся с `CircuitOpenError`
- После таймаута — полуоткрытое состояние, один пробный запрос

---

## Сводная карта файлов для P1 (новый провайдер)

Чтобы добавить одного нового провайдера, нужно тронуть ровно эти файлы:

| Шаг | Файл | Что изменить |
|------|------|-------------|
| 1 | `src/agent/providers/<name>.ts` | Класс провайдера |
| 2 | `src/config.ts` | Config + FileConfig + env mapping |
| 3 | `src/hooks/useProviders.ts` | case в switch |
| 4 | `src/ui/ProviderList.tsx` | Строка в mainOptions |
| 5 | `src/ui/ModelPicker.tsx` | Блок в PROVIDER_CONFIGS |
| 6 | `AGENTS.md` | Env vars |
| 7 | `README.md` | Config section |
| 8 | `tests/provider-contract.test.ts` | Contract test |

---

## Рекомендованный порядок имплементации

```
P0.1 ↓ (15 мин) → P0.2 ↓ (30 мин) → P0.3 (15 мин) →
P1.1 ↓ (2-4 ч) → P1.4/1.5 ↓ (1 ч) →
P1.2 (2-4 ч) → P2.1 (2 ч) → P2.2 (1 ч)
```

P0.1 даёт профит всем пользователям OpenAI сразу. P0.2 — основа для любого auto-eval. P1.1 — самый полезный новый провайдер (Claude Direct). P1.4 делает reasoning-effort доступным для всех провайдеров через UI.
