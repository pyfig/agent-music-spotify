import type { AgentProvider, AgentResult, GenerateOptions, ProviderErrorInfo, ToolCall } from "../types";
import { toolChoiceForFamily, toolsForFamily } from "../tools";

/** Provider-local default response cap when the caller doesn't set opts.maxTokens. */
const DEFAULT_MAX_TOKENS = 4096;

/** Token budget backing each reasoningEffort tier — used directly as
 * Anthropic's thinking.budget_tokens / Google's thinkingConfig.thinkingBudget. */
const REASONING_BUDGET_TOKENS: Record<"none" | "low" | "medium" | "high", number> = {
  none: 0,
  low: 2048,
  medium: 6000,
  high: 12000,
};

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

export interface OpencodeProviderConfig {
  /** Stable provider id surfaced in the UI & config: "opencode-go" | "opencode-zen". */
  name: string;
  /** Bearer token for the opencode hosted API (OPENCODE_GO_API_KEY / OPENCODE_ZEN_API_KEY). */
  apiKey: string;
  /** Chat completions base URL without trailing slash (OPENCODE_GO_BASE_URL / OPENCODE_ZEN_BASE_URL). */
  baseUrl: string;
  /** Model string for this instance, e.g. "glm-5.2" or "claude-sonnet-5". */
  model: string;
}

/**
 * Strips paste artifacts that silently turn a valid key into a rejected one:
 * surrounding whitespace/quotes and an accidental "Bearer " prefix (from a
 * copied curl example). `saveConfig` already does this for values entered
 * via the TUI, but keys can also arrive via a hand-edited config.json or a
 * raw env var, so the provider sanitizes again defensively.
 */
function sanitizeCredential(value: string): string {
  let v = value.trim();
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    v = v.slice(1, -1).trim();
  }
  return v.replace(/^bearer\s+/i, "");
}

export type ZenFamily = "anthropic" | "openai-responses" | "openai-compat" | "google";

/**
 * The opencode Zen gateway proxies to different upstream APIs depending on
 * model family — each needs a different endpoint + request/response shape.
 * See https://opencode.ai/zen for the model catalog.
 */
export function classifyModel(model: string): ZenFamily {
  const m = model.toLowerCase();
  if (m.startsWith("claude") || m.startsWith("qwen") || m.startsWith("minimax")) return "anthropic";
  if (m.startsWith("gpt-5")) return "openai-responses";
  if (m.startsWith("gemini")) return "google";
  return "openai-compat"; // deepseek, glm, kimi, mimo, grok
}

/**
 * OpenAI-compatible / Anthropic / OpenAI-Responses / Google client for
 * opencode hosted models, routed by model family. Bearer auth, SSE streaming.
 *
 * The opencode base URL and API key are not bundled — the user must configure
 * them via env (OPENCODE_GO_API_KEY/OPENCODE_GO_BASE_URL or
 * OPENCODE_ZEN_API_KEY/OPENCODE_ZEN_BASE_URL) before selecting this provider
 * in /model. Without them, generate() throws a clear error.
 */
export class OpencodeProvider implements AgentProvider {
  readonly name: string;
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(cfg: OpencodeProviderConfig) {
    this.name = cfg.name;
    this.apiKey = sanitizeCredential(cfg.apiKey);
    this.baseUrl = cfg.baseUrl.trim().replace(/\/+$/, "");
    this.model = cfg.model;
  }

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

  async generate(
    system: string,
    user: string,
    onToken?: (delta: string) => void,
    signal?: AbortSignal,
    opts?: GenerateOptions,
  ): Promise<AgentResult> {
    if (!this.apiKey) {
      throw new Error(
        `opencode provider "${this.name}" requires OPENCODE_API_KEY to be set`,
      );
    }
    if (!this.baseUrl) {
      throw new Error(
        `opencode provider "${this.name}" requires OPENCODE_BASE_URL to be set`,
      );
    }

    const family = classifyModel(this.model);
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${this.apiKey}`,
    };
    const label = `opencode ${this.name}`;
    const tools = opts?.tools?.length ? toolsForFamily(family, opts.tools) : undefined;
    // Forced tool choice (e.g. first-turn clarify), in the family's native shape.
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
  }

  private async request(
    family: ZenFamily,
    headers: Record<string, string>,
    label: string,
    system: string,
    user: string,
    tools: unknown,
    choice: Record<string, unknown> | undefined,
    onToken?: (delta: string) => void,
    signal?: AbortSignal,
    opts?: GenerateOptions,
  ): Promise<AgentResult> {
    switch (family) {
      case "anthropic": {
        // Anthropic rejects extended thinking combined with a forced tool_choice
        // (thinking only allows tool_choice: auto) — when a forced choice is
        // present, skip the thinking budget entirely so forcing wins.
        const budget =
          opts?.reasoningEffort && opts.reasoningEffort !== "none" && !choice
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
        if (!res.ok || !res.body) {
          throw await this.requestFailed(res);
        }
        return consumeAnthropicSseStream(res.body, onToken, label, opts?.onReasoning, Boolean(tools));
      }
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
        if (!res.ok || !res.body) {
          throw await this.requestFailed(res);
        }
        return consumeResponsesSseStream(res.body, onToken, label, opts?.onReasoning, Boolean(tools));
      }
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
        if (!res.ok || !res.body) {
          throw await this.requestFailed(res);
        }
        return consumeGoogleSseStream(res.body, onToken, label, opts?.onReasoning, Boolean(tools));
      }
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
        if (!res.ok || !res.body) {
          throw await this.requestFailed(res);
        }
        return consumeSseStream(res.body, onToken, label, opts?.onReasoning, Boolean(tools));
      }
    }
  }
}

/** Reads an SSE byte stream, dispatching each complete `data: ...\n\n` event to `onEvent`. */
async function readSseEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (raw: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      onEvent(buffer.slice(0, sep));
      buffer = buffer.slice(sep + 2);
    }
  }
  onEvent(buffer);
}

/**
 * Turn the per-index accreted tool-call fragment map into `ToolCall[]`. Each
 * entry's `args` is JSON-parsed; malformed JSON is fed through as `{_raw}` so
 * the loop surfaces a tool-result error instead of dropping the call silently.
 */
function buildToolCalls(acc: Map<number, { id: string; name: string; args: string }>): ToolCall[] {
  const out: ToolCall[] = [];
  for (const [, v] of acc) {
    let args: Record<string, unknown> = {};
    try {
      args = v.args.length ? JSON.parse(v.args) : {};
    } catch {
      args = { _raw: v.args };
    }
    out.push({ id: v.id, name: v.name, args });
  }
  return out;
}

/**
 * Parse a Server-Sent Events stream of OpenAI-shaped chat completion chunks.
 * Each `data:` line is JSON with `choices[0].delta` carrying `content` (string
 * text answer), `reasoning_content` (o-series reasoning → onReasoning), or
 * `tool_calls` (delta-tool-call fragments accumulated into AgentResult.toolCalls).
 * `data: [DONE]` ends the stream.
 */
export async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  onToken?: (delta: string) => void,
  label = "provider",
  onReasoning?: (delta: string) => void,
  _withTools = false,
): Promise<AgentResult> {
  let full = "";
  const tcAcc = new Map<number, { id: string; name: string; args: string }>();
  let sawReasoning = false;
  await readSseEvents(body, (raw) => {
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const data = JSON.parse(payload) as any;
        const delta = data?.choices?.[0]?.delta;
        if (!delta) continue;
        if (typeof delta.content === "string" && delta.content.length > 0) {
          full += delta.content;
          onToken?.(delta.content);
        }
        if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
          sawReasoning = true;
          onReasoning?.(delta.reasoning_content);
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const d of delta.tool_calls) {
            const idx = typeof d?.index === "number" ? d.index : 0;
            const prev = tcAcc.get(idx);
            const name = d?.function?.name;
            const id = d?.id ?? prev?.id ?? `call_${idx}`;
            const args = d?.function?.arguments ?? "";
            if (prev) {
              prev.args += typeof args === "string" ? args : "";
            } else if (typeof name === "string") {
              tcAcc.set(idx, { id, name, args: typeof args === "string" ? args : "" });
            }
          }
        }
      } catch {
        // Skip malformed keepalive/fragment lines.
      }
    }
  });

  const toolCalls = buildToolCalls(tcAcc);
  if (full.length === 0 && toolCalls.length === 0 && !sawReasoning) {
    throw new Error(`unexpected ${label} response shape (no content)`);
  }
  return { text: full, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
}

/**
 * Parse an Anthropic Messages API SSE stream:
 *  - `content_block_start` with `type: "tool_use"` registers a new tool block
 *  - `content_block_delta` with `delta.type: "text_delta"` → answer text
 *  - `content_block_delta` with `delta.type: "thinking_delta"` → reasoning
 *  - `content_block_delta` with `delta.type: "input_json_delta"` → tool args
 *  - `content_block_stop` finalizes and dispatches the accumulated tool call
 *  - `message_stop` ends the stream
 */
async function consumeAnthropicSseStream(
  body: ReadableStream<Uint8Array>,
  onToken?: (delta: string) => void,
  label = "provider",
  onReasoning?: (delta: string) => void,
  _withTools = false,
): Promise<AgentResult> {
  let full = "";
  // content_block context keyed by Anthropic's `index`. A block is either a
  // text block (no entry needed — text deltas go straight to `full`) or a
  // tool_use block (entry carries id/name/accumulating JSON args).
  const blocks = new Map<number, { kind: "tool_use"; id: string; name: string; args: string }>();
  const toolCalls: ToolCall[] = [];
  let sawReasoning = false;
  await readSseEvents(body, (raw) => {
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const data = JSON.parse(payload) as any;
        switch (data?.type) {
          case "content_block_start": {
            const blk = data?.content_block;
            const idx = data?.index ?? 0;
            if (blk?.type === "tool_use") {
              blocks.set(idx, {
                kind: "tool_use",
                id: blk.id ?? `call_${idx}`,
                name: blk.name ?? "",
                args: "",
              });
            }
            break;
          }
          case "content_block_delta": {
            const delta = data?.delta;
            if (delta?.type === "text_delta") {
              const t = delta.text;
              if (typeof t === "string" && t.length > 0) {
                full += t;
                onToken?.(t);
              }
            } else if (delta?.type === "thinking_delta") {
              const t = delta.thinking;
              if (typeof t === "string" && t.length > 0) {
                sawReasoning = true;
                onReasoning?.(t);
              }
            } else if (delta?.type === "input_json_delta") {
              const idx = data?.index ?? 0;
              const b = blocks.get(idx);
              if (b && typeof delta.partial_json === "string") {
                b.args += delta.partial_json;
              }
            }
            break;
          }
          case "content_block_stop": {
            const idx = data?.index ?? 0;
            const b = blocks.get(idx);
            if (b) {
              blocks.delete(idx);
              let args: Record<string, unknown> = {};
              try {
                args = b.args.length ? JSON.parse(b.args) : {};
              } catch {
                args = { _raw: b.args };
              }
              toolCalls.push({ id: b.id, name: b.name, args });
            }
            break;
          }
          default:
            break;
        }
      } catch {
        // Skip malformed keepalive/fragment lines.
      }
    }
  });

  if (full.length === 0 && toolCalls.length === 0 && !sawReasoning) {
    throw new Error(`unexpected ${label} response shape (no content)`);
  }
  return { text: full, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
}

/**
 * Parse an OpenAI Responses API SSE stream (gpt-5 family):
 *  - `response.output_text.delta` → answer text (delta is a string)
 *  - `response.reasoning.delta` (or `response.reasoning_summary_text.delta`) → reasoning
 *  - `response.function_call.delta` → tool-call arg fragment (delta carries `name`, `arguments`, `item_id`, `id`)
 *  - `response.completed` ends the stream
 */
async function consumeResponsesSseStream(
  body: ReadableStream<Uint8Array>,
  onToken?: (delta: string) => void,
  label = "provider",
  onReasoning?: (delta: string) => void,
  _withTools = false,
): Promise<AgentResult> {
  let full = "";
  // Responses streams function-call args across multiple `response.function_call.delta`
  // events keyed by `item_id`. First delta also carries `name`.
  const fcAcc = new Map<string, { id: string; name: string; args: string }>();
  let sawReasoning = false;
  await readSseEvents(body, (raw) => {
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const data = JSON.parse(payload) as any;
        switch (data?.type) {
          case "response.output_text.delta": {
            const d = data.delta;
            if (typeof d === "string" && d.length > 0) {
              full += d;
              onToken?.(d);
            }
            break;
          }
          case "response.reasoning.delta":
          case "response.reasoning_summary_text.delta": {
            const d = data.delta;
            const text = typeof d === "string" ? d : d?.text;
            if (typeof text === "string" && text.length > 0) {
              sawReasoning = true;
              onReasoning?.(text);
            }
            break;
          }
          case "response.function_call.delta": {
            const d = data.delta ?? {};
            const itemId = d.item_id ?? d.id ?? `call_${fcAcc.size}`;
            const prev = fcAcc.get(itemId);
            const name = d.name ?? prev?.name ?? "";
            const id = d.id ?? prev?.id ?? itemId;
            const args = typeof d.arguments === "string" ? d.arguments : "";
            if (prev) {
              prev.args += args;
            } else if (name) {
              fcAcc.set(itemId, { id, name, args });
            } else {
              // No name yet and no prev — stash empty to fill in later.
              fcAcc.set(itemId, { id, name, args });
            }
            break;
          }
          case "response.completed":
          default:
            break;
        }
      } catch {
        // Skip malformed keepalive/fragment lines.
      }
    }
  });

  // Flatten the keyed-by-item_id accumulator into a positional array
  // preserving insertion order.
  const toolCalls: ToolCall[] = [];
  for (const [, v] of fcAcc) {
    let args: Record<string, unknown> = {};
    try {
      args = v.args.length ? JSON.parse(v.args) : {};
    } catch {
      args = { _raw: v.args };
    }
    toolCalls.push({ id: v.id, name: v.name, args });
  }

  if (full.length === 0 && toolCalls.length === 0 && !sawReasoning) {
    throw new Error(`unexpected ${label} response shape (no content)`);
  }
  return { text: full, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
}

/**
 * Parse a Google generateContent SSE stream (Gemini):
 *  - Each chunk → `candidates[0].content.parts[]`
 *  - Part with `text` → answer text
 *  - Part with `thought: true` (or `thoughtText`) → Gemini 2.5 reasoning
 *  - Part with `functionCall: {name, args}` → non-streamed, complete tool call
 *  - Gemini ships tool args already-assembled as a JSON object, no accretion needed.
 */
async function consumeGoogleSseStream(
  body: ReadableStream<Uint8Array>,
  onToken?: (delta: string) => void,
  label = "provider",
  onReasoning?: (delta: string) => void,
  _withTools = false,
): Promise<AgentResult> {
  let full = "";
  const toolCalls: ToolCall[] = [];
  let sawReasoning = false;
  // Gemini assigns explicit ids to multi-turn tool calls via `functionCall.id`.
  // When absent, synthesize a positional id.
  let callCounter = 0;
  await readSseEvents(body, (raw) => {
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const data = JSON.parse(payload) as any;
        const parts: any[] | undefined = data?.candidates?.[0]?.content?.parts;
        if (!Array.isArray(parts)) continue;
        for (const part of parts) {
          if (!part || typeof part !== "object") continue;
          // Regular text answer.
          if (typeof part.text === "string" && part.text.length > 0) {
            // Gemini 2.5 reasoning parts are marked `thought: true` and may
            // carry `text` too — discriminate on the flag first. The plain
            // text-channel field is `text`; the alternate thought-carrier
            // schema uses `thought: true` plus `text`. Either way, route the
            // marked one to onReasoning and the rest to the answer stream.
            if (part.thought === true) {
              sawReasoning = true;
              onReasoning?.(part.text);
            } else {
              full += part.text;
              onToken?.(part.text);
            }
          }
          // Some SDK/gateway variants ship thinking as `thoughtText`.
          if (typeof part.thoughtText === "string" && part.thoughtText.length > 0) {
            sawReasoning = true;
            onReasoning?.(part.thoughtText);
          }
          // Tool call — delivered whole, not streamed.
          if (part.functionCall && typeof part.functionCall === "object") {
            const fc = part.functionCall;
            const name = typeof fc.name === "string" ? fc.name : "";
            const id = typeof fc.id === "string" ? fc.id : `call_${callCounter++}`;
            const args = (fc.args && typeof fc.args === "object") ? fc.args as Record<string, unknown> : {};
            toolCalls.push({ id, name, args });
          }
        }
      } catch {
        // Skip malformed keepalive/fragment lines.
      }
    }
  });

  if (full.length === 0 && toolCalls.length === 0 && !sawReasoning) {
    throw new Error(`unexpected ${label} response shape (no content)`);
  }
  return { text: full, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
}
