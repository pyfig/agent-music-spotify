import type { AgentMessage, AgentResult, GenerateOptions, ToolCall } from "../../types";

/** Provider-local default response cap when the caller doesn't set opts.maxTokens. */
export const DEFAULT_MAX_TOKENS = 4096;

/** Token budget backing each reasoningEffort tier — used directly as
 * Anthropic's thinking.budget_tokens / Google's thinkingConfig.thinkingBudget. */
export const REASONING_BUDGET_TOKENS: Record<"none" | "low" | "medium" | "high", number> = {
  none: 0,
  low: 2048,
  medium: 6000,
  high: 12000,
};

/** Everything a transport needs to serialize one generation request. `tools`
 * and `choice` arrive already family-shaped (toolsForFamily /
 * toolChoiceForFamily) so transports stay pure request/response codecs. */
export interface TransportRequest {
  model: string;
  system: string;
  messages: AgentMessage[];
  tools?: unknown;
  choice?: Record<string, unknown>;
  opts?: GenerateOptions;
}

/**
 * One API dialect behind the opencode gateway (or any compatible upstream):
 * where to POST, how to serialize the request, how to parse the SSE reply.
 * Auth, retries, and error decoration stay in the provider — transports are
 * stateless and individually unit-testable.
 */
export interface FamilyTransport {
  endpoint(baseUrl: string, model: string): string;
  buildBody(req: TransportRequest): unknown;
  parseSSE(
    stream: ReadableStream<Uint8Array>,
    onToken?: (delta: string) => void,
    label?: string,
    onReasoning?: (delta: string) => void,
  ): Promise<AgentResult>;
}

/** Reads an SSE byte stream, dispatching each complete `data: ...\n\n` event to `onEvent`. */
export async function readSseEvents(
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
 * Turn a per-key accreted tool-call fragment map into `ToolCall[]`. Each
 * entry's `args` is JSON-parsed; malformed JSON is fed through as `{_raw}` so
 * the loop surfaces a tool-result error instead of dropping the call silently.
 */
export function buildToolCalls(acc: Map<number | string, { id: string; name: string; args: string }>): ToolCall[] {
  const out: ToolCall[] = [];
  for (const [, v] of acc) {
    let args: Record<string, unknown> = {};
    try {
      args = v.args.length ? JSON.parse(v.args) : {};
    } catch {
      args = { _raw: v.args };
    }
    out.push({ id: v.id, name: v.name, args });
  }
  return out;
}
