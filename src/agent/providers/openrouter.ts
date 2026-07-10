import type { AgentMessage, AgentProvider, AgentResult, GenerateOptions, ProviderErrorInfo } from "../types";
import { parseRetryAfter } from "./opencode";
import { openaiCompatTransport } from "./transports/openaiCompat";
import { toolChoiceForFamily, toolsForOpenAIChat } from "../tools";
import { sanitizeCredential } from "../../util/sanitize";

export interface OpenRouterProviderConfig {
  /** OpenRouter API key (sk-or-...). */
  apiKey: string;
  /** Chat completions base URL, default https://openrouter.ai/api/v1. */
  baseUrl: string;
  /** Model id, e.g. "anthropic/claude-sonnet-4" or "openrouter/auto". */
  model: string;
}

/**
 * OpenRouter — OpenAI-compatible /chat/completions over the openrouter.ai
 * gateway. Single API key, model ids are vendor-prefixed ("anthropic/...",
 * "openai/...", or "openrouter/auto" to let the router pick). Same wire
 * dialect as the openai-compat family, so the shared transport does body
 * building and SSE parsing; only auth + attribution headers differ.
 */
export class OpenRouterProvider implements AgentProvider {
  name = "openrouter";
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(cfg: OpenRouterProviderConfig) {
    this.apiKey = sanitizeCredential(cfg.apiKey);
    this.baseUrl = cfg.baseUrl.trim().replace(/\/+$/, "");
    this.model = cfg.model;
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
      throw new Error("openrouter provider requires OPENROUTER_API_KEY to be set");
    }
    if (!this.baseUrl) {
      throw new Error("openrouter provider requires OPENROUTER_BASE_URL to be set");
    }
    const toolsPayload = opts?.tools?.length ? toolsForOpenAIChat(opts.tools) : undefined;
    const choice =
      toolsPayload && opts?.toolChoice ? toolChoiceForFamily("openai-compat", opts.toolChoice.name) : undefined;
    const res = await fetch(openaiCompatTransport.endpoint(this.baseUrl, this.model), {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
        // OpenRouter attribution headers (optional but recommended by their docs).
        "http-referer": "https://github.com/pyfig/spotify-harness-tui",
        "x-title": "music-agent",
      },
      body: JSON.stringify(
        openaiCompatTransport.buildBody({
          model: this.model,
          system,
          messages,
          tools: toolsPayload,
          choice,
          // reasoning_effort is not universally supported across routed
          // models — strip it before the shared body builder.
          opts: opts ? { ...opts, reasoningEffort: undefined } : opts,
        }),
      ),
    });
    if (!res.ok || !res.body) {
      const body = (await res.text()).slice(0, 500);
      const err = new Error(`openrouter request failed: ${res.status} ${body}`) as Error & ProviderErrorInfo;
      err.status = res.status;
      const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
      if (retryAfterMs !== undefined) err.retryAfterMs = retryAfterMs;
      throw err;
    }
    return openaiCompatTransport.parseSSE(res.body, onToken, "openrouter", opts?.onReasoning);
  }
}
