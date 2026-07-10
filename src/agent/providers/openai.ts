import type { AgentMessage, AgentProvider, AgentResult, GenerateOptions, ProviderErrorInfo } from "../types";
import { parseRetryAfter } from "./opencode";
import { openaiCompatTransport } from "./transports/openaiCompat";
import { toolChoiceForFamily, toolsForOpenAIChat } from "../tools";
import { sanitizeCredential } from "../../util/sanitize";

export type OpenAIAuthMode = "api" | "subs";

export interface OpenAIProviderConfig {
  /** "api" — platform API key (sk-...). "subs" — ChatGPT subscription bearer. */
  authMode: OpenAIAuthMode;
  /** Platform API key (api mode). */
  apiKey: string;
  /** Subscription bearer token (subs mode). */
  subsToken: string;
  /** Chat completions base URL, default https://api.openai.com/v1. */
  baseUrl: string;
  /** Model id, e.g. "gpt-5". */
  model: string;
}

/**
 * OpenAI Chat Completions client with two auth paths:
 *  - "api"   → Authorization: Bearer ${OPENAI_API_KEY}  (platform key)
 *  - "subs"  → Authorization: Bearer ${OPENAI_SUBS_TOKEN} (ChatGPT subscription token)
 *
 * Both modes hit the same /chat/completions endpoint; only the bearer source
 * differs. The user picks a mode via OPENAI_AUTH_MODE (or implicitly: if only
 * one of the two credentials is set, that mode is used).
 */
export class OpenAIProvider implements AgentProvider {
  name = "openai";
  private authMode: OpenAIAuthMode;
  private apiKey: string;
  private subsToken: string;
  private baseUrl: string;
  private model: string;

  constructor(cfg: OpenAIProviderConfig) {
    this.authMode = cfg.authMode;
    this.apiKey = sanitizeCredential(cfg.apiKey);
    this.subsToken = sanitizeCredential(cfg.subsToken);
    this.baseUrl = cfg.baseUrl.trim().replace(/\/+$/, "");
    this.model = cfg.model;
  }

  private bearer(): string {
    if (this.authMode === "api") {
      if (!this.apiKey)
        throw new Error("openai api mode requires OPENAI_API_KEY to be set");
      return this.apiKey;
    }
    if (!this.subsToken)
      throw new Error("openai subs mode requires OPENAI_SUBS_TOKEN to be set");
    return this.subsToken;
  }

  authModeLabel(): string {
    return this.authMode;
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
    if (!this.baseUrl) {
      throw new Error("openai provider requires OPENAI_BASE_URL to be set");
    }
    // Same wire dialect as the opencode openai-compat family — reuse its
    // transport for body building and SSE parsing; only auth differs here.
    const toolsPayload = opts?.tools?.length ? toolsForOpenAIChat(opts.tools) : undefined;
    const choice =
      toolsPayload && opts?.toolChoice ? toolChoiceForFamily("openai-compat", opts.toolChoice.name) : undefined;
    const res = await fetch(openaiCompatTransport.endpoint(this.baseUrl, this.model), {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.bearer()}`,
      },
      body: JSON.stringify(
        openaiCompatTransport.buildBody({
          model: this.model,
          system,
          messages,
          tools: toolsPayload,
          choice,
          // reasoning_effort is not sent from this provider (unchanged
          // behavior) — strip it before the shared body builder.
          opts: opts ? { ...opts, reasoningEffort: undefined } : opts,
        }),
      ),
    });
    if (!res.ok || !res.body) {
      const body = (await res.text()).slice(0, 500);
      const err = new Error(`openai request failed: ${res.status} ${body}`) as Error & ProviderErrorInfo;
      err.status = res.status;
      const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
      if (retryAfterMs !== undefined) err.retryAfterMs = retryAfterMs;
      throw err;
    }
    return openaiCompatTransport.parseSSE(res.body, onToken, "openai", opts?.onReasoning);
  }
}