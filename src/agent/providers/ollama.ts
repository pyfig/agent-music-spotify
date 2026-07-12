import type { AgentMessage, AgentProvider, AgentResult, GenerateOptions, ToolCall } from "../types";
import { toolsForOpenAIChat } from "../tools";
import { toOllamaChatMessages } from "./messages";

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
    // Ollama tool support is opt-in via `opts.tools`; old models ignore the
    // field and emit plain JSON text — the loop's JSON fallback covers them.
    const toolsPayload = opts?.tools?.length ? toolsForOpenAIChat(opts.tools) : undefined;
    const request = (think: boolean) =>
      fetch(`${this.config.url}/api/chat`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          format: "json",
          stream: true,
          // Without an explicit `think`, the daemon streams message.thinking
          // for thinking models only on tool-less requests — as soon as
          // `tools` is present it silently drops thinking, so the reasoning
          // view stays blank in agent mode. Ask for it explicitly and fall
          // back below for models that reject the flag.
          ...(think ? { think: true } : {}),
          // Ollama's /api/chat accepts the OpenAI chat shape (role:"tool"
          // history included); models without native tool-role training simply
          // read them as extra context.
          messages: toOllamaChatMessages(system, messages),
          // Ollama loads models with num_ctx=4096 by default; the agent-mode
          // system prompt plus tool schemas alone exceeds that (~5k tokens) and
          // the daemon rejects the request with exceed_context_size_error.
          options: { num_ctx: 16384 },
          ...(toolsPayload ? { tools: toolsPayload } : {}),
        }),
      });
    let res = await request(true);
    if (!res.ok && /does not support thinking/i.test(await res.clone().text())) {
      res = await request(false);
    }
    if (!res.ok || !res.body) {
      throw new Error(`ollama request failed: ${res.status} ${await res.text()}`);
    }

    // NDJSON stream: one JSON object per line, deltas in message.content.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    // tool_call accumulator: Ollama streams tool calls across multiple chunks;
    // `message.tool_calls` may arrive partially keyed by index. We aggregate
    // by index so an interleave with text deltas still assembles correctly.
    const toolCallsByIndex = new Map<number, { id: string; name: string; argsJson: string }>();
    let reasoningAcc = "";
    const consumeLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const data = JSON.parse(trimmed) as any;
      const delta = data?.message?.content;
      if (typeof delta === "string" && delta.length > 0) {
        full += delta;
        onToken?.(delta);
      }
      // Reasoning: some Ollama models (qwen3-thinking, deepseek-r1) emit a
      // top-level `thinking` or `message.reasoning_content` field. Forward it
      // without polluting the answer stream.
      const reasoning = data?.message?.reasoning_content ?? data?.message?.thinking;
      if (typeof reasoning === "string" && reasoning.length > 0) {
        reasoningAcc += reasoning;
        opts?.onReasoning?.(reasoning);
      }
      // Tool calls: Ollama returns `message.tool_calls: [{ function: { name,
      // arguments (string|object) } }]`. `arguments` is sometimes a JSON string
      // which we normalize to a parsed object in the returned `AgentResult`.
      const toolCalls: any[] | undefined = data?.message?.tool_calls;
      if (Array.isArray(toolCalls)) {
        for (let i = 0; i < toolCalls.length; i++) {
          const tc = toolCalls[i];
          if (!tc) continue;
          const name = tc?.function?.name ?? tc?.name;
          if (typeof name !== "string") continue;
          const id = tc?.id ?? `call_${i}`;
          // `arguments` may be a JSON string (streamed delta) or an object.
          const argRaw = tc?.function?.arguments ?? tc?.arguments;
          const argsJson = typeof argRaw === "string" ? argRaw : JSON.stringify(argRaw ?? {});
          const prev = toolCallsByIndex.get(i);
          if (prev) {
            prev.argsJson += argsJson;
          } else {
            toolCallsByIndex.set(i, { id, name, argsJson });
          }
        }
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

    const toolCalls: ToolCall[] = [];
    for (const [, v] of toolCallsByIndex) {
      let args: Record<string, unknown> = {};
      try {
        args = v.argsJson.length ? JSON.parse(v.argsJson) : {};
      } catch {
        // Malformed args: pass through as a literal `_raw` so the loop can
        // surface a tool-result error rather than silently dropping the call.
        args = { _raw: v.argsJson };
      }
      toolCalls.push({ id: v.id, name: v.name, args });
    }

    if (full.length === 0 && toolCalls.length === 0) {
      // Empty reasoning-only turns are not an error — we'll let the loop decide.
      if (reasoningAcc.length === 0) {
        throw new Error("unexpected ollama response shape");
      }
    }
    return { text: full, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
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
