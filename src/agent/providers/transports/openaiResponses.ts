import type { AgentResult, ToolCall } from "../../types";
import { toResponsesInput } from "../messages";
import { DEFAULT_MAX_TOKENS, readSseEvents, type FamilyTransport, type TransportRequest } from "./types";

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
            } else {
              // No name yet is fine — stash empty to fill in later.
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

export const openaiResponsesTransport: FamilyTransport = {
  endpoint: (baseUrl) => `${baseUrl}/responses`,
  buildBody: ({ model, system, messages, tools, choice, opts }: TransportRequest) => ({
    model,
    instructions: system,
    input: toResponsesInput(messages),
    stream: true,
    max_output_tokens: opts?.maxTokens ?? DEFAULT_MAX_TOKENS,
    ...(tools ? { tools } : {}),
    ...(choice ?? {}),
    ...(opts?.reasoningEffort
      ? { reasoning: { effort: opts.reasoningEffort === "none" ? "minimal" : opts.reasoningEffort } }
      : {}),
  }),
  parseSSE: consumeResponsesSseStream,
};
