import { afterEach, describe, expect, test } from "bun:test";
import { OpenAIProvider } from "../src/agent/providers/openai";
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
  return { calls, respond: (res: Response) => { response = res; } };
}

describe("OpenAIProvider", () => {
  test("hits {baseUrl}/chat/completions with system+user messages", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" } }] }), "[DONE]"]));
    const provider = new OpenAIProvider({ authMode: "api", apiKey: "sk-test", subsToken: "", baseUrl: "https://api.openai.com/v1", model: "gpt-5" });
    const result = await provider.generate("sys", "hello");
    expect(result.text).toBe("hi");
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0]!.body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
    ]);
  });

  test("body.max_completion_tokens defaults to 4096 and honors opts.maxTokens", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" } }] }), "[DONE]"]));
    const provider = new OpenAIProvider({ authMode: "api", apiKey: "sk-test", subsToken: "", baseUrl: "https://api.openai.com/v1", model: "gpt-5" });
    await provider.generate("sys", "hi");
    expect(calls[0]!.body.max_completion_tokens).toBe(4096);
    respond(sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" } }] }), "[DONE]"]));
    await provider.generate("sys", "hi", undefined, undefined, { maxTokens: 1024 });
    expect(calls[1]!.body.max_completion_tokens).toBe(1024);
  });

  test("tools payload uses the OpenAI Chat Completions function shape", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" } }] }), "[DONE]"]));
    const provider = new OpenAIProvider({ authMode: "api", apiKey: "sk-test", subsToken: "", baseUrl: "https://api.openai.com/v1", model: "gpt-5" });
    await provider.generate("sys", "hi", undefined, undefined, { tools: MUSIC_AGENT_TOOLS });
    const body = calls[0]!.body as any;
    expect(body.tools[0].type).toBe("function");
    expect(body.tool_choice).toBe("auto");
  });

  test("non-2xx response throws an Error carrying .status and .retryAfterMs", async () => {
    const { respond } = mockFetch();
    respond(new Response("rate limited", { status: 429, headers: { "retry-after": "3" } }));
    const provider = new OpenAIProvider({ authMode: "api", apiKey: "sk-test", subsToken: "", baseUrl: "https://api.openai.com/v1", model: "gpt-5" });
    let caught: (Error & { status?: number; retryAfterMs?: number }) | undefined;
    try {
      await provider.generate("sys", "hi");
    } catch (e) {
      caught = e as Error & { status?: number; retryAfterMs?: number };
    }
    expect(caught?.status).toBe(429);
    expect(caught?.retryAfterMs).toBe(3000);
    expect(caught?.message).toContain("429");
  });

  test("subs auth mode sends the subscription bearer token", async () => {
    let seenAuth = "";
    globalThis.fetch = (async (_input: any, init: any) => {
      seenAuth = init.headers.authorization;
      return sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" } }] }), "[DONE]"]);
    }) as typeof fetch;
    const provider = new OpenAIProvider({ authMode: "subs", apiKey: "", subsToken: "subs-token", baseUrl: "https://api.openai.com/v1", model: "gpt-5" });
    await provider.generate("sys", "hi");
    expect(seenAuth).toBe("Bearer subs-token");
  });
});
