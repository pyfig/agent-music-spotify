import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "../src/agent/types";
import type { TransportRequest } from "../src/agent/providers/transports/types";
import { anthropicTransport } from "../src/agent/providers/transports/anthropic";
import { openaiResponsesTransport } from "../src/agent/providers/transports/openaiResponses";
import { openaiCompatTransport } from "../src/agent/providers/transports/openaiCompat";
import { googleTransport } from "../src/agent/providers/transports/google";

// One canonical request serialized by every transport — the snapshots pin the
// per-family wire shapes so a refactor can't silently change a body.
const messages: AgentMessage[] = [
  { role: "user", content: "find tracks" },
  {
    role: "assistant",
    content: "searching",
    toolCalls: [{ id: "call_1", name: "searchTrack", args: { artist: "A", title: "B" } }],
  },
  { role: "tool", callId: "call_1", name: "searchTrack", content: '{"uri":"s:1"}' },
  { role: "user", content: "continue" },
];

const req = (extra: Partial<TransportRequest> = {}): TransportRequest => ({
  model: "test-model",
  system: "sys",
  messages,
  opts: { maxTokens: 1000 },
  ...extra,
});

describe("transport endpoints", () => {
  test("each family posts to its dialect's path", () => {
    expect(anthropicTransport.endpoint("https://b", "m")).toBe("https://b/messages");
    expect(openaiResponsesTransport.endpoint("https://b", "m")).toBe("https://b/responses");
    expect(openaiCompatTransport.endpoint("https://b", "m")).toBe("https://b/chat/completions");
    expect(googleTransport.endpoint("https://b", "m")).toBe("https://b/models/m");
  });
});

describe("transport buildBody snapshots", () => {
  test("anthropic", () => {
    expect(anthropicTransport.buildBody(req())).toMatchSnapshot();
  });

  test("anthropic adds a thinking budget on top of max_tokens (unforced only)", () => {
    const withEffort = anthropicTransport.buildBody(req({ opts: { maxTokens: 1000, reasoningEffort: "low" } })) as any;
    expect(withEffort.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
    expect(withEffort.max_tokens).toBe(3048);
    const forced = anthropicTransport.buildBody(
      req({ choice: { tool_choice: { type: "tool", name: "clarify" } }, opts: { maxTokens: 1000, reasoningEffort: "low" } }),
    ) as any;
    expect(forced.thinking).toBeUndefined();
  });

  test("openai-responses", () => {
    expect(openaiResponsesTransport.buildBody(req())).toMatchSnapshot();
  });

  test("openai-compat", () => {
    expect(openaiCompatTransport.buildBody(req())).toMatchSnapshot();
  });

  test("google", () => {
    expect(googleTransport.buildBody(req())).toMatchSnapshot();
  });
});
