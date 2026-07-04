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

  async generate(system: string, user: string): Promise<string> {
    const res = await fetch(`${this.config.url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.config.model,
        format: "json",
        stream: false,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`ollama request failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as any;
    const content = data?.message?.content;
    if (typeof content !== "string") {
      throw new Error("unexpected ollama response shape");
    }
    return content;
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
