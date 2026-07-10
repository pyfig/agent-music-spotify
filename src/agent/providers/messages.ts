import type { AgentMessage } from "../types";

/**
 * Per-family wire mappings for the canonical `AgentMessage[]` history. Each
 * provider serializes tool calls/results in its API's native format so the
 * model sees real multi-turn structure (call_id-linked results) instead of a
 * re-joined user string. Kept in one module so the shapes are testable in
 * isolation and reusable across providers (opencode routes 4 families; the
 * standalone openai/ollama providers share the chat-completions shape).
 */

/** OpenAI Chat Completions / Ollama: assistant.tool_calls + role:"tool" messages. */
export function toOpenAIChatMessages(system: string, messages: AgentMessage[]): unknown[] {
  const out: unknown[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        // Chat Completions rejects an assistant turn that is both empty and
        // tool-call-free; null content with tool_calls is the documented shape.
        content: m.content.length > 0 ? m.content : null,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((tc) => ({
                id: tc.id,
                type: "function",
                function: { name: tc.name, arguments: JSON.stringify(tc.args) },
              })),
            }
          : {}),
      });
    } else {
      out.push({ role: "tool", tool_call_id: m.callId, content: m.content });
    }
  }
  return out;
}

/** Anthropic Messages: tool_use blocks on assistant turns, tool_result blocks
 * grouped into the following user turn (the API requires results to open the
 * very next message, one user turn per batch). */
export function toAnthropicMessages(messages: AgentMessage[]): unknown[] {
  const out: { role: string; content: unknown }[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const blocks: unknown[] = [];
      if (m.content.length > 0) blocks.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls ?? []) {
        blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args });
      }
      // An all-empty assistant turn is invalid; represent it as a stub so the
      // conversation stays alternating.
      out.push({ role: "assistant", content: blocks.length > 0 ? blocks : [{ type: "text", text: "…" }] });
    } else {
      const block = {
        type: "tool_result",
        tool_use_id: m.callId,
        content: m.content,
        ...(m.isError ? { is_error: true } : {}),
      };
      const prev = out[out.length - 1];
      // Consecutive tool results merge into one user turn.
      if (prev && prev.role === "user" && Array.isArray(prev.content)) {
        (prev.content as unknown[]).push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    }
  }
  return out;
}

/** OpenAI Responses: flat input item list with function_call / function_call_output items. */
export function toResponsesInput(messages: AgentMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      if (m.content.length > 0) out.push({ role: "assistant", content: m.content });
      for (const tc of m.toolCalls ?? []) {
        out.push({
          type: "function_call",
          call_id: tc.id,
          name: tc.name,
          arguments: JSON.stringify(tc.args),
        });
      }
    } else {
      out.push({ type: "function_call_output", call_id: m.callId, output: m.content });
    }
  }
  return out;
}

/** Google generateContent: model-role functionCall parts, user-role functionResponse parts. */
export function toGoogleContents(messages: AgentMessage[]): unknown[] {
  const out: { role: string; parts: unknown[] }[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", parts: [{ text: m.content }] });
    } else if (m.role === "assistant") {
      const parts: unknown[] = [];
      if (m.content.length > 0) parts.push({ text: m.content });
      for (const tc of m.toolCalls ?? []) {
        parts.push({ functionCall: { name: tc.name, args: tc.args } });
      }
      out.push({ role: "model", parts: parts.length > 0 ? parts : [{ text: "…" }] });
    } else {
      const part = {
        functionResponse: {
          name: m.name,
          response: m.isError ? { error: m.content } : { result: m.content },
        },
      };
      const prev = out[out.length - 1];
      if (prev && prev.role === "user" && (prev.parts[0] as { functionResponse?: unknown })?.functionResponse) {
        prev.parts.push(part);
      } else {
        out.push({ role: "user", parts: [part] });
      }
    }
  }
  return out;
}

/**
 * Text fallback for providers with no history wire format (claude-cli): the
 * whole conversation flattened to a single prompt string, tool results tagged
 * with their call_id so the model can still correlate them.
 */
export function joinMessagesAsText(messages: AgentMessage[]): string {
  return messages
    .map((m) => {
      if (m.role === "user") return m.content;
      if (m.role === "assistant") {
        const callLines = (m.toolCalls ?? []).map(
          (tc) => `[called ${tc.name} (call_id=${tc.id}) with ${JSON.stringify(tc.args)}]`,
        );
        return [m.content, ...callLines].filter((s) => s.length > 0).join("\n");
      }
      return `Tool ${m.name} ${m.isError ? "error" : "result"} (call_id=${m.callId}): ${m.content}`;
    })
    .filter((s) => s.length > 0)
    .join("\n\n");
}
