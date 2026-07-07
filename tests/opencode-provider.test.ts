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
    expect(calls[0]!.body.input).toBe("hi");
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
