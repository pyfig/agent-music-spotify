import type { AgentResult, ToolCall } from "../../types";
import { toAnthropicMessages } from "../messages";
import { DEFAULT_MAX_TOKENS, REASONING_BUDGET_TOKENS, readSseEvents, type FamilyTransport, type TransportRequest } from "./types";

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

export const anthropicTransport: FamilyTransport = {
  endpoint: (baseUrl) => `${baseUrl}/messages`,
  buildBody: ({ model, system, messages, tools, choice, opts }: TransportRequest) => {
    // Anthropic rejects extended thinking combined with a forced tool_choice
    // (thinking only allows tool_choice: auto) — when a forced choice is
    // present, skip the thinking budget entirely so forcing wins.
    const budget =
      opts?.reasoningEffort && opts.reasoningEffort !== "none" && !choice
        ? REASONING_BUDGET_TOKENS[opts.reasoningEffort]
        : undefined;
    const baseMax = opts?.maxTokens ?? DEFAULT_MAX_TOKENS;
    return {
      model,
      max_tokens: budget ? baseMax + budget : baseMax,
      system,
      stream: true,
      messages: toAnthropicMessages(messages),
      ...(tools ? { tools } : {}),
      ...(choice ?? {}),
      ...(budget ? { thinking: { type: "enabled", budget_tokens: budget } } : {}),
    };
  },
  parseSSE: consumeAnthropicSseStream,
};
