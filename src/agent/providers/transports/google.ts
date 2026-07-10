import type { AgentResult, ToolCall } from "../../types";
import { toGoogleContents } from "../messages";
import { DEFAULT_MAX_TOKENS, REASONING_BUDGET_TOKENS, readSseEvents, type FamilyTransport, type TransportRequest } from "./types";

/**
 * Parse a Google generateContent SSE stream (Gemini):
 *  - Each chunk → `candidates[0].content.parts[]`
 *  - Part with `text` → answer text
 *  - Part with `thought: true` (or `thoughtText`) → Gemini 2.5 reasoning
 *  - Part with `functionCall: {name, args}` → non-streamed, complete tool call
 *  - Gemini ships tool args already-assembled as a JSON object, no accretion needed.
 */
async function consumeGoogleSseStream(
  body: ReadableStream<Uint8Array>,
  onToken?: (delta: string) => void,
  label = "provider",
  onReasoning?: (delta: string) => void,
): Promise<AgentResult> {
  let full = "";
  const toolCalls: ToolCall[] = [];
  let sawReasoning = false;
  // Gemini assigns explicit ids to multi-turn tool calls via `functionCall.id`.
  // When absent, synthesize a positional id.
  let callCounter = 0;
  await readSseEvents(body, (raw) => {
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const data = JSON.parse(payload) as any;
        const parts: any[] | undefined = data?.candidates?.[0]?.content?.parts;
        if (!Array.isArray(parts)) continue;
        for (const part of parts) {
          if (!part || typeof part !== "object") continue;
          // Regular text answer.
          if (typeof part.text === "string" && part.text.length > 0) {
            // Gemini 2.5 reasoning parts are marked `thought: true` and may
            // carry `text` too — discriminate on the flag first. The plain
            // text-channel field is `text`; the alternate thought-carrier
            // schema uses `thought: true` plus `text`. Either way, route the
            // marked one to onReasoning and the rest to the answer stream.
            if (part.thought === true) {
              sawReasoning = true;
              onReasoning?.(part.text);
            } else {
              full += part.text;
              onToken?.(part.text);
            }
          }
          // Some SDK/gateway variants ship thinking as `thoughtText`.
          if (typeof part.thoughtText === "string" && part.thoughtText.length > 0) {
            sawReasoning = true;
            onReasoning?.(part.thoughtText);
          }
          // Tool call — delivered whole, not streamed.
          if (part.functionCall && typeof part.functionCall === "object") {
            const fc = part.functionCall;
            const name = typeof fc.name === "string" ? fc.name : "";
            const id = typeof fc.id === "string" ? fc.id : `call_${callCounter++}`;
            const args = (fc.args && typeof fc.args === "object") ? fc.args as Record<string, unknown> : {};
            toolCalls.push({ id, name, args });
          }
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

export const googleTransport: FamilyTransport = {
  endpoint: (baseUrl, model) => `${baseUrl}/models/${model}`,
  buildBody: ({ system, messages, tools, choice, opts }: TransportRequest) => ({
    contents: toGoogleContents(messages),
    systemInstruction: { parts: [{ text: system }] },
    generationConfig: {
      maxOutputTokens: opts?.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(opts?.reasoningEffort
        ? { thinkingConfig: { thinkingBudget: REASONING_BUDGET_TOKENS[opts.reasoningEffort] } }
        : {}),
    },
    ...(tools ? { tools } : {}),
    ...(choice ?? {}),
  }),
  parseSSE: consumeGoogleSseStream,
};
