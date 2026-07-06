import type { AgentProvider } from "../types";

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

type ZenFamily = "anthropic" | "openai-responses" | "openai-compat" | "google";

/**
 * The opencode Zen gateway proxies to different upstream APIs depending on
 * model family — each needs a different endpoint + request/response shape.
 * See https://opencode.ai/zen for the model catalog.
 */
function classifyModel(model: string): ZenFamily {
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
      return new Error(
        `opencode ${this.name}: API key rejected (HTTP ${res.status}). ` +
          `Key [${fp}] was refused — verify it is a valid, active ${this.name} key and that no ` +
          `stale ${envVar} env var is overriding your configured key.${goHint} Server said: ${body}`,
      );
    }
    return new Error(`opencode ${this.name} request failed: ${res.status} ${body}`);
  }

  async generate(
    system: string,
    user: string,
    onToken?: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
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

    switch (family) {
      case "anthropic": {
        const res = await fetch(`${this.baseUrl}/messages`, {
          method: "POST",
          signal,
          headers,
          body: JSON.stringify({
            model: this.model,
            max_tokens: 4096,
            system,
            stream: true,
            messages: [{ role: "user", content: user }],
          }),
        });
        if (!res.ok || !res.body) {
          throw await this.requestFailed(res);
        }
        return consumeAnthropicSseStream(res.body, onToken, label);
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
          }),
        });
        if (!res.ok || !res.body) {
          throw await this.requestFailed(res);
        }
        return consumeResponsesSseStream(res.body, onToken, label);
      }
      case "google": {
        const res = await fetch(`${this.baseUrl}/models/${this.model}`, {
          method: "POST",
          signal,
          headers,
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: user }] }],
            systemInstruction: { parts: [{ text: system }] },
          }),
        });
        if (!res.ok || !res.body) {
          throw await this.requestFailed(res);
        }
        return consumeGoogleSseStream(res.body, onToken, label);
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
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        });
        if (!res.ok || !res.body) {
          throw await this.requestFailed(res);
        }
        return consumeSseStream(res.body, onToken, label);
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
 * Parse a Server-Sent Events stream of OpenAI-shaped chat completion chunks.
 * Each `data:` line is JSON with `choices[0].delta.content` (string|undefined).
 * `data: [DONE]` ends the stream. Returns concatenated content.
 */
export async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  onToken?: (delta: string) => void,
  label = "provider",
): Promise<string> {
  let full = "";
  await readSseEvents(body, (raw) => {
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const data = JSON.parse(payload) as any;
        const delta = data?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          full += delta;
          onToken?.(delta);
        }
      } catch {
        // Skip malformed keepalive/fragment lines.
      }
    }
  });

  if (full.length === 0) {
    throw new Error(`unexpected ${label} response shape (no content)`);
  }
  return full;
}

/**
 * Parse an Anthropic Messages API SSE stream: `content_block_delta` events
 * carry `delta.text`; stream ends at `message_stop`.
 */
async function consumeAnthropicSseStream(
  body: ReadableStream<Uint8Array>,
  onToken?: (delta: string) => void,
  label = "provider",
): Promise<string> {
  let full = "";
  await readSseEvents(body, (raw) => {
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const data = JSON.parse(payload) as any;
        if (data?.type === "content_block_delta" && data?.delta?.type === "text_delta") {
          const delta = data.delta.text;
          if (typeof delta === "string" && delta.length > 0) {
            full += delta;
            onToken?.(delta);
          }
        }
      } catch {
        // Skip malformed keepalive/fragment lines.
      }
    }
  });

  if (full.length === 0) {
    throw new Error(`unexpected ${label} response shape (no content)`);
  }
  return full;
}

/**
 * Parse an OpenAI Responses API SSE stream: `response.output_text.delta`
 * events carry the text chunk directly in `delta`.
 */
async function consumeResponsesSseStream(
  body: ReadableStream<Uint8Array>,
  onToken?: (delta: string) => void,
  label = "provider",
): Promise<string> {
  let full = "";
  await readSseEvents(body, (raw) => {
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const data = JSON.parse(payload) as any;
        if (data?.type === "response.output_text.delta") {
          const delta = data.delta;
          if (typeof delta === "string" && delta.length > 0) {
            full += delta;
            onToken?.(delta);
          }
        }
      } catch {
        // Skip malformed keepalive/fragment lines.
      }
    }
  });

  if (full.length === 0) {
    throw new Error(`unexpected ${label} response shape (no content)`);
  }
  return full;
}

/**
 * Parse a Google generateContent SSE stream: each chunk carries
 * `candidates[0].content.parts[0].text`.
 */
async function consumeGoogleSseStream(
  body: ReadableStream<Uint8Array>,
  onToken?: (delta: string) => void,
  label = "provider",
): Promise<string> {
  let full = "";
  await readSseEvents(body, (raw) => {
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const data = JSON.parse(payload) as any;
        const delta = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof delta === "string" && delta.length > 0) {
          full += delta;
          onToken?.(delta);
        }
      } catch {
        // Skip malformed keepalive/fragment lines.
      }
    }
  });

  if (full.length === 0) {
    throw new Error(`unexpected ${label} response shape (no content)`);
  }
  return full;
}
