# Agent Latency & Reasoning-Token Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut reasoning-token spend and latency in the music-agent loop by capping response tokens, mapping reasoning effort per turn-type, retrying on real signals instead of blind backoff, trimming duplicated prompt text, and making tool-call failures self-correcting — without changing loop semantics (dedup, bounce, stall, budget, rescue) or regressing curation quality.

**Architecture:** All changes are additive to `GenerateOptions` (`src/agent/types.ts`) and are consumed per-family inside `OpencodeProvider`/`OpenAIProvider`. `runAgentLoop` (`src/agent/loop.ts`) decides *when* to set `reasoningEffort`/`maxTokens` based on turn type (research vs. mechanical); it does not know about provider families. `ollama.ts` and `claude-cli.ts` are untouched — no cost pressure on a local/subscription backend.

**Tech Stack:** Bun, TypeScript, `bun test`. No new dependencies.

## Global Constraints

- Bun only — `bun test`, no vitest/jest. `bun run typecheck` (or repo's typecheck script) must pass after every task.
- No behavior change to loop semantics (dedup, bounce, stall, budget, rescue ladder) except the two explicitly-scoped fixes in Task 2 (malformed-finalize now bounces).
- `ollama.ts` and `claude-cli.ts` are out of scope for every task in this plan.
- Every new/changed provider field is optional on `GenerateOptions`; omitting it must reproduce today's exact request body (verified by existing tests staying green).
- Commit after each task passes `bun test` + typecheck.

---

## Verified against current code (2026-07-09)

Read in full before drafting: `src/agent/types.ts`, `src/agent/loop.ts`, `src/agent/tools.ts`, `src/agent/providers/opencode.ts`, `src/agent/providers/openai.ts`, `src/agent/providers/ollama.ts`, `src/agent/providers/claude-cli.ts`, `src/core/taste.ts`, `src/agent/skills.ts`, `src/agent/skills/*.md`, `src/app.tsx:934-955`, and every test file under `tests/`.

Two corrections to the original draft:

1. **Taste summarization is not routed through `generateText`.** `src/app.tsx:947` calls `provider.generate(ROTATE_SYSTEM, raw)` directly. There is no need to touch `generateText` in `types.ts` — Task 3 passes `opts` straight into that call site.
2. **`tests/provider-contract.test.ts` is the wrong file for `generateMessages` coverage.** It's a `describe.each` contract suite for `MusicProvider` (Spotify/SoundCloud/YTMusic), unrelated to `AgentProvider`. Task 5's fake-provider test goes in `tests/agent-loop.test.ts` instead, next to the existing loop tests it depends on (`fakeMusic`, `scriptedProvider`).

All other file:line references below were re-verified against the current tree and are accurate as of this commit.

---

## Task 1: Provider hardening — `max_tokens` on every path + header-aware retry (A1 + A3)

**Files:**
- Modify: `src/agent/types.ts` — add `maxTokens?: number` to `GenerateOptions`; add exported `ProviderErrorInfo` interface.
- Modify: `src/agent/providers/opencode.ts:71-97` (`requestFailed`), `:153-232` (`request`) — export `parseRetryAfter`; add per-family max-token field; attach `status`/`retryAfterMs` to thrown errors.
- Modify: `src/agent/providers/openai.ts:72-109` (`generate`) — add `max_completion_tokens`; replace the bare `throw new Error` with an instructive error carrying `status`/`retryAfterMs`.
- Modify: `src/agent/loop.ts:95-140` (`TRANSIENT_ERROR_RE`, `generateWithRetry`) — status-aware + `Retry-After`-aware retry; never retry context-overflow 400s.
- Test: `tests/opencode-provider.test.ts` — new `describe` blocks for max-tokens and Retry-After.
- Test: `tests/openai-provider.test.ts` (new file — `OpenAIProvider` currently has zero test coverage).
- Test: `tests/agent-loop.test.ts:563-612` (`runAgentLoop retry + backoff`) — two new tests.

**Interfaces:**
- Produces: `GenerateOptions.maxTokens?: number` (consumed by every provider path this task touches).
- Produces: `ProviderErrorInfo { status?: number; retryAfterMs?: number }`, exported from `types.ts`, used to duck-type thrown errors in `loop.ts`.
- Produces: `parseRetryAfter(header: string | null): number | undefined`, exported from `opencode.ts`, imported by `openai.ts`.

- [ ] **Step 1: Add `maxTokens` and `ProviderErrorInfo` to `types.ts`**

```ts
// src/agent/types.ts — inside GenerateOptions, after toolChoice:
  /** Cap on response tokens. Providers map this to their family's field name
   * (max_tokens / max_output_tokens / max_completion_tokens / generationConfig.maxOutputTokens).
   * Falls back to a provider-local default (4096) when unset. */
  maxTokens?: number;
  /** Hint for how much the model should "think" before answering. Providers
   * without a native knob ignore it. Mechanical turns (rescue, hard-demand,
   * bounced retries, forced first-turn clarify) use "low"; research turns
   * leave this undefined so curation quality doesn't regress. */
  reasoningEffort?: "none" | "low" | "medium" | "high";
```

```ts
// src/agent/types.ts — new export, after GenerateOptions:
/** Optional metadata a provider attaches to a thrown Error so loop.ts's
 * retry policy can act on real signals instead of message-sniffing alone. */
export interface ProviderErrorInfo {
  status?: number;
  retryAfterMs?: number;
}
```

(`reasoningEffort` is added here too, ahead of Task 3, since both fields land on the same interface in one edit — Task 3 only adds the call sites that *set* it.)

- [ ] **Step 2: Write the failing provider tests**

Append to `tests/opencode-provider.test.ts`:

```ts
describe("OpencodeProvider max output tokens", () => {
  test("anthropic: body.max_tokens defaults to 4096, honors opts.maxTokens", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } }), JSON.stringify({ type: "message_stop" })]));
    const provider = new OpencodeProvider({ name: "opencode-zen", apiKey: "k", baseUrl: "https://opencode.ai/zen/v1", model: "claude-sonnet-5" });
    await provider.generate("sys", "hi");
    expect(calls[0]!.body.max_tokens).toBe(4096);
    respond(sseResponse([JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } }), JSON.stringify({ type: "message_stop" })]));
    await provider.generate("sys", "hi", undefined, undefined, { maxTokens: 2048 });
    expect(calls[1]!.body.max_tokens).toBe(2048);
  });

  test("openai-responses: body.max_output_tokens set from opts.maxTokens", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ type: "response.output_text.delta", delta: "hi" })]));
    const provider = new OpencodeProvider({ name: "opencode-zen", apiKey: "k", baseUrl: "https://opencode.ai/zen/v1", model: "gpt-5.5" });
    await provider.generate("sys", "hi", undefined, undefined, { maxTokens: 1024 });
    expect(calls[0]!.body.max_output_tokens).toBe(1024);
  });

  test("openai-compat: body.max_completion_tokens set from opts.maxTokens", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" } }] }), "[DONE]"]));
    const provider = new OpencodeProvider({ name: "opencode-go", apiKey: "k", baseUrl: "https://opencode.ai/zen/go/v1", model: "glm-5.2" });
    await provider.generate("sys", "hi", undefined, undefined, { maxTokens: 1024 });
    expect(calls[0]!.body.max_completion_tokens).toBe(1024);
  });

  test("google: body.generationConfig.maxOutputTokens set from opts.maxTokens", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ candidates: [{ content: { parts: [{ text: "hi" }] } }] })]));
    const provider = new OpencodeProvider({ name: "opencode-zen", apiKey: "k", baseUrl: "https://opencode.ai/zen/v1", model: "gemini-2.5-pro" });
    await provider.generate("sys", "hi", undefined, undefined, { maxTokens: 1024 });
    expect(calls[0]!.body.generationConfig.maxOutputTokens).toBe(1024);
  });
});

describe("OpencodeProvider Retry-After / status propagation", () => {
  test("429 response attaches status and retryAfterMs (numeric seconds) to the thrown error", async () => {
    const { respond } = mockFetch();
    respond(new Response("rate limited", { status: 429, headers: { "retry-after": "2" } }));
    const provider = new OpencodeProvider({ name: "opencode-go", apiKey: "k", baseUrl: "https://opencode.ai/zen/go/v1", model: "glm-5.2" });
    let caught: (Error & { status?: number; retryAfterMs?: number }) | undefined;
    try {
      await provider.generate("sys", "hi");
    } catch (e) {
      caught = e as Error & { status?: number; retryAfterMs?: number };
    }
    expect(caught?.status).toBe(429);
    expect(caught?.retryAfterMs).toBe(2000);
  });

  test("missing Retry-After header leaves retryAfterMs undefined", async () => {
    const { respond } = mockFetch();
    respond(new Response("server error", { status: 500 }));
    const provider = new OpencodeProvider({ name: "opencode-go", apiKey: "k", baseUrl: "https://opencode.ai/zen/go/v1", model: "glm-5.2" });
    let caught: (Error & { status?: number; retryAfterMs?: number }) | undefined;
    try {
      await provider.generate("sys", "hi");
    } catch (e) {
      caught = e as Error & { status?: number; retryAfterMs?: number };
    }
    expect(caught?.status).toBe(500);
    expect(caught?.retryAfterMs).toBeUndefined();
  });
});
```

Create `tests/openai-provider.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { OpenAIProvider } from "../src/agent/providers/openai";
import { MUSIC_AGENT_TOOLS } from "../src/agent/tools";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function sseResponse(events: string[]): Response {
  const body = events.map((e) => `data: ${e}\n\n`).join("");
  return new Response(body, { status: 200 });
}

function mockFetch(): { calls: { url: string; body: any }[]; respond: (res: Response) => void } {
  const calls: { url: string; body: any }[] = [];
  let response: Response = new Response("", { status: 200 });
  globalThis.fetch = (async (input: any, init: any) => {
    calls.push({ url: String(input), body: JSON.parse(init.body) });
    return response;
  }) as typeof fetch;
  return { calls, respond: (res: Response) => { response = res; } };
}

describe("OpenAIProvider", () => {
  test("hits {baseUrl}/chat/completions with system+user messages", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" } }] }), "[DONE]"]));
    const provider = new OpenAIProvider({ authMode: "api", apiKey: "sk-test", subsToken: "", baseUrl: "https://api.openai.com/v1", model: "gpt-5" });
    const result = await provider.generate("sys", "hello");
    expect(result.text).toBe("hi");
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0]!.body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
    ]);
  });

  test("body.max_completion_tokens defaults to 4096 and honors opts.maxTokens", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" } }] }), "[DONE]"]));
    const provider = new OpenAIProvider({ authMode: "api", apiKey: "sk-test", subsToken: "", baseUrl: "https://api.openai.com/v1", model: "gpt-5" });
    await provider.generate("sys", "hi");
    expect(calls[0]!.body.max_completion_tokens).toBe(4096);
    respond(sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" } }] }), "[DONE]"]));
    await provider.generate("sys", "hi", undefined, undefined, { maxTokens: 1024 });
    expect(calls[1]!.body.max_completion_tokens).toBe(1024);
  });

  test("tools payload uses the OpenAI Chat Completions function shape", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" } }] }), "[DONE]"]));
    const provider = new OpenAIProvider({ authMode: "api", apiKey: "sk-test", subsToken: "", baseUrl: "https://api.openai.com/v1", model: "gpt-5" });
    await provider.generate("sys", "hi", undefined, undefined, { tools: MUSIC_AGENT_TOOLS });
    const body = calls[0]!.body as any;
    expect(body.tools[0].type).toBe("function");
    expect(body.tool_choice).toBe("auto");
  });

  test("non-2xx response throws an Error carrying .status and .retryAfterMs", async () => {
    const { respond } = mockFetch();
    respond(new Response("rate limited", { status: 429, headers: { "retry-after": "3" } }));
    const provider = new OpenAIProvider({ authMode: "api", apiKey: "sk-test", subsToken: "", baseUrl: "https://api.openai.com/v1", model: "gpt-5" });
    let caught: (Error & { status?: number; retryAfterMs?: number }) | undefined;
    try {
      await provider.generate("sys", "hi");
    } catch (e) {
      caught = e as Error & { status?: number; retryAfterMs?: number };
    }
    expect(caught?.status).toBe(429);
    expect(caught?.retryAfterMs).toBe(3000);
    expect(caught?.message).toContain("429");
  });

  test("subs auth mode sends the subscription bearer token", async () => {
    let seenAuth = "";
    globalThis.fetch = (async (_input: any, init: any) => {
      seenAuth = init.headers.authorization;
      return sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" } }] }), "[DONE]"]);
    }) as typeof fetch;
    const provider = new OpenAIProvider({ authMode: "subs", apiKey: "", subsToken: "subs-token", baseUrl: "https://api.openai.com/v1", model: "gpt-5" });
    await provider.generate("sys", "hi");
    expect(seenAuth).toBe("Bearer subs-token");
  });
});
```

Append to `tests/agent-loop.test.ts`, inside `describe("runAgentLoop retry + backoff", ...)` (after the existing three tests, before its closing `});` at line 612):

```ts
  test("429 with retryAfterMs from a Retry-After header uses that delay, not the default schedule", async () => {
    let attempts = 0;
    const provider: AgentProvider = {
      name: "flaky",
      generate: async () => {
        if (attempts++ === 0) {
          const err = new Error("rate limited") as Error & { status?: number; retryAfterMs?: number };
          err.status = 429;
          err.retryAfterMs = 10;
          throw err;
        }
        return finalizeResult;
      },
    };
    const start = Date.now();
    const r = await runAgentLoop(provider, "sys", "user", { deps: { music: fakeMusic() } });
    expect(r.playlist.name).toBe("X");
    expect(attempts).toBe(2);
    expect(Date.now() - start).toBeLessThan(400);
  });

  test("400 'prompt is too long' is never retried even though attempts remain", async () => {
    let attempts = 0;
    const provider: AgentProvider = {
      name: "overflow",
      generate: async () => {
        attempts++;
        const err = new Error("upstream 400: prompt is too long for this model") as Error & { status?: number };
        err.status = 400;
        throw err;
      },
    };
    await expect(
      runAgentLoop(provider, "sys", "user", { deps: { music: fakeMusic() } }),
    ).rejects.toThrow(/prompt is too long/);
    expect(attempts).toBe(1);
  });
```

- [ ] **Step 2b: Run the new tests to verify they fail**

Run: `bun test tests/opencode-provider.test.ts tests/openai-provider.test.ts tests/agent-loop.test.ts`
Expected: FAIL — `max_tokens`/`max_completion_tokens`/`generationConfig` undefined, `retryAfterMs` undefined, retryAfterMs test times out or waits ~500ms, context-overflow test sees `attempts > 1`.

- [ ] **Step 3: Implement `parseRetryAfter` + `requestFailed` + max-tokens in `opencode.ts`**

```ts
// src/agent/providers/opencode.ts — after the imports, before OpencodeProviderConfig:
/** Provider-local default response cap when the caller doesn't set opts.maxTokens. */
const DEFAULT_MAX_TOKENS = 4096;

/** Parses a `Retry-After` header (seconds, or an HTTP-date) into a millisecond
 * delay. Returns undefined when the header is absent or unparsable. */
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const at = Date.parse(header);
  if (!Number.isNaN(at)) {
    const ms = at - Date.now();
    return ms > 0 ? ms : 0;
  }
  return undefined;
}
```

Replace `requestFailed` (current lines 71-97):

```ts
  /** Turns a failed HTTP response into an actionable Error, with extra detail on 401/403. */
  private async requestFailed(res: Response): Promise<Error> {
    const body = (await res.text()).slice(0, 500);
    const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
    const fail = (message: string): Error => {
      const err = new Error(message) as Error & ProviderErrorInfo;
      err.status = res.status;
      if (retryAfterMs !== undefined) err.retryAfterMs = retryAfterMs;
      return err;
    };
    if (res.status === 401 || res.status === 403) {
      const fp = this.apiKey
        ? `len=${this.apiKey.length} …${this.apiKey.slice(-4)}`
        : "empty";
      const envVar = this.name === "opencode-go" ? "OPENCODE_GO_API_KEY" : "OPENCODE_ZEN_API_KEY";
      const goHint =
        this.name === "opencode-go"
          ? " Note: opencode-go and opencode-zen may require separate keys even " +
            "though both are managed from the same console — a key that works " +
            "for Zen can still 401 on Go (see opencode/opencode#17541). Verify " +
            "this key was issued specifically for the Go subscription."
          : "";
      return fail(
        `opencode ${this.name}: API key rejected (HTTP ${res.status}). ` +
          `Key [${fp}] was refused — verify it is a valid, active ${this.name} key and that no ` +
          `stale ${envVar} env var is overriding your configured key.${goHint} Server said: ${body}`,
      );
    }
    return fail(`opencode ${this.name} request failed: ${res.status} ${body}`);
  }
```

Add the import at the top of the file:

```ts
import type { AgentProvider, AgentResult, GenerateOptions, ProviderErrorInfo, ToolCall } from "../types";
```

In `request()` (current lines 153-232), add a max-tokens field to each family's body. Anthropic:

```ts
          body: JSON.stringify({
            model: this.model,
            max_tokens: opts?.maxTokens ?? DEFAULT_MAX_TOKENS,
            system,
```

openai-responses:

```ts
          body: JSON.stringify({
            model: this.model,
            instructions: system,
            input: user,
            stream: true,
            max_output_tokens: opts?.maxTokens ?? DEFAULT_MAX_TOKENS,
```

google — add a `generationConfig` field to the body:

```ts
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: user }] }],
            systemInstruction: { parts: [{ text: system }] },
            generationConfig: { maxOutputTokens: opts?.maxTokens ?? DEFAULT_MAX_TOKENS },
            ...(tools ? { tools } : {}),
            ...(choice ?? {}),
          }),
```

openai-compat (default):

```ts
          body: JSON.stringify({
            model: this.model,
            stream: true,
            max_completion_tokens: opts?.maxTokens ?? DEFAULT_MAX_TOKENS,
            messages: [
```

- [ ] **Step 4: Implement `max_completion_tokens` + instructive error in `openai.ts`**

```ts
// src/agent/providers/openai.ts — update the import line:
import type { AgentProvider, AgentResult, GenerateOptions, ProviderErrorInfo } from "../types";
import { consumeSseStream, parseRetryAfter } from "./opencode";
import { toolChoiceForFamily, toolsForOpenAIChat } from "../tools";

const DEFAULT_MAX_TOKENS = 4096;
```

In `generate()`, add the field to the body and replace the failure branch:

```ts
      body: JSON.stringify({
        model: this.model,
        stream: true,
        max_completion_tokens: opts?.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        ...(toolsPayload ? { tools: toolsPayload, tool_choice: "auto" } : {}),
        ...(toolsPayload && opts?.toolChoice
          ? toolChoiceForFamily("openai-compat", opts.toolChoice.name)
          : {}),
      }),
    });
    if (!res.ok || !res.body) {
      const body = (await res.text()).slice(0, 500);
      const err = new Error(`openai request failed: ${res.status} ${body}`) as Error & ProviderErrorInfo;
      err.status = res.status;
      const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
      if (retryAfterMs !== undefined) err.retryAfterMs = retryAfterMs;
      throw err;
    }
```

- [ ] **Step 5: Implement status/Retry-After-aware retry in `loop.ts`**

Replace the retry constants and `generateWithRetry` (current lines 95-140):

```ts
/** Provider errors worth retrying via message-sniffing, for providers that
 * don't attach ProviderErrorInfo (ollama, claude-cli, raw network failures). */
const TRANSIENT_ERROR_RE = /\b(429|5\d\d)\b|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed/i;
/** Context-overflow errors are never retryable — a bigger prompt won't fit
 * next attempt either, so retrying just burns the budget on the same 400. */
const CONTEXT_OVERFLOW_RE = /context|too long|maximum.{0,20}tokens|prompt is too long/i;
/** Backoff schedule between generate retries (a little jitter is added) when
 * the provider didn't supply a Retry-After hint. */
const RETRY_DELAYS_MS = [500, 1500];
/** Upper bound on any single retry delay, including a provider's Retry-After. */
const MAX_RETRY_DELAY_MS = 30_000;

function isTransientError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  if (CONTEXT_OVERFLOW_RE.test(msg)) return false;
  const status = (e as ProviderErrorInfo | undefined)?.status;
  if (typeof status === "number") return status === 429 || status >= 500;
  return TRANSIENT_ERROR_RE.test(msg);
}
```

```ts
/**
 * provider.generate with retry+backoff on transient errors (429/5xx/network),
 * so one rate-limit blip doesn't kill an otherwise healthy run. Honors a
 * provider-supplied Retry-After delay when present; abort, non-transient, and
 * context-overflow errors rethrow immediately.
 */
async function generateWithRetry(
  provider: AgentProvider,
  system: string,
  user: string,
  onToken: ((delta: string) => void) | undefined,
  signal: AbortSignal | undefined,
  genOpts: Parameters<AgentProvider["generate"]>[4],
): Promise<AgentResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await provider.generate(system, user, onToken, signal, genOpts);
    } catch (e) {
      if (signal?.aborted || attempt >= RETRY_DELAYS_MS.length || !isTransientError(e)) {
        throw e;
      }
      const retryAfterMs = (e as ProviderErrorInfo | undefined)?.retryAfterMs;
      const delay =
        typeof retryAfterMs === "number"
          ? Math.min(retryAfterMs, MAX_RETRY_DELAY_MS)
          : RETRY_DELAYS_MS[attempt]! + Math.random() * 250;
      await sleep(delay, signal);
    }
  }
}
```

Add `ProviderErrorInfo` to the type import at the top of `loop.ts`:

```ts
import type { AgentEvent, AgentProvider, AgentResult, ProviderErrorInfo, ToolCall } from "./types";
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/opencode-provider.test.ts tests/openai-provider.test.ts tests/agent-loop.test.ts`
Expected: PASS, all tests including the three pre-existing retry tests (unchanged behavior for status-less errors).

- [ ] **Step 7: Typecheck and commit**

Run: repo's typecheck command (e.g. `bun run typecheck` or `bunx tsc --noEmit`).

```bash
git add src/agent/types.ts src/agent/providers/opencode.ts src/agent/providers/openai.ts src/agent/loop.ts tests/opencode-provider.test.ts tests/openai-provider.test.ts tests/agent-loop.test.ts
git commit -m "feat(agent): cap response tokens per family, retry on status/Retry-After"
```

---

## Task 2: Instructive tool errors + tool-name repair (A5)

**Files:**
- Modify: `src/agent/tools.ts:187-251` (`dispatchTool`) — name repair, richer validation messages, prose unknown-tool listing.
- Modify: `src/agent/loop.ts:374-398` (finalize handling) — malformed `finalize_playlist` args bounce instead of killing the run.
- Test: `tests/agent-tools.test.ts` — name repair, unknown-tool prose, validation prose.
- Test: `tests/agent-loop.test.ts:255-262` — replace the single "errors" test with two tests (bounces with budget; throws when out of budget).

**Design note (scoped deviation from the original draft):** the draft called for a "corrective note" surfaced to the model on a repaired name. `dispatchTool` returns `Promise<unknown>` — the raw tool result, no side channel — and `clarify`/`searchArtist` results are plain strings or `null`, so there's nowhere to attach a note without changing that return type and touching `loop.ts`'s `Outcome` typing for every call site. Repair is **silent**: a mis-cased or underscore-swapped name (`"Clarify"`, `"search_track"`) dispatches transparently against the correct tool. Only a name with **no** match throws the instructive prose. This keeps the fix to one file and one return type; flag if you want the note channel added later.

**Interfaces:**
- Produces: `dispatchTool` still `(name, args, deps, signal?) => Promise<unknown>` — unchanged signature, repaired internally.
- Consumes (loop.ts): `playlistFromFinalizeArgs(args): PlaylistRec` (`src/agent/loop.ts:58-76`) — now called inside a `try` instead of unguarded.

- [ ] **Step 1: Write the failing tests**

Append to `tests/agent-tools.test.ts`, inside `describe("dispatchTool", ...)`:

```ts
  test("tool name repair: case/underscore mismatch dispatches against the correct tool", async () => {
    const r = await dispatchTool("Search_Track", { artist: "A", title: "B" }, { music: fakeMusic() });
    expect(r).toEqual({ uri: "spotify:track:t1", title: "Title", artist: "Artist", album: "Album" });
  });

  test("tool name repair: 'FINALIZE_PLAYLIST' resolves to finalize_playlist for the unknown-tool check but is never dispatched by dispatchTool directly (loop captures it)", async () => {
    // dispatchTool itself has no special-case for finalize_playlist; verify the
    // repair at least recognizes it as a known name (no "unknown tool" throw)
    // by using a tool with the same casing bug that IS dispatched: clarify.
    const r = await dispatchTool(
      "CLARIFY",
      { question: "Q?", options: ["a", "b", "c"] },
      { music: fakeMusic(), onClarify: async (_q, opts) => opts[0]! },
    );
    expect(r).toBe("a");
  });

  test("unknown tool with no plausible match throws prose listing available tools", async () => {
    await expect(dispatchTool("bogus_tool", {}, { music: fakeMusic() })).rejects.toThrow(
      /unknown tool: "bogus_tool"\. Available tools: searchTrack, searchArtist, getArtistTopTracks, web_search, clarify, finalize_playlist\./,
    );
  });

  test("clarify validation error includes the received args", async () => {
    await expect(
      dispatchTool("clarify", { question: "", options: [] }, { music: fakeMusic(), onClarify: async () => "x" }),
    ).rejects.toThrow(/Received: question=""/);
  });

  test("web_search validation error includes the received args", async () => {
    await expect(
      dispatchTool("web_search", { query: "   " }, { music: fakeMusic(), webSearch: async () => [] }),
    ).rejects.toThrow(/Received: query="   "/);
  });
```

Replace the single test at `tests/agent-loop.test.ts:255-262`:

```ts
  test("malformed finalize_playlist args bounce back to the model when budget remains", async () => {
    const userPrompts: string[] = [];
    let call = 0;
    const provider: AgentProvider = {
      name: "capture",
      generate: async (_system, user) => {
        userPrompts.push(user);
        call++;
        if (call === 1) {
          return { text: "", toolCalls: [{ id: "c1", name: "finalize_playlist", args: { name: "X", tracks: [], artists: [] } }] };
        }
        return {
          text: "",
          toolCalls: [{ id: "c2", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] } }],
        };
      },
    };
    const r = await runAgentLoop(provider, "sys", "user", { deps: { music: fakeMusic() }, maxIterations: 4 });
    expect(r.playlist.name).toBe("X");
    expect(r.playlist.tracks).toEqual([{ artist: "A", title: "B" }]);
    expect(userPrompts[1]).toContain("finalize_playlist rejected");
    expect(userPrompts[1]).toContain("missing 'name' or non-empty 'tracks'");
  });

  test("malformed finalize_playlist args throw once budget is exhausted", async () => {
    const { provider } = scriptedProvider([
      { text: "", toolCalls: [{ id: "c1", name: "finalize_playlist", args: { name: "X", tracks: [], artists: [] } }] },
    ]);
    await expect(
      runAgentLoop(provider, "sys", "user", { deps: { music: fakeMusic() }, maxIterations: 1 }),
    ).rejects.toThrow(/missing 'name' or non-empty 'tracks'/);
  });
```

- [ ] **Step 1b: Run tests to verify they fail**

Run: `bun test tests/agent-tools.test.ts tests/agent-loop.test.ts`
Expected: FAIL — repair tests throw `unknown tool: Search_Track` (no prose), validation tests don't match `Received:`, bounce test currently throws instead of returning a playlist.

- [ ] **Step 2: Implement name repair + instructive errors in `tools.ts`**

Add before `dispatchTool` (after `normalizeToolArgs`):

```ts
/**
 * Repairs a mis-cased or underscore/hyphen-swapped tool name against the
 * known spec list (e.g. "Search_Track" → "searchTrack"). Exact matches pass
 * through untouched. No match returns the name unchanged — the caller's
 * unknown-tool branch handles that case with an instructive error.
 */
function repairToolName(name: string, specs: ToolSpec[]): string {
  if (specs.some((s) => s.name === name)) return name;
  const normalize = (s: string) => s.toLowerCase().replace(/[_\-\s]/g, "");
  const match = specs.find((s) => normalize(s.name) === normalize(name));
  return match ? match.name : name;
}
```

Replace the top of `dispatchTool` and the validation throws + `default` branch:

```ts
export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  deps: ToolDispatcherDeps,
  signal?: AbortSignal,
): Promise<unknown> {
  name = repairToolName(name, MUSIC_AGENT_TOOLS);
  args = normalizeToolArgs(args);
  deps.onToolStart?.(name, args);
  signal?.throwIfAborted();
  let result: unknown;
  switch (name) {
    case "searchTrack": {
      const artist = String(args.artist ?? "");
      const title = String(args.title ?? "");
      result = trackToResult(await deps.music.searchTrack(artist, title));
      break;
    }
    case "searchArtist": {
      const n = String(args.name ?? "");
      result = await deps.music.searchArtist(n);
      break;
    }
    case "getArtistTopTracks": {
      const id = String(args.artistId ?? "");
      const limit = typeof args.limit === "number" ? args.limit : 5;
      result = (await deps.music.getArtistTopTracks(id, limit)).map(trackToResult);
      break;
    }
    case "web_search": {
      const query = String(args.query ?? "").trim();
      if (query.length === 0) {
        throw new Error(
          `web_search requires a non-empty "query" string. Received: query=${JSON.stringify(args.query)}.`,
        );
      }
      result = await (deps.webSearch ?? duckDuckGoSearch)(query, signal);
      break;
    }
    case "clarify": {
      if (!deps.onClarify) {
        throw new Error("clarify tool invoked but no UI hook is wired");
      }
      const question = String(args.question ?? "");
      // Some models double-encode the options array as a JSON string.
      let rawOptions: unknown = args.options;
      if (typeof rawOptions === "string") {
        try {
          rawOptions = JSON.parse(rawOptions);
        } catch {
          /* fall through to validation below */
        }
      }
      const options = Array.isArray(rawOptions) ? rawOptions.map(String).slice(0, 3) : [];
      if (question.length === 0 || options.length === 0) {
        throw new Error(
          `clarify requires non-empty "question" and exactly 3 "options" strings. ` +
            `Received: question=${JSON.stringify(args.question)}, options=${JSON.stringify(args.options)}.`,
        );
      }
      result = await deps.onClarify(question, options);
      break;
    }
    default: {
      const names = MUSIC_AGENT_TOOLS.map((s) => s.name).join(", ");
      throw new Error(`unknown tool: "${name}". Available tools: ${names}.`);
    }
  }
  deps.onToolEnd?.(name, result);
  return result;
}
```

- [ ] **Step 3: Implement the finalize-args bounce in `loop.ts`**

Replace the `finalizeCall` handling block (current lines 374-398):

```ts
    let bouncedThisTurn = false;
    if (finalizeCall) {
      let playlist: PlaylistRec | null = null;
      try {
        playlist = playlistFromFinalizeArgs(finalizeCall.args);
      } catch (e) {
        if (i >= budget - 1) throw e;
        bouncedThisTurn = true;
        stalledTurns = 0; // explicit new instruction — not a stall
        const msg = e instanceof Error ? e.message : String(e);
        resultLines.push(
          `[finalize_playlist rejected: ${msg} Call finalize_playlist again with a non-empty "name" string ` +
            `and a "tracks" array of {artist,title} objects. Do not restate your analysis of the request.]`,
        );
      }
      if (playlist) {
        const verifiedSet = new Set(
          verifiedTracks.map((t) => `${t.artist.toLowerCase()}|${t.title.toLowerCase()}`),
        );
        const unverified = playlist.tracks.filter(
          (t) => !verifiedSet.has(`${t.artist.toLowerCase()}|${t.title.toLowerCase()}`),
        );
        const budgetLeft = i < budget - 1;
        // Only bounce substantial lists — the guard targets mass hallucination;
        // a handful of unverified tracks is cheap to resolve/drop downstream.
        if (!finalizeBounced && budgetLeft && playlist.tracks.length >= 5 && unverified.length * 2 > playlist.tracks.length) {
          finalizeBounced = true;
          bouncedThisTurn = true;
          stalledTurns = 0; // explicit new instruction — not a stall
          resultLines.push(
            `[finalize rejected: ${unverified.length} of ${playlist.tracks.length} tracks are unverified and will be dropped if they don't exist. ` +
              `Verify them with searchTrack — batch ALL of them in ONE turn — or replace them with verified tracks, then call finalize_playlist again. ` +
              `Unverified: ${unverified.slice(0, 30).map((t) => `${t.artist} – ${t.title}`).join("; ")}]`,
          );
        } else {
          return { playlist, clarifyAnswers, iterations: i + 1, toolTrace };
        }
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/agent-tools.test.ts tests/agent-loop.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
git add src/agent/tools.ts src/agent/loop.ts tests/agent-tools.test.ts tests/agent-loop.test.ts
git commit -m "fix(agent): repair mis-cased tool names, bounce malformed finalize_playlist instead of killing the run"
```

---

## Task 3: Per-family reasoning-effort mapping + loop policy (A2)

**Files:**
- Modify: `src/agent/providers/opencode.ts:99-232` (`generate`, `request`) — map `reasoningEffort` per family; generalize the 400-degrade retry to strip `toolChoice`/`reasoningEffort`/`maxTokens` together.
- Modify: `src/agent/loop.ts` — set `reasoningEffort: "low"` on the rescue call, the hard-demand turn, any bounced-retry turn, and the forced first-turn clarify turn; leave research turns unset.
- Modify: `src/app.tsx:947` — pass `{ reasoningEffort: "none", maxTokens: 512 }` into the taste-rotation `provider.generate` call.
- Test: `tests/opencode-provider.test.ts` — reasoning-knob mapping per family + 400-degrade strips both knobs.
- Test: `tests/agent-loop.test.ts` — capture `opts.reasoningEffort` seen per turn across a full run.

**Interfaces:**
- Consumes: `GenerateOptions.reasoningEffort` (added in Task 1, Step 1).
- No new exports.

- [ ] **Step 1: Write the failing tests**

Append to `tests/opencode-provider.test.ts`:

```ts
describe("OpencodeProvider reasoning effort mapping", () => {
  test("anthropic: 'low' sets thinking.budget_tokens and raises max_tokens to cover it", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } }), JSON.stringify({ type: "message_stop" })]));
    const provider = new OpencodeProvider({ name: "opencode-zen", apiKey: "k", baseUrl: "https://opencode.ai/zen/v1", model: "claude-sonnet-5" });
    await provider.generate("sys", "hi", undefined, undefined, { reasoningEffort: "low" });
    const body = calls[0]!.body as any;
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
    expect(body.max_tokens).toBe(4096 + 2048);
  });

  test("anthropic: 'none' omits the thinking field entirely", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } }), JSON.stringify({ type: "message_stop" })]));
    const provider = new OpencodeProvider({ name: "opencode-zen", apiKey: "k", baseUrl: "https://opencode.ai/zen/v1", model: "claude-sonnet-5" });
    await provider.generate("sys", "hi", undefined, undefined, { reasoningEffort: "none" });
    expect(calls[0]!.body.thinking).toBeUndefined();
  });

  test("openai-responses: maps to reasoning.effort ('none' -> 'minimal')", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ type: "response.output_text.delta", delta: "hi" })]));
    const provider = new OpencodeProvider({ name: "opencode-zen", apiKey: "k", baseUrl: "https://opencode.ai/zen/v1", model: "gpt-5.5" });
    await provider.generate("sys", "hi", undefined, undefined, { reasoningEffort: "none" });
    expect(calls[0]!.body.reasoning).toEqual({ effort: "minimal" });
  });

  test("openai-compat: maps to reasoning_effort", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" } }] }), "[DONE]"]));
    const provider = new OpencodeProvider({ name: "opencode-go", apiKey: "k", baseUrl: "https://opencode.ai/zen/go/v1", model: "glm-5.2" });
    await provider.generate("sys", "hi", undefined, undefined, { reasoningEffort: "low" });
    expect(calls[0]!.body.reasoning_effort).toBe("low");
  });

  test("google: maps to generationConfig.thinkingConfig.thinkingBudget", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ candidates: [{ content: { parts: [{ text: "hi" }] } }] })]));
    const provider = new OpencodeProvider({ name: "opencode-zen", apiKey: "k", baseUrl: "https://opencode.ai/zen/v1", model: "gemini-2.5-pro" });
    await provider.generate("sys", "hi", undefined, undefined, { reasoningEffort: "high" });
    expect(calls[0]!.body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 12000 });
  });

  test("no reasoningEffort set -> no reasoning field on any family (unchanged default behavior)", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" } }] }), "[DONE]"]));
    const provider = new OpencodeProvider({ name: "opencode-go", apiKey: "k", baseUrl: "https://opencode.ai/zen/go/v1", model: "glm-5.2" });
    await provider.generate("sys", "hi");
    expect(calls[0]!.body.reasoning_effort).toBeUndefined();
  });

  test("400 with forced tool_choice AND reasoningEffort degrades by stripping both, retries once", async () => {
    const bodies: any[] = [];
    let call = 0;
    globalThis.fetch = (async (_input: any, init: any) => {
      bodies.push(JSON.parse(init.body));
      if (call++ === 0) {
        return new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 });
      }
      return sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" } }] }), "[DONE]"]);
    }) as typeof fetch;
    const provider = new OpencodeProvider({ name: "opencode-go", apiKey: "k", baseUrl: "https://opencode.ai/zen/go/v1", model: "deepseek-v4-pro" });
    const result = await provider.generate("sys", "hi", undefined, undefined, {
      toolChoice: { name: "clarify" },
      tools: MUSIC_AGENT_TOOLS,
      reasoningEffort: "low",
      maxTokens: 100,
    });
    expect(result.text).toBe("hi");
    expect(bodies.length).toBe(2);
    expect(bodies[0].reasoning_effort).toBe("low");
    expect(bodies[0].max_completion_tokens).toBe(100);
    expect(bodies[1].tool_choice).toBe("auto");
    expect(bodies[1].reasoning_effort).toBeUndefined();
    expect(bodies[1].max_completion_tokens).toBe(4096);
  });
});
```

Append to `tests/agent-loop.test.ts` (new `describe`, after the retry suite):

```ts
describe("runAgentLoop reasoning-effort policy", () => {
  test("research turns leave reasoningEffort unset; hard-demand and rescue turns use 'low'", async () => {
    const optsSeen: (GenerateOptions | undefined)[] = [];
    const provider: AgentProvider = {
      name: "capture",
      generate: async (_system, _user, _onToken, _signal, opts) => {
        optsSeen.push(opts);
        return { text: "", toolCalls: [{ id: `c${optsSeen.length}`, name: "searchTrack", args: { artist: "A", title: "B" } }] };
      },
    };
    await runAgentLoop(provider, "sys", "user", { deps: { music: fakeMusic() }, maxIterations: 2 });
    expect(optsSeen.length).toBe(3); // turn 0 (research), turn 1 (hard-demand), rescue call
    expect(optsSeen[0]?.reasoningEffort).toBeUndefined();
    expect(optsSeen[1]?.reasoningEffort).toBe("low");
    expect(optsSeen[2]?.reasoningEffort).toBe("low");
    expect(optsSeen[2]?.maxTokens).toBe(2048);
  });

  test("forced first-turn clarify turn uses reasoningEffort 'low'", async () => {
    const optsSeen: (GenerateOptions | undefined)[] = [];
    let call = 0;
    const provider: AgentProvider = {
      name: "capture",
      generate: async (_system, _user, _onToken, _signal, opts) => {
        optsSeen.push(opts);
        call++;
        if (call === 1) {
          return { text: "", toolCalls: [{ id: "c1", name: "clarify", args: { question: "Q?", options: ["a", "b", "c"] } }] };
        }
        return { text: "", toolCalls: [{ id: "c2", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] } }] };
      },
    };
    const r = await runAgentLoop(provider, "sys", "user", {
      deps: { music: fakeMusic(), onClarify: async () => "a" },
      firstTurnToolChoice: "clarify",
    });
    expect(optsSeen[0]?.reasoningEffort).toBe("low");
    expect(optsSeen[0]?.toolChoice).toEqual({ name: "clarify" });
    expect(r.playlist.name).toBe("X");
  });

  test("a bounced-finalize retry turn uses reasoningEffort 'low'", async () => {
    const optsSeen: (GenerateOptions | undefined)[] = [];
    let call = 0;
    const provider: AgentProvider = {
      name: "capture",
      generate: async (_system, _user, _onToken, _signal, opts) => {
        optsSeen.push(opts);
        call++;
        if (call === 1) {
          return { text: "", toolCalls: [{ id: "c1", name: "finalize_playlist", args: { name: "X", tracks: [], artists: [] } }] };
        }
        return { text: "", toolCalls: [{ id: "c2", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] } }] };
      },
    };
    await runAgentLoop(provider, "sys", "user", { deps: { music: fakeMusic() }, maxIterations: 4 });
    expect(optsSeen[0]?.reasoningEffort).toBeUndefined();
    expect(optsSeen[1]?.reasoningEffort).toBe("low");
  });
});
```

Add `GenerateOptions` to the type import at the top of `tests/agent-loop.test.ts`:

```ts
import type { AgentEvent, AgentProvider, AgentResult, GenerateOptions, ToolCall } from "../src/agent/types";
```

- [ ] **Step 1b: Run tests to verify they fail**

Run: `bun test tests/opencode-provider.test.ts tests/agent-loop.test.ts`
Expected: FAIL — no `thinking`/`reasoning`/`reasoning_effort`/`thinkingConfig` fields exist yet; `optsSeen[*].reasoningEffort` all `undefined`.

- [ ] **Step 2: Implement family reasoning-knob mapping in `opencode.ts`**

Add near `DEFAULT_MAX_TOKENS`:

```ts
const REASONING_BUDGET_TOKENS: Record<"none" | "low" | "medium" | "high", number> = {
  none: 0,
  low: 2048,
  medium: 6000,
  high: 12000,
};
```

Update each family's `body` in `request()`. Anthropic:

```ts
      case "anthropic": {
        const budget =
          opts?.reasoningEffort && opts.reasoningEffort !== "none"
            ? REASONING_BUDGET_TOKENS[opts.reasoningEffort]
            : undefined;
        const baseMax = opts?.maxTokens ?? DEFAULT_MAX_TOKENS;
        const res = await fetch(`${this.baseUrl}/messages`, {
          method: "POST",
          signal,
          headers,
          body: JSON.stringify({
            model: this.model,
            max_tokens: budget ? baseMax + budget : baseMax,
            system,
            stream: true,
            messages: [{ role: "user", content: user }],
            ...(tools ? { tools } : {}),
            ...(choice ?? {}),
            ...(budget ? { thinking: { type: "enabled", budget_tokens: budget } } : {}),
          }),
        });
```

openai-responses:

```ts
      case "openai-responses": {
        const res = await fetch(`${this.baseUrl}/responses`, {
          method: "POST",
          signal,
          headers,
          body: JSON.stringify({
            model: this.model,
            instructions: system,
            input: user,
            stream: true,
            max_output_tokens: opts?.maxTokens ?? DEFAULT_MAX_TOKENS,
            ...(tools ? { tools } : {}),
            ...(choice ?? {}),
            ...(opts?.reasoningEffort
              ? { reasoning: { effort: opts.reasoningEffort === "none" ? "minimal" : opts.reasoningEffort } }
              : {}),
          }),
        });
```

google:

```ts
      case "google": {
        const res = await fetch(`${this.baseUrl}/models/${this.model}`, {
          method: "POST",
          signal,
          headers,
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: user }] }],
            systemInstruction: { parts: [{ text: system }] },
            generationConfig: {
              maxOutputTokens: opts?.maxTokens ?? DEFAULT_MAX_TOKENS,
              ...(opts?.reasoningEffort
                ? { thinkingConfig: { thinkingBudget: REASONING_BUDGET_TOKENS[opts.reasoningEffort] } }
                : {}),
            },
            ...(tools ? { tools } : {}),
            ...(choice ?? {}),
          }),
        });
```

openai-compat:

```ts
      case "openai-compat":
      default: {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          signal,
          headers,
          body: JSON.stringify({
            model: this.model,
            stream: true,
            max_completion_tokens: opts?.maxTokens ?? DEFAULT_MAX_TOKENS,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            ...(tools ? { tools, tool_choice: "auto" } : {}),
            ...(choice ?? {}),
            ...(opts?.reasoningEffort
              ? { reasoning_effort: opts.reasoningEffort === "none" ? "minimal" : opts.reasoningEffort }
              : {}),
          }),
        });
```

- [ ] **Step 3: Generalize the 400-degrade retry in `generate()`**

Replace the current `generate()` body (lines 99-139) from the `forced` computation onward:

```ts
    const forced = tools && opts?.toolChoice ? toolChoiceForFamily(family, opts.toolChoice.name) : undefined;

    try {
      return await this.request(family, headers, label, system, user, tools, forced, onToken, signal, opts);
    } catch (e) {
      // Some upstreams behind the gateway (e.g. deepseek on the Go tier)
      // reject a forced tool_choice, a reasoning knob, or a non-default
      // max-tokens value with a 400. These are optimizations, not contracts —
      // degrade once by stripping all three and retry unforced.
      const status = (e as { status?: number }).status;
      const degradable = Boolean(forced) || opts?.reasoningEffort !== undefined || opts?.maxTokens !== undefined;
      if (status === 400 && degradable) {
        const degraded: GenerateOptions | undefined = opts
          ? { ...opts, reasoningEffort: undefined, maxTokens: undefined }
          : opts;
        return this.request(family, headers, label, system, user, tools, undefined, onToken, signal, degraded);
      }
      throw e;
    }
```

- [ ] **Step 4: Run provider tests to verify they pass**

Run: `bun test tests/opencode-provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the loop policy in `loop.ts`**

Add `GenerateOptions` to the type import:

```ts
import type { AgentEvent, AgentProvider, AgentResult, GenerateOptions, ProviderErrorInfo, ToolCall } from "./types";
```

Declare a tracking variable near `budget`/`stalledTurns` (after `let finalizeBounced = false;`):

```ts
  // Reasoning-effort hint for the NEXT iteration's generate call: mechanical
  // turns (hard-demand, bounced retries) use "low"; research turns leave it
  // unset so curation quality doesn't regress. Set at the bottom of an
  // iteration, consumed at the top of the next one, then reset.
  let nextEffort: GenerateOptions["reasoningEffort"];
```

Update the top-of-loop generate call (current lines 246-262):

```ts
  for (let i = 0; i < budget; i++) {
    opts.signal?.throwIfAborted();
    opts.onProgress?.("thinking");
    const forcedFirstTurn = i === 0 && Boolean(opts.firstTurnToolChoice);
    const effort: GenerateOptions["reasoningEffort"] = forcedFirstTurn || nextEffort ? "low" : undefined;
    nextEffort = undefined;
    const result: AgentResult = await generateWithRetry(
      provider,
      system,
      user,
      opts.onToken,
      opts.signal,
      {
        tools,
        onReasoning: emitReasoning,
        ...(forcedFirstTurn ? { toolChoice: { name: opts.firstTurnToolChoice! } } : {}),
        ...(effort ? { reasoningEffort: effort } : {}),
      },
    );
    lastText = result.text;
```

Add the rescue call's `reasoningEffort`/`maxTokens` (current lines 426-433):

```ts
        const rescue = await generateWithRetry(
          provider,
          system,
          `${user}\n\nYou are out of research budget. Call finalize_playlist NOW with your best tracklist based on everything above. It is the only tool available.`,
          opts.onToken,
          opts.signal,
          {
            tools: finalizeOnly,
            onReasoning: emitReasoning,
            toolChoice: { name: "finalize_playlist" },
            reasoningEffort: "low",
            maxTokens: 2048,
          },
        );
```

Set `nextEffort` where `hardDemand` is computed (current lines 484-492), right after `bouncedThisTurn`/stall accounting is finalized and before the `continuation` string is built:

```ts
    const hardDemand = i === budget - 2;
    const softDemand = verifiedTracks.length >= target || stalledTurns >= STALL_LIMIT;
    nextEffort = bouncedThisTurn || hardDemand ? "low" : undefined;
    const continuation = bouncedThisTurn
```

- [ ] **Step 6: Fix the taste-rotation call site in `app.tsx`**

```tsx
// src/app.tsx:947 — replace:
        taste = await rotate(taste, (raw) =>
          provider.generate(ROTATE_SYSTEM, raw, undefined, undefined, { reasoningEffort: "none", maxTokens: 512 }).then(
            (r) => r.text,
          ),
        ).catch(() => taste);
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun test tests/opencode-provider.test.ts tests/agent-loop.test.ts`
Expected: PASS, including all pre-existing tests in both files (the "penultimate iteration demands..." test's assertions on prompt text are untouched by this task).

- [ ] **Step 8: Typecheck and commit**

```bash
git add src/agent/providers/opencode.ts src/agent/loop.ts src/app.tsx tests/opencode-provider.test.ts tests/agent-loop.test.ts
git commit -m "feat(agent): map reasoning effort per turn type, degrade 400s by stripping optional knobs"
```

- [ ] **Step 9: Real-run sanity check (one per family)**

Use the `run-vibedeck` skill to generate one playlist each on an opencode-zen anthropic model, an opencode-go openai-compat model, and (if configured) an OpenAI model. Confirm: finalize quality is unchanged, no new 400s, and the hard-demand/rescue turns visibly used a smaller/faster response in logs.

---

## Task 4: Terse tool descriptions — cut duplication with skills (A4)

**Files:**
- Modify: `src/agent/tools.ts:69-93` (`clarifySpec`), `:95-128` (`finalizePlaylistSpec`).
- Test: `tests/agent-tools.test.ts` — lock in the trim, prevent the essay from creeping back.

Policy source of truth stays in `src/agent/skills/clarify.md` (clarify-first rule, examples, "at most once") and `src/agent/skills/curation.md` (script/no-transliteration, explicit-artists-only, default track count). `tools.ts` descriptions keep only what a tool spec must say: what the tool does mechanically, and any constraint not already stated in a skill (the finalize "call exactly once, last step" contract, and the tracks field's "no more than 2-3 per artist" diversity cap — neither is duplicated elsewhere).

- [ ] **Step 1: Write the failing test**

Append to `tests/agent-tools.test.ts`, inside `describe("tool spec surface", ...)`:

```ts
  test("clarify description is mechanical only — policy lives in the clarify.md skill", () => {
    const clarify = MUSIC_AGENT_TOOLS.find((t) => t.name === "clarify")!;
    expect(clarify.description).not.toMatch(/prefer calling this first/i);
    expect(clarify.description).not.toMatch(/skipping it produces generic playlists/i);
    expect(clarify.description.length).toBeLessThan(220);
  });

  test("finalize_playlist description keeps the load-bearing 'call exactly once, last step' contract", () => {
    const finalize = MUSIC_AGENT_TOOLS.find((t) => t.name === "finalize_playlist")!;
    expect(finalize.description).toMatch(/call exactly once/i);
    expect(finalize.description).toMatch(/last agent step/i);
    expect(finalize.description).not.toMatch(/artist names and titles in their original script/i);
  });
```

- [ ] **Step 1b: Run test to verify it fails**

Run: `bun test tests/agent-tools.test.ts`
Expected: FAIL — current `clarifySpec.description` is 400+ chars and contains "Prefer calling this FIRST"; current `finalizePlaylistSpec.parameters.tracks.description` contains the script-rule sentence.

- [ ] **Step 2: Trim the descriptions in `tools.ts`**

```ts
// src/agent/tools.ts — replace clarifySpec (lines 69-93):
const clarifySpec: ToolSpec = {
  name: "clarify",
  description:
    "Ask the user one clarifying question with exactly 3 concrete options. " +
    "The harness surfaces this in the TUI and returns the user's chosen answer " +
    "(one of the options, or a custom free-text answer).",
  parameters: {
    type: "object",
    properties: {
      question: { type: "string", description: "One short clarifying question grounded in the user's actual request." },
      options: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 3,
        description: "Exactly 3 short, concrete, mutually distinct options.",
      },
    },
    required: ["question", "options"],
  },
};
```

```ts
// src/agent/tools.ts — replace finalizePlaylistSpec (lines 95-128):
const finalizePlaylistSpec: ToolSpec = {
  name: "finalize_playlist",
  description:
    "Commit the final playlist. Call exactly once, as the last agent step — " +
    "the harness stops the loop on this call. `tracks` is the full ordered " +
    "tracklist; `artists` lists only artists the user explicitly named in " +
    "their request (empty array if none).",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Short evocative playlist title fitting the request." },
      tracks: {
        type: "array",
        description: "Ordered track list. No more than 2-3 tracks per artist.",
        items: {
          type: "object",
          properties: {
            artist: { type: "string" },
            title: { type: "string" },
          },
          required: ["artist", "title"],
        },
        minItems: 1,
      },
      artists: {
        type: "array",
        items: { type: "string" },
        description: "Artists explicitly named in the user's request, in their original script. Empty array if none.",
      },
    },
    required: ["name", "tracks", "artists"],
  },
};
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `bun test tests/agent-tools.test.ts`
Expected: PASS, including the pre-existing `finalize_playlist marks name/tracks/artists as required` test (untouched `required` array).

- [ ] **Step 4: Typecheck and commit (isolated, revertable)**

```bash
git add src/agent/tools.ts tests/agent-tools.test.ts
git commit -m "refactor(agent): trim tool descriptions that duplicate skill policy"
```

- [ ] **Step 5: Real-run sanity check (one family)**

Run one playlist generation via `run-vibedeck`. Confirm clarify-first behavior and finalize shape are unaffected by the shorter descriptions (policy still lives in the always-on skills, which are unchanged).

---

## Task 5: Neutral message type + optional `generateMessages` transport (B1)

**Goal for this task only:** add the type surface and loop bookkeeping for a future native multi-turn transport, with **zero behavior change** for every provider in the tree today (none of them implement `generateMessages` yet — that's Task 6+). This task is safe to land on its own because the new code path is only exercised by a test-only fake provider.

**Files:**
- Modify: `src/agent/types.ts` — add `AgentMessage`, optional `AgentProvider.generateMessages`.
- Modify: `src/agent/loop.ts` — maintain an append-only `messages: AgentMessage[]` alongside the existing `blocks`/`user` string machinery; dispatch through `generateMessages` when a provider implements it, else through the unchanged `generate` path.
- Test: `tests/agent-loop.test.ts` — fake provider with `generateMessages`; append-only prefix invariant; join-fallback regression lock.

**Interfaces:**
- Produces: `AgentMessage` (exported from `types.ts`), consumed by `AgentProvider.generateMessages` and by `loop.ts`'s internal `messages` array.
- Produces: `AgentProvider.generateMessages?(system, messages, onToken?, signal?, opts?) => Promise<AgentResult>` — same `AgentResult` shape as `generate`, so loop.ts's downstream handling (finalize capture, dedup, etc.) doesn't branch on which transport was used.

- [ ] **Step 1: Write the failing test**

Append to `tests/agent-loop.test.ts` (new `describe`, at the end of the file):

```ts
describe("runAgentLoop generateMessages transport (opt-in, zero default behavior change)", () => {
  test("a provider without generateMessages uses the existing joined-string transport, unchanged", async () => {
    const userPrompts: string[] = [];
    const { provider } = scriptedProvider([
      { text: "", toolCalls: [{ id: "c1", name: "searchTrack", args: { artist: "A", title: "B" } }] },
      { text: "", toolCalls: [{ id: "c2", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] } }] },
    ]);
    // Wrap to capture the `user` string exactly as generate() receives it today.
    const capturing: AgentProvider = {
      name: provider.name,
      generate: async (system, user, onToken, signal, opts) => {
        userPrompts.push(user);
        return provider.generate(system, user, onToken, signal, opts);
      },
    };
    const r = await runAgentLoop(capturing, "sys", "find some tracks", { deps: { music: fakeMusic() } });
    expect(r.playlist.name).toBe("X");
    expect(userPrompts[0]).toBe("find some tracks");
    expect(userPrompts[1]).toContain("[tool results]");
    expect(userPrompts[1]).toContain("Tool searchTrack result");
  });

  test("a provider WITH generateMessages is dispatched through it instead of generate, with an append-only message prefix", async () => {
    const seenPerCall: AgentMessage[][] = [];
    let call = 0;
    const provider: AgentProvider = {
      name: "native",
      generate: async () => {
        throw new Error("generate() should not be called when generateMessages is present");
      },
      generateMessages: async (_system, messages) => {
        seenPerCall.push(messages.map((m) => ({ ...m })));
        call++;
        if (call === 1) {
          return { text: "", toolCalls: [{ id: "c1", name: "searchTrack", args: { artist: "A", title: "B" } }] };
        }
        return { text: "", toolCalls: [{ id: "c2", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] } }] };
      },
    };
    const r = await runAgentLoop(provider, "sys", "find some tracks", { deps: { music: fakeMusic() } });
    expect(r.playlist.name).toBe("X");
    expect(seenPerCall.length).toBe(2);
    // Append-only prefix invariant: everything generateMessages saw on call 1
    // is still there, unmodified, as a prefix of what it saw on call 2.
    const prefix = seenPerCall[1]!.slice(0, seenPerCall[0]!.length);
    expect(prefix).toEqual(seenPerCall[0]);
    expect(seenPerCall[1]!.length).toBeGreaterThan(seenPerCall[0]!.length);
    // First message is always the original request, verbatim.
    expect(seenPerCall[0]![0]).toEqual({ role: "user", content: "find some tracks" });
  });
});
```

Add `AgentMessage` to the type import at the top of `tests/agent-loop.test.ts`:

```ts
import type { AgentEvent, AgentMessage, AgentProvider, AgentResult, GenerateOptions, ToolCall } from "../src/agent/types";
```

- [ ] **Step 1b: Run tests to verify they fail**

Run: `bun test tests/agent-loop.test.ts`
Expected: FAIL — `AgentMessage` doesn't exist (type error), `generateMessages` isn't dispatched.

- [ ] **Step 2: Add `AgentMessage` and the optional method to `types.ts`**

```ts
// src/agent/types.ts — new export, after ToolCall:
/** One turn in a native multi-turn transport, for providers that implement
 * AgentProvider.generateMessages instead of (or in addition to) the joined-
 * string `generate`. The loop builds this array append-only so a caching
 * provider can key off a stable prefix. */
export type AgentMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; callId: string; name: string; content: string };
```

Add the optional method to `AgentProvider` (after `generate`):

```ts
export interface AgentProvider {
  name: string;
  generate(
    system: string,
    user: string,
    onToken?: (delta: string) => void,
    signal?: AbortSignal,
    opts?: GenerateOptions,
  ): Promise<AgentResult>;
  /** Optional native multi-turn transport. Providers that implement this
   * receive the full message history each turn instead of one growing user
   * string, and are the only providers that can carry prompt-cache
   * breakpoints. Providers without it are dispatched through `generate` with
   * the loop's existing joined-string transport — behavior is identical to
   * today. */
  generateMessages?(
    system: string,
    messages: AgentMessage[],
    onToken?: (delta: string) => void,
    signal?: AbortSignal,
    opts?: GenerateOptions,
  ): Promise<AgentResult>;
}
```

- [ ] **Step 3: Maintain `messages[]` and dispatch conditionally in `loop.ts`**

Import `AgentMessage`:

```ts
import type { AgentEvent, AgentMessage, AgentProvider, AgentResult, GenerateOptions, ProviderErrorInfo, ToolCall } from "./types";
```

Initialize `messages` next to `blocks` (current line 232, `let blocks: string[] = [];`):

```ts
  let blocks: string[] = [];
  // Append-only native-transport mirror of the same conversation `blocks`
  // encodes as a joined string. Only consumed when the provider implements
  // generateMessages (Task 6+); otherwise it's built but never read — cheap
  // bookkeeping, not a behavior change. Never rewritten except by compaction
  // (Phase B3), so a caching provider can key off a stable prefix.
  const messages: AgentMessage[] = [{ role: "user", content: baseUser }];
```

Replace the top-of-loop dispatch (from Task 3's Step 5 edit) to branch on `generateMessages`:

```ts
    const genOpts: GenerateOptions = {
      tools,
      onReasoning: emitReasoning,
      ...(forcedFirstTurn ? { toolChoice: { name: opts.firstTurnToolChoice! } } : {}),
      ...(effort ? { reasoningEffort: effort } : {}),
    };
    const result: AgentResult = provider.generateMessages
      ? await generateWithRetry(
          (s, _u, tok, sig, o) => provider.generateMessages!(s, messages, tok, sig, o),
          system,
          user,
          opts.onToken,
          opts.signal,
          genOpts,
        )
      : await generateWithRetry(
          (s, u, tok, sig, o) => provider.generate(s, u, tok, sig, o),
          system,
          user,
          opts.onToken,
          opts.signal,
          genOpts,
        );
    lastText = result.text;
```

This requires `generateWithRetry`'s first parameter to accept a plain generate-shaped function instead of an `AgentProvider`, so both transports share one retry implementation. Update its signature (Task 1's version):

```ts
async function generateWithRetry(
  generate: (
    system: string,
    user: string,
    onToken?: (delta: string) => void,
    signal?: AbortSignal,
    opts?: GenerateOptions,
  ) => Promise<AgentResult>,
  system: string,
  user: string,
  onToken: ((delta: string) => void) | undefined,
  signal: AbortSignal | undefined,
  genOpts: GenerateOptions,
): Promise<AgentResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await generate(system, user, onToken, signal, genOpts);
    } catch (e) {
      if (signal?.aborted || attempt >= RETRY_DELAYS_MS.length || !isTransientError(e)) {
        throw e;
      }
      const retryAfterMs = (e as ProviderErrorInfo | undefined)?.retryAfterMs;
      const delay =
        typeof retryAfterMs === "number"
          ? Math.min(retryAfterMs, MAX_RETRY_DELAY_MS)
          : RETRY_DELAYS_MS[attempt]! + Math.random() * 250;
      await sleep(delay, signal);
    }
  }
}
```

(The `user` parameter is unused by the `generateMessages` closure — it ignores its second argument — but keeping one shared signature avoids a second retry implementation. Update the rescue call similarly: `(s, u, tok, sig, o) => provider.generate(s, u, tok, sig, o)` as the first argument, rest unchanged.)

Append messages after tool dispatch, right before `blocks.push(...)` (current line 493) — mirrors what already goes into `resultLines`:

```ts
    messages.push({ role: "assistant", content: lastText, toolCalls: calls });
    calls.forEach((call, idx) => {
      const line =
        call.name === "finalize_playlist"
          ? JSON.stringify(call.args)
          : outcomes[idx]!.kind === "error"
            ? `error: ${(outcomes[idx] as { message: string }).message}`
            : JSON.stringify(slimResult((outcomes[idx] as { result: unknown }).result));
      messages.push({ role: "tool", callId: call.id, name: call.name, content: clipResult(line) });
    });
    blocks.push(`[tool results]\n${resultLines.join("\n")}`);
```

And the continuation message, right after `user = [...].join("\n\n");` (current line 524):

```ts
    user = [baseUser, ...blocks, continuation].join("\n\n");
    messages.push({ role: "user", content: continuation });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/agent-loop.test.ts`
Expected: PASS — both new tests, and every pre-existing test in the file (they all use providers without `generateMessages`, so they exercise the unchanged `generate` path).

- [ ] **Step 5: Run the full suite**

Run: `bun test`
Expected: PASS. This is the highest-blast-radius edit in the plan so far (touches `generateWithRetry`'s call sites) — confirm nothing outside `agent-loop.test.ts` regressed.

- [ ] **Step 6: Typecheck and commit**

```bash
git add src/agent/types.ts src/agent/loop.ts tests/agent-loop.test.ts
git commit -m "feat(agent): add optional generateMessages transport + append-only message history (no provider implements it yet)"
```

---

## Phase B, continued — B2 (family wiring) + B3 (cache breakpoints): proposed next slice, not fully specified here

Everything above is safe to implement now: it's mechanical, covered by tests against known request/response shapes already exercised in this codebase's test suite. B2 and B3 are different in kind — they require getting the **live** SSE event shapes right for multi-turn tool-result exchanges (Anthropic content-block alternation rules, Responses API `function_call_output` items, `prompt_cache_key` cache-hit behavior) that this codebase has never sent a request for before. Guessing them now risks landing code that typechecks and passes mocked tests but silently corrupts every real multi-turn run — worse than not landing it.

**Recommendation:** treat Anthropic as a spike that de-risks the rest, then plan B2's remaining 3 families + B3 as a follow-up once that spike confirms the wire format against the real opencode Zen gateway.

**Worked design for the spike (Task 6, not yet bite-sized):**

- `src/agent/tools.ts` (or a new `src/agent/wire.ts` beside it, matching the existing `toolsForFamily`/`toolChoiceForFamily` seam) gets `messagesForAnthropic(system: string, messages: AgentMessage[]): { system: string; messages: unknown[] }`:
  - `{ role: "user", content }` → `{ role: "user", content }`.
  - `{ role: "assistant", content, toolCalls }` → `{ role: "assistant", content: [...(content ? [{type:"text",text:content}] : []), ...toolCalls.map(c => ({type:"tool_use", id: c.id, name: c.name, input: c.args}))] }`.
  - Consecutive `{ role: "tool", ... }` messages merge into **one** `{ role: "user", content: [{type:"tool_result", tool_use_id: callId, content}, ...] }` block — Anthropic requires strict `user`/`assistant` alternation, so N tool results from one turn become one user turn, not N.
- `OpencodeProvider.generateMessages` (anthropic branch only) calls this, sets `cache_control: {type:"ephemeral"}` on the system block and on the last content block of the last message (B3, same task — the cache breakpoint only pays off once the message array is real).
- Test against the exact SSE shapes already asserted in `tests/opencode-provider.test.ts`'s anthropic tests, extended to a 2-turn exchange (tool call → tool result → finalize), asserting the second request body's `messages` array has the alternation above.

**Before scoping B2's other 3 families or B3's `prompt_cache_key` wiring:** run the Anthropic spike against a live opencode-zen key, capture the actual request/response, and confirm `usage.cache_read_input_tokens > 0` appears on turn 2 as expected. That result — not this document — should drive whether openai-responses/openai-compat/google get the same treatment or whether Anthropic-only caching (still the highest-traffic family per the original analysis) is where this stops.

---

## Verification (after every task)

- `bun test` — full suite green.
- Repo's typecheck command — clean.
- Task 3 and Task 4 each get one real `run-vibedeck` playlist generation per touched provider family before moving on — these are prompt/behavior changes that unit tests can assert the *wire format* of but not curation *quality*.
