import { afterEach, describe, expect, test } from "bun:test";
import { OpencodeProvider } from "../src/agent/providers/opencode";
import { MUSIC_AGENT_TOOLS } from "../src/agent/tools";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function sseResponse(events: string[]): Response {
  const body = events.map((e) => `data: ${e}\n\n`).join("");
  return new Response(body, { status: 200 });
}

function mockFetch(): { calls: { url: string; body: any }[]; respond: (res: Response) => void } {
  const calls: { url: string; body: any }[] = [];
  let response: Response = new Response("", { status: 200 });
  globalThis.fetch = (async (input: any, init: any) => {
    calls.push({ url: String(input), body: JSON.parse(init.body) });
    return response;
  }) as typeof fetch;
  return {
    calls,
    respond: (res: Response) => {
      response = res;
    },
  };
}

describe("OpencodeProvider model-family routing", () => {
  test("openai-compat family (glm) hits /chat/completions, parses choices[].delta.content", async () => {
    const { calls, respond } = mockFetch();
    respond(
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "hel" } }] }),
        JSON.stringify({ choices: [{ delta: { content: "lo" } }] }),
        "[DONE]",
      ]),
    );
    const provider = new OpencodeProvider({
      name: "opencode-go",
      apiKey: "k",
      baseUrl: "https://opencode.ai/zen/v1",
      model: "glm-5.2",
    });
    const result = await provider.generate("sys", "hi");
    const text = result.text;
    expect(text).toBe("hello");
    expect(calls[0]!.url).toBe("https://opencode.ai/zen/v1/chat/completions");
    expect(calls[0]!.body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]);
  });

  test("anthropic family (claude) hits /messages, parses content_block_delta", async () => {
    const { calls, respond } = mockFetch();
    respond(
      sseResponse([
        JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hel" } }),
        JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "lo" } }),
        JSON.stringify({ type: "message_stop" }),
      ]),
    );
    const provider = new OpencodeProvider({
      name: "opencode-zen",
      apiKey: "k",
      baseUrl: "https://opencode.ai/zen/v1",
      model: "claude-sonnet-5",
    });
    const result = await provider.generate("sys", "hi");
    const text = result.text;
    expect(text).toBe("hello");
    expect(calls[0]!.url).toBe("https://opencode.ai/zen/v1/messages");
    expect(calls[0]!.body.system).toBe("sys");
    expect(calls[0]!.body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  test("openai-responses family (gpt-5.x) hits /responses, parses response.output_text.delta", async () => {
    const { calls, respond } = mockFetch();
    respond(
      sseResponse([
        JSON.stringify({ type: "response.output_text.delta", delta: "hel" }),
        JSON.stringify({ type: "response.output_text.delta", delta: "lo" }),
      ]),
    );
    const provider = new OpencodeProvider({
      name: "opencode-zen",
      apiKey: "k",
      baseUrl: "https://opencode.ai/zen/v1",
      model: "gpt-5.5",
    });
    const result = await provider.generate("sys", "hi");
    const text = result.text;
    expect(text).toBe("hello");
    expect(calls[0]!.url).toBe("https://opencode.ai/zen/v1/responses");
    expect(calls[0]!.body.instructions).toBe("sys");
    expect(calls[0]!.body.input).toEqual([{ role: "user", content: "hi" }]);
  });

  test("anthropic family (minimax) hits /messages, parses content_block_delta", async () => {
    const { calls, respond } = mockFetch();
    respond(
      sseResponse([
        JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hel" } }),
        JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "lo" } }),
        JSON.stringify({ type: "message_stop" }),
      ]),
    );
    const provider = new OpencodeProvider({
      name: "opencode-go",
      apiKey: "k",
      baseUrl: "https://opencode.ai/zen/go/v1",
      model: "minimax-m3",
    });
    const result = await provider.generate("sys", "hi");
    const text = result.text;
    expect(text).toBe("hello");
    expect(calls[0]!.url).toBe("https://opencode.ai/zen/go/v1/messages");
  });

  test("google family (gemini) hits /models/<id>, parses candidates[].content.parts[].text", async () => {
    const { calls, respond } = mockFetch();
    respond(
      sseResponse([
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "hel" }] } }] }),
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "lo" }] } }] }),
      ]),
    );
    const provider = new OpencodeProvider({
      name: "opencode-zen",
      apiKey: "k",
      baseUrl: "https://opencode.ai/zen/v1",
      model: "gemini-2.5-pro",
    });
    const result = await provider.generate("sys", "hi");
    const text = result.text;
    expect(text).toBe("hello");
    expect(calls[0]!.url).toBe("https://opencode.ai/zen/v1/models/gemini-2.5-pro");
    expect(calls[0]!.body.systemInstruction.parts[0].text).toBe("sys");
  });

  test("throws clear error when apiKey missing", async () => {
    const provider = new OpencodeProvider({
      name: "opencode-zen",
      apiKey: "",
      baseUrl: "https://opencode.ai/zen/v1",
      model: "claude-sonnet-5",
    });
    expect(provider.generate("sys", "hi")).rejects.toThrow(/OPENCODE_API_KEY/);
  });
});

describe("OpencodeProvider credential sanitization", () => {
  test("trims whitespace, quotes, and a leading Bearer prefix off apiKey/baseUrl", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" } }] }), "[DONE]"]));
    const provider = new OpencodeProvider({
      name: "opencode-go",
      apiKey: '  "Bearer sk-test-key"\n',
      baseUrl: "  https://opencode.ai/zen/go/v1/ \n",
      model: "glm-5.2",
    });
    await provider.generate("sys", "hi");
    expect(calls[0]!.url).toBe("https://opencode.ai/zen/go/v1/chat/completions");
  });

  test("401 response yields an actionable 'API key rejected' error, not the raw body alone", async () => {
    const { respond } = mockFetch();
    respond(new Response(JSON.stringify({ type: "error", error: { message: "invalid key" } }), { status: 401 }));
    const provider = new OpencodeProvider({
      name: "opencode-go",
      apiKey: "sk-abcd1234",
      baseUrl: "https://opencode.ai/zen/go/v1",
      model: "glm-5.2",
    });
    let message = "";
    try {
      await provider.generate("sys", "hi");
      throw new Error("expected generate() to reject");
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/API key rejected/);
    expect(message).toMatch(/1234/);
    expect(message).toMatch(/OPENCODE_GO_API_KEY/);
    expect(message).toMatch(/opencode\/opencode#17541/);
  });

  test("401 response for opencode-zen does not include the Go-specific #17541 hint", async () => {
    const { respond } = mockFetch();
    respond(new Response(JSON.stringify({ type: "error", error: { message: "invalid key" } }), { status: 401 }));
    const provider = new OpencodeProvider({
      name: "opencode-zen",
      apiKey: "sk-abcd1234",
      baseUrl: "https://opencode.ai/zen/v1",
      model: "glm-5.2",
    });
    let message = "";
    try {
      await provider.generate("sys", "hi");
      throw new Error("expected generate() to reject");
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/API key rejected/);
    expect(message).not.toMatch(/#17541/);
  });
});

describe("OpencodeProvider tool-calling: opts.tools makes the request carry tools", () => {
  test("openai-compat: the chat/completions body includes `tools` matching the spec family", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" } }] }), "[DONE]"]));
    const provider = new OpencodeProvider({
      name: "opencode-go",
      apiKey: "k",
      baseUrl: "https://opencode.ai/zen/go/v1",
      model: "glm-5.2",
    });
    await provider.generate("sys", "hi", undefined, undefined, { tools: MUSIC_AGENT_TOOLS });
    const body = calls[0]!.body as any;
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools.length).toBe(MUSIC_AGENT_TOOLS.length);
    // First slot is the function-tool shape for OpenAI Chat Completions.
    expect(body.tools[0].type).toBe("function");
    expect(body.tools[0].function.name).toBe(MUSIC_AGENT_TOOLS[0]!.name);
    // First-call are present; auto pick confirmed.
    expect(body.tool_choice).toBe("auto");
  });

  test("anthropic: the /messages body includes `tools` in Anthropic shape (input_schema)", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } }), JSON.stringify({ type: "message_stop" })]));
    const provider = new OpencodeProvider({
      name: "opencode-zen",
      apiKey: "k",
      baseUrl: "https://opencode.ai/zen/v1",
      model: "claude-sonnet-5",
    });
    await provider.generate("sys", "hi", undefined, undefined, { tools: MUSIC_AGENT_TOOLS });
    const body = calls[0]!.body as any;
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools[0].input_schema).toEqual(MUSIC_AGENT_TOOLS[0]!.parameters);
  });

  test("openai-responses: the /responses body includes `tools` in Responses shape", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ type: "response.output_text.delta", delta: "hi" })]));
    const provider = new OpencodeProvider({
      name: "opencode-zen",
      apiKey: "k",
      baseUrl: "https://opencode.ai/zen/v1",
      model: "gpt-5.5",
    });
    await provider.generate("sys", "hi", undefined, undefined, { tools: MUSIC_AGENT_TOOLS });
    const body = calls[0]!.body as any;
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools[0].name).toBe(MUSIC_AGENT_TOOLS[0]!.name);
    expect(body.tools[0].strict).toBe(false);
  });

  test("google: the /models/<m> body includes `tools.functionDeclarations`", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ candidates: [{ content: { parts: [{ text: "hi" }] } }] })]));
    const provider = new OpencodeProvider({
      name: "opencode-zen",
      apiKey: "k",
      baseUrl: "https://opencode.ai/zen/v1",
      model: "gemini-2.5-pro",
    });
    await provider.generate("sys", "hi", undefined, undefined, { tools: MUSIC_AGENT_TOOLS });
    const body = calls[0]!.body as any;
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools[0].functionDeclarations.length).toBe(MUSIC_AGENT_TOOLS.length);
  });

  test("openai-compat: opts.toolChoice forces the named function and overrides 'auto'", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" } }] }), "[DONE]"]));
    const provider = new OpencodeProvider({
      name: "opencode-go",
      apiKey: "k",
      baseUrl: "https://opencode.ai/zen/go/v1",
      model: "deepseek-v4-pro",
    });
    await provider.generate("sys", "hi", undefined, undefined, {
      tools: MUSIC_AGENT_TOOLS,
      toolChoice: { name: "clarify" },
    });
    const body = calls[0]!.body as any;
    expect(body.tool_choice).toEqual({ type: "function", function: { name: "clarify" } });
    expect(body.tool_choice).not.toBe("auto");
  });

  test("anthropic: opts.toolChoice becomes tool_choice {type:'tool', name}", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } }), JSON.stringify({ type: "message_stop" })]));
    const provider = new OpencodeProvider({
      name: "opencode-zen",
      apiKey: "k",
      baseUrl: "https://opencode.ai/zen/v1",
      model: "claude-sonnet-5",
    });
    await provider.generate("sys", "hi", undefined, undefined, {
      tools: MUSIC_AGENT_TOOLS,
      toolChoice: { name: "clarify" },
    });
    const body = calls[0]!.body as any;
    expect(body.tool_choice).toEqual({ type: "tool", name: "clarify" });
  });

  test("openai-responses: opts.toolChoice becomes tool_choice {type:'function', name}", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ type: "response.output_text.delta", delta: "hi" })]));
    const provider = new OpencodeProvider({
      name: "opencode-zen",
      apiKey: "k",
      baseUrl: "https://opencode.ai/zen/v1",
      model: "gpt-5.5",
    });
    await provider.generate("sys", "hi", undefined, undefined, {
      tools: MUSIC_AGENT_TOOLS,
      toolChoice: { name: "clarify" },
    });
    const body = calls[0]!.body as any;
    expect(body.tool_choice).toEqual({ type: "function", name: "clarify" });
  });

  test("google: opts.toolChoice becomes toolConfig ANY with allowedFunctionNames", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ candidates: [{ content: { parts: [{ text: "hi" }] } }] })]));
    const provider = new OpencodeProvider({
      name: "opencode-zen",
      apiKey: "k",
      baseUrl: "https://opencode.ai/zen/v1",
      model: "gemini-2.5-pro",
    });
    await provider.generate("sys", "hi", undefined, undefined, {
      tools: MUSIC_AGENT_TOOLS,
      toolChoice: { name: "clarify" },
    });
    const body = calls[0]!.body as any;
    expect(body.toolConfig).toEqual({
      functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["clarify"] },
    });
  });

  test("forced tool_choice rejected with 400 → retries once without forcing", async () => {
    const bodies: any[] = [];
    let call = 0;
    globalThis.fetch = (async (_input: any, init: any) => {
      bodies.push(JSON.parse(init.body));
      if (call++ === 0) {
        return new Response(JSON.stringify({ error: { message: "Upstream request failed" } }), { status: 400 });
      }
      return sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" } }] }), "[DONE]"]);
    }) as typeof fetch;
    const provider = new OpencodeProvider({
      name: "opencode-go",
      apiKey: "k",
      baseUrl: "https://opencode.ai/zen/go/v1",
      model: "deepseek-v4-pro",
    });
    const result = await provider.generate("sys", "hi", undefined, undefined, {
      tools: MUSIC_AGENT_TOOLS,
      toolChoice: { name: "clarify" },
    });
    expect(result.text).toBe("hi");
    expect(bodies.length).toBe(2);
    expect(bodies[0].tool_choice).toEqual({ type: "function", function: { name: "clarify" } });
    expect(bodies[1].tool_choice).toBe("auto");
  });

  test("non-400 failure with forced tool_choice is not retried", async () => {
    let calls = 0;
    globalThis.fetch = (async (_input: any, _init: any) => {
      calls++;
      return new Response("boom", { status: 500 });
    }) as typeof fetch;
    const provider = new OpencodeProvider({
      name: "opencode-go",
      apiKey: "k",
      baseUrl: "https://opencode.ai/zen/go/v1",
      model: "deepseek-v4-pro",
    });
    await expect(
      provider.generate("sys", "hi", undefined, undefined, {
        tools: MUSIC_AGENT_TOOLS,
        toolChoice: { name: "clarify" },
      }),
    ).rejects.toThrow(/500/);
    expect(calls).toBe(1);
  });

  test("opts.toolChoice without tools → nothing forced in the body", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" } }] }), "[DONE]"]));
    const provider = new OpencodeProvider({
      name: "opencode-go",
      apiKey: "k",
      baseUrl: "https://opencode.ai/zen/go/v1",
      model: "deepseek-v4-pro",
    });
    await provider.generate("sys", "hi", undefined, undefined, { toolChoice: { name: "clarify" } });
    const body = calls[0]!.body as any;
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  test("no tools passed → body has no `tools` field (legacy JSON mode intact)", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" } }] }), "[DONE]"]));
    const provider = new OpencodeProvider({
      name: "opencode-go",
      apiKey: "k",
      baseUrl: "https://opencode.ai/zen/go/v1",
      model: "glm-5.2",
    });
    await provider.generate("sys", "hi");
    const body = calls[0]!.body as any;
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });
});

describe("OpencodeProvider max output tokens", () => {
  test("anthropic: body.max_tokens defaults to 4096, honors opts.maxTokens", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } }), JSON.stringify({ type: "message_stop" })]));
    const provider = new OpencodeProvider({ name: "opencode-zen", apiKey: "k", baseUrl: "https://opencode.ai/zen/v1", model: "claude-sonnet-5" });
    await provider.generate("sys", "hi");
    expect(calls[0]!.body.max_tokens).toBe(4096);
    respond(sseResponse([JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } }), JSON.stringify({ type: "message_stop" })]));
    await provider.generate("sys", "hi", undefined, undefined, { maxTokens: 2048 });
    expect(calls[1]!.body.max_tokens).toBe(2048);
  });

  test("openai-responses: body.max_output_tokens set from opts.maxTokens", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ type: "response.output_text.delta", delta: "hi" })]));
    const provider = new OpencodeProvider({ name: "opencode-zen", apiKey: "k", baseUrl: "https://opencode.ai/zen/v1", model: "gpt-5.5" });
    await provider.generate("sys", "hi", undefined, undefined, { maxTokens: 1024 });
    expect(calls[0]!.body.max_output_tokens).toBe(1024);
  });

  test("openai-compat: body.max_completion_tokens set from opts.maxTokens", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" } }] }), "[DONE]"]));
    const provider = new OpencodeProvider({ name: "opencode-go", apiKey: "k", baseUrl: "https://opencode.ai/zen/go/v1", model: "glm-5.2" });
    await provider.generate("sys", "hi", undefined, undefined, { maxTokens: 1024 });
    expect(calls[0]!.body.max_completion_tokens).toBe(1024);
  });

  test("google: body.generationConfig.maxOutputTokens set from opts.maxTokens", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ candidates: [{ content: { parts: [{ text: "hi" }] } }] })]));
    const provider = new OpencodeProvider({ name: "opencode-zen", apiKey: "k", baseUrl: "https://opencode.ai/zen/v1", model: "gemini-2.5-pro" });
    await provider.generate("sys", "hi", undefined, undefined, { maxTokens: 1024 });
    expect(calls[0]!.body.generationConfig.maxOutputTokens).toBe(1024);
  });
});

describe("OpencodeProvider Retry-After / status propagation", () => {
  test("429 response attaches status and retryAfterMs (numeric seconds) to the thrown error", async () => {
    const { respond } = mockFetch();
    respond(new Response("rate limited", { status: 429, headers: { "retry-after": "2" } }));
    const provider = new OpencodeProvider({ name: "opencode-go", apiKey: "k", baseUrl: "https://opencode.ai/zen/go/v1", model: "glm-5.2" });
    let caught: (Error & { status?: number; retryAfterMs?: number }) | undefined;
    try {
      await provider.generate("sys", "hi");
    } catch (e) {
      caught = e as Error & { status?: number; retryAfterMs?: number };
    }
    expect(caught?.status).toBe(429);
    expect(caught?.retryAfterMs).toBe(2000);
  });

  test("missing Retry-After header leaves retryAfterMs undefined", async () => {
    const { respond } = mockFetch();
    respond(new Response("server error", { status: 500 }));
    const provider = new OpencodeProvider({ name: "opencode-go", apiKey: "k", baseUrl: "https://opencode.ai/zen/go/v1", model: "glm-5.2" });
    let caught: (Error & { status?: number; retryAfterMs?: number }) | undefined;
    try {
      await provider.generate("sys", "hi");
    } catch (e) {
      caught = e as Error & { status?: number; retryAfterMs?: number };
    }
    expect(caught?.status).toBe(500);
    expect(caught?.retryAfterMs).toBeUndefined();
  });
});

describe("OpencodeProvider reasoning effort mapping", () => {
  test("anthropic: 'low' sets thinking.budget_tokens and raises max_tokens to cover it", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } }), JSON.stringify({ type: "message_stop" })]));
    const provider = new OpencodeProvider({ name: "opencode-zen", apiKey: "k", baseUrl: "https://opencode.ai/zen/v1", model: "claude-sonnet-5" });
    await provider.generate("sys", "hi", undefined, undefined, { reasoningEffort: "low" });
    const body = calls[0]!.body as any;
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
    expect(body.max_tokens).toBe(4096 + 2048);
  });

  test("anthropic: 'none' omits the thinking field entirely", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } }), JSON.stringify({ type: "message_stop" })]));
    const provider = new OpencodeProvider({ name: "opencode-zen", apiKey: "k", baseUrl: "https://opencode.ai/zen/v1", model: "claude-sonnet-5" });
    await provider.generate("sys", "hi", undefined, undefined, { reasoningEffort: "none" });
    expect(calls[0]!.body.thinking).toBeUndefined();
  });

  test("anthropic: forced tool choice suppresses thinking (Anthropic rejects thinking + forced tool_choice)", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } }), JSON.stringify({ type: "message_stop" })]));
    const provider = new OpencodeProvider({ name: "opencode-zen", apiKey: "k", baseUrl: "https://opencode.ai/zen/v1", model: "claude-sonnet-5" });
    await provider.generate("sys", "hi", undefined, undefined, {
      tools: MUSIC_AGENT_TOOLS,
      toolChoice: { name: "clarify" },
      reasoningEffort: "low",
    });
    const body = calls[0]!.body as any;
    expect(body.tool_choice).toEqual({ type: "tool", name: "clarify" });
    expect(body.thinking).toBeUndefined();
    expect(body.max_tokens).toBe(4096);
  });

  test("openai-responses: maps to reasoning.effort ('none' -> 'minimal')", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ type: "response.output_text.delta", delta: "hi" })]));
    const provider = new OpencodeProvider({ name: "opencode-zen", apiKey: "k", baseUrl: "https://opencode.ai/zen/v1", model: "gpt-5.5" });
    await provider.generate("sys", "hi", undefined, undefined, { reasoningEffort: "none" });
    expect(calls[0]!.body.reasoning).toEqual({ effort: "minimal" });
  });

  test("openai-compat: maps to reasoning_effort", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" } }] }), "[DONE]"]));
    const provider = new OpencodeProvider({ name: "opencode-go", apiKey: "k", baseUrl: "https://opencode.ai/zen/go/v1", model: "glm-5.2" });
    await provider.generate("sys", "hi", undefined, undefined, { reasoningEffort: "low" });
    expect(calls[0]!.body.reasoning_effort).toBe("low");
  });

  test("google: maps to generationConfig.thinkingConfig.thinkingBudget", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ candidates: [{ content: { parts: [{ text: "hi" }] } }] })]));
    const provider = new OpencodeProvider({ name: "opencode-zen", apiKey: "k", baseUrl: "https://opencode.ai/zen/v1", model: "gemini-2.5-pro" });
    await provider.generate("sys", "hi", undefined, undefined, { reasoningEffort: "high" });
    expect(calls[0]!.body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 12000 });
  });

  test("no reasoningEffort set -> no reasoning field on any family (unchanged default behavior)", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" } }] }), "[DONE]"]));
    const provider = new OpencodeProvider({ name: "opencode-go", apiKey: "k", baseUrl: "https://opencode.ai/zen/go/v1", model: "glm-5.2" });
    await provider.generate("sys", "hi");
    expect(calls[0]!.body.reasoning_effort).toBeUndefined();
  });

  test("400 with forced tool_choice AND reasoningEffort degrades by stripping both, retries once", async () => {
    const bodies: any[] = [];
    let call = 0;
    globalThis.fetch = (async (_input: any, init: any) => {
      bodies.push(JSON.parse(init.body));
      if (call++ === 0) {
        return new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 });
      }
      return sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" } }] }), "[DONE]"]);
    }) as typeof fetch;
    const provider = new OpencodeProvider({ name: "opencode-go", apiKey: "k", baseUrl: "https://opencode.ai/zen/go/v1", model: "deepseek-v4-pro" });
    const result = await provider.generate("sys", "hi", undefined, undefined, {
      toolChoice: { name: "clarify" },
      tools: MUSIC_AGENT_TOOLS,
      reasoningEffort: "low",
      maxTokens: 100,
    });
    expect(result.text).toBe("hi");
    expect(bodies.length).toBe(2);
    expect(bodies[0].reasoning_effort).toBe("low");
    expect(bodies[0].max_completion_tokens).toBe(100);
    expect(bodies[1].tool_choice).toBe("auto");
    expect(bodies[1].reasoning_effort).toBeUndefined();
    expect(bodies[1].max_completion_tokens).toBe(4096);
  });
});

describe("OpencodeProvider multi-turn history serialization", () => {
  // One shared canonical history: user ask → assistant tool call → tool result → continuation.
  const history = [
    { role: "user" as const, content: "find tracks" },
    {
      role: "assistant" as const,
      content: "searching",
      toolCalls: [{ id: "call_1", name: "searchTrack", args: { artist: "A", title: "B" } }],
    },
    { role: "tool" as const, callId: "call_1", name: "searchTrack", content: '{"uri":"s:1"}' },
    { role: "user" as const, content: "continue" },
  ];

  function providerFor(model: string): OpencodeProvider {
    return new OpencodeProvider({
      name: "opencode-zen",
      apiKey: "k",
      baseUrl: "https://opencode.ai/zen/v1",
      model,
    });
  }

  test("anthropic family: tool_use block + tool_result block linked by id", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "ok" } })]));
    await providerFor("claude-sonnet-5").generateMessages("sys", history);
    expect(calls[0]!.body.system).toBe("sys");
    expect(calls[0]!.body.messages).toEqual([
      { role: "user", content: "find tracks" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "searching" },
          { type: "tool_use", id: "call_1", name: "searchTrack", input: { artist: "A", title: "B" } },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: '{"uri":"s:1"}' }] },
      { role: "user", content: "continue" },
    ]);
  });

  test("openai-compat family: assistant.tool_calls + role:'tool' message", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ choices: [{ delta: { content: "ok" } }] }), "[DONE]"]));
    await providerFor("glm-5.2").generateMessages("sys", history);
    expect(calls[0]!.body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "find tracks" },
      {
        role: "assistant",
        content: "searching",
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "searchTrack", arguments: '{"artist":"A","title":"B"}' } },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: '{"uri":"s:1"}' },
      { role: "user", content: "continue" },
    ]);
  });

  test("openai-responses family: function_call + function_call_output items", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ type: "response.output_text.delta", delta: "ok" })]));
    await providerFor("gpt-5.5").generateMessages("sys", history);
    expect(calls[0]!.body.input).toEqual([
      { role: "user", content: "find tracks" },
      { role: "assistant", content: "searching" },
      { type: "function_call", call_id: "call_1", name: "searchTrack", arguments: '{"artist":"A","title":"B"}' },
      { type: "function_call_output", call_id: "call_1", output: '{"uri":"s:1"}' },
      { role: "user", content: "continue" },
    ]);
  });

  test("google family: functionCall part + functionResponse part", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] })]));
    await providerFor("gemini-3-pro").generateMessages("sys", history);
    expect(calls[0]!.body.contents).toEqual([
      { role: "user", parts: [{ text: "find tracks" }] },
      {
        role: "model",
        parts: [
          { text: "searching" },
          { functionCall: { name: "searchTrack", args: { artist: "A", title: "B" } } },
        ],
      },
      { role: "user", parts: [{ functionResponse: { name: "searchTrack", response: { result: '{"uri":"s:1"}' } } }] },
      { role: "user", parts: [{ text: "continue" }] },
    ]);
  });

  test("error tool result carries is_error on the anthropic wire", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "ok" } })]));
    const errHistory = [
      history[0]!,
      history[1]!,
      { role: "tool" as const, callId: "call_1", name: "searchTrack", content: "boom", isError: true },
    ];
    await providerFor("claude-sonnet-5").generateMessages("sys", errHistory);
    expect(calls[0]!.body.messages[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call_1", content: "boom", is_error: true }],
    });
  });
});
