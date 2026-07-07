import type { AgentProvider, AgentResult, GenerateOptions } from "../types";
import { consumeSseStream } from "./opencode";
import { toolChoiceForFamily, toolsForOpenAIChat } from "../tools";

/** Strips paste artifacts (whitespace, wrapping quotes, "Bearer " prefix) that turn a valid key into a rejected one. */
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
    if (!this.baseUrl) {
      throw new Error("openai provider requires OPENAI_BASE_URL to be set");
    }
    const toolsPayload = opts?.tools?.length ? toolsForOpenAIChat(opts.tools) : undefined;
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.bearer()}`,
      },
      body: JSON.stringify({
        model: this.model,
        stream: true,
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
      throw new Error(
        `openai request failed: ${res.status} ${await res.text()}`,
      );
    }
    return consumeSseStream(res.body, onToken, "openai", opts?.onReasoning, Boolean(toolsPayload));
  }
}