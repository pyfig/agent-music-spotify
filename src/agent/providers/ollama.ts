import type { AgentProvider } from "../types";

export interface OllamaConfig {
  url: string;
  model: string;
}

export class OllamaProvider implements AgentProvider {
  name = "ollama";
  private config: OllamaConfig;

  constructor(config: OllamaConfig) {
    this.config = config;
  }

  async generate(
    system: string,
    user: string,
    onToken?: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const res = await fetch(`${this.config.url}/api/chat`, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.config.model,
        format: "json",
        stream: true,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`ollama request failed: ${res.status} ${await res.text()}`);
    }

    // NDJSON stream: one JSON object per line, deltas in message.content.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    const consumeLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const data = JSON.parse(trimmed) as any;
      const delta = data?.message?.content;
      if (typeof delta === "string" && delta.length > 0) {
        full += delta;
        onToken?.(delta);
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        consumeLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    }
    consumeLine(buffer);

    if (full.length === 0) {
      throw new Error("unexpected ollama response shape");
    }
    return full;
  }
}

/** List locally available ollama models; empty array if daemon unreachable. */
export async function listOllamaModels(url: string): Promise<string[]> {
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    return (data.models ?? []).map((m: any) => m.name as string);
  } catch {
    return [];
  }
}
