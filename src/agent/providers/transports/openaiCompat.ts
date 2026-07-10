import type { AgentResult } from "../../types";
import { toOpenAIChatMessages } from "../messages";
import { DEFAULT_MAX_TOKENS, readSseEvents, buildToolCalls, type FamilyTransport, type TransportRequest } from "./types";

/**
 * Parse a Server-Sent Events stream of OpenAI-shaped chat completion chunks.
 * Each `data:` line is JSON with `choices[0].delta` carrying `content` (string
 * text answer), `reasoning_content` (o-series reasoning → onReasoning), or
 * `tool_calls` (delta-tool-call fragments accumulated into AgentResult.toolCalls).
 * `data: [DONE]` ends the stream.
 */
export async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  onToken?: (delta: string) => void,
  label = "provider",
  onReasoning?: (delta: string) => void,
): Promise<AgentResult> {
  let full = "";
  const tcAcc = new Map<number | string, { id: string; name: string; args: string }>();
  let sawReasoning = false;
  await readSseEvents(body, (raw) => {
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const data = JSON.parse(payload) as any;
        const delta = data?.choices?.[0]?.delta;
        if (!delta) continue;
        if (typeof delta.content === "string" && delta.content.length > 0) {
          full += delta.content;
          onToken?.(delta.content);
        }
        if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
          sawReasoning = true;
          onReasoning?.(delta.reasoning_content);
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const d of delta.tool_calls) {
            const idx = typeof d?.index === "number" ? d.index : 0;
            const prev = tcAcc.get(idx);
            const name = d?.function?.name;
            const id = d?.id ?? prev?.id ?? `call_${idx}`;
            const args = d?.function?.arguments ?? "";
            if (prev) {
              prev.args += typeof args === "string" ? args : "";
            } else if (typeof name === "string") {
              tcAcc.set(idx, { id, name, args: typeof args === "string" ? args : "" });
            }
          }
        }
      } catch {
        // Skip malformed keepalive/fragment lines.
      }
    }
  });

  const toolCalls = buildToolCalls(tcAcc);
  if (full.length === 0 && toolCalls.length === 0 && !sawReasoning) {
    throw new Error(`unexpected ${label} response shape (no content)`);
  }
  return { text: full, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
}

export const openaiCompatTransport: FamilyTransport = {
  endpoint: (baseUrl) => `${baseUrl}/chat/completions`,
  buildBody: ({ model, system, messages, tools, choice, opts }: TransportRequest) => ({
    model,
    stream: true,
    max_completion_tokens: opts?.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: toOpenAIChatMessages(system, messages),
    ...(tools ? { tools, tool_choice: "auto" } : {}),
    ...(choice ?? {}),
    ...(opts?.reasoningEffort
      ? { reasoning_effort: opts.reasoningEffort === "none" ? "minimal" : opts.reasoningEffort }
      : {}),
  }),
  parseSSE: consumeSseStream,
};
