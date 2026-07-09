/** A JSON-schema parameter set describing a single tool the agent can call. */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON-Schema params object (no `$schema`, no outer `type: object` wrapper required — providers normalize). */
  parameters: Record<string, unknown>;
}

/** One completed (non-streamed) tool call a provider surfaced in its response. */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** Structured agent response: free-text (possibly empty) plus any tool calls. */
export interface AgentResult {
  text: string;
  toolCalls?: ToolCall[];
}

/**
 * One ordered event in the agent's reasoning transcript. Reasoning deltas,
 * tool calls, and tool results are emitted in call order so the UI can render
 * a chat-style log (reasoning → tool call → result) instead of a flat tail.
 */
export type AgentEvent =
  | { kind: "reasoning"; delta: string }
  | { kind: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { kind: "tool_result"; id: string; name: string; ok: boolean; result: unknown };

/** Optional harness knobs passed to `AgentProvider.generate`. */
export interface GenerateOptions {
  /** Tool specs surfaced to the model when the provider supports function-calling; ignored otherwise. */
  tools?: ToolSpec[];
  /** Streaming reasoning/thinking deltas; backends forward these separately from the text answer. */
  onReasoning?: (delta: string) => void;
  /** Force the model to call this specific tool on this generation. Providers
   * without a native tool-choice mechanism ignore it (graceful degradation). */
  toolChoice?: { name: string };
  /** Cap on response tokens. Providers map this to their family's field name
   * (max_tokens / max_output_tokens / max_completion_tokens / generationConfig.maxOutputTokens).
   * Falls back to a provider-local default (4096) when unset. */
  maxTokens?: number;
  /** Hint for how much the model should "think" before answering. Providers
   * without a native knob ignore it. Mechanical turns (rescue, hard-demand,
   * bounced retries, forced first-turn clarify) use "low"; research turns
   * leave this undefined so curation quality doesn't regress. */
  reasoningEffort?: "none" | "low" | "medium" | "high";
}

/** Optional metadata a provider attaches to a thrown Error so loop.ts's
 * retry policy can act on real signals instead of message-sniffing alone. */
export interface ProviderErrorInfo {
  status?: number;
  retryAfterMs?: number;
}

export interface AgentProvider {
  name: string;
  generate(
    system: string,
    user: string,
    onToken?: (delta: string) => void,
    signal?: AbortSignal,
    opts?: GenerateOptions,
  ): Promise<AgentResult>;
}

/** Convenience: legacy callers that only want the text tail of a generation. */
export async function generateText(
  provider: AgentProvider,
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<string> {
  const result = await provider.generate(system, user, undefined, signal);
  return result.text;
}