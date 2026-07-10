import type { AgentMessage, AgentProvider, AgentResult, GenerateOptions, ProviderErrorInfo } from "../types";
import { toolChoiceForFamily, toolsForFamily } from "../tools";
import { sanitizeCredential } from "../../util/sanitize";
import type { FamilyTransport } from "./transports/types";
import { anthropicTransport } from "./transports/anthropic";
import { openaiResponsesTransport } from "./transports/openaiResponses";
import { openaiCompatTransport } from "./transports/openaiCompat";
import { googleTransport } from "./transports/google";

// Re-exported for the standalone OpenAI provider, which shares the
// chat-completions dialect.
export { consumeSseStream } from "./transports/openaiCompat";

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

const TRANSPORTS: Record<ZenFamily, FamilyTransport> = {
  anthropic: anthropicTransport,
  "openai-responses": openaiResponsesTransport,
  "openai-compat": openaiCompatTransport,
  google: googleTransport,
};

/**
 * Client for opencode hosted models: classifyModel picks the family, the
 * matching FamilyTransport does all serialization/parsing, and this class
 * keeps only what is provider-specific — bearer auth, actionable 401/403
 * errors, retry metadata, and the 400 degrade-and-retry policy.
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
    return this.generateMessages(system, [{ role: "user", content: user }], onToken, signal, opts);
  }

  async generateMessages(
    system: string,
    messages: AgentMessage[],
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
    const transport = TRANSPORTS[family];
    const tools = opts?.tools?.length ? toolsForFamily(family, opts.tools) : undefined;
    // Forced tool choice (e.g. first-turn clarify), in the family's native shape.
    const forced = tools && opts?.toolChoice ? toolChoiceForFamily(family, opts.toolChoice.name) : undefined;

    try {
      return await this.request(transport, system, messages, tools, forced, onToken, signal, opts);
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
        return this.request(transport, system, messages, tools, undefined, onToken, signal, degraded);
      }
      throw e;
    }
  }

  private async request(
    transport: FamilyTransport,
    system: string,
    messages: AgentMessage[],
    tools: unknown,
    choice: Record<string, unknown> | undefined,
    onToken?: (delta: string) => void,
    signal?: AbortSignal,
    opts?: GenerateOptions,
  ): Promise<AgentResult> {
    const res = await fetch(transport.endpoint(this.baseUrl, this.model), {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(transport.buildBody({ model: this.model, system, messages, tools, choice, opts })),
    });
    if (!res.ok || !res.body) {
      throw await this.requestFailed(res);
    }
    return transport.parseSSE(res.body, onToken, `opencode ${this.name}`, opts?.onReasoning);
  }
}
