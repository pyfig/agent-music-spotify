import { afterEach, describe, expect, test } from "bun:test";
import { OpenRouterProvider } from "../src/agent/providers/openrouter";
import { MUSIC_AGENT_TOOLS } from "../src/agent/tools";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function sseResponse(events: string[]): Response {
  const body = events.map((e) => `data: ${e}\n\n`).join("");
  return new Response(body, { status: 200 });
}

function mockFetch(): { calls: { url: string; headers: any; body: any }[]; respond: (res: Response) => void } {
  const calls: { url: string; headers: any; body: any }[] = [];
  let response: Response = new Response("", { status: 200 });
  globalThis.fetch = (async (input: any, init: any) => {
    calls.push({ url: String(input), headers: init.headers, body: JSON.parse(init.body) });
    return response;
  }) as typeof fetch;
  return { calls, respond: (res: Response) => { response = res; } };
}

function makeProvider(overrides: Partial<ConstructorParameters<typeof OpenRouterProvider>[0]> = {}) {
  return new OpenRouterProvider({
    apiKey: "sk-or-test",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openrouter/auto",
    ...overrides,
  });
}

describe("OpenRouterProvider", () => {
  test("hits {baseUrl}/chat/completions with bearer auth and system+user messages", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" } }] }), "[DONE]"]));
    const result = await makeProvider().generate("sys", "hello");
    expect(result.text).toBe("hi");
    expect(calls[0]!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(calls[0]!.headers.authorization).toBe("Bearer sk-or-test");
    expect(calls[0]!.body.model).toBe("openrouter/auto");
    expect(calls[0]!.body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
    ]);
  });

  test("tools payload uses the OpenAI Chat Completions function shape", async () => {
    const { calls, respond } = mockFetch();
    respond(sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" } }] }), "[DONE]"]));
    await makeProvider().generate("sys", "hi", undefined, undefined, { tools: MUSIC_AGENT_TOOLS });
    const body = calls[0]!.body as any;
    expect(body.tools[0].type).toBe("function");
    expect(body.tool_choice).toBe("auto");
  });

  test("non-2xx response throws an Error carrying .status and .retryAfterMs", async () => {
    const { respond } = mockFetch();
    respond(new Response("rate limited", { status: 429, headers: { "retry-after": "3" } }));
    let caught: (Error & { status?: number; retryAfterMs?: number }) | undefined;
    try {
      await makeProvider().generate("sys", "hi");
    } catch (e) {
      caught = e as Error & { status?: number; retryAfterMs?: number };
    }
    expect(caught?.status).toBe(429);
    expect(caught?.retryAfterMs).toBe(3000);
    expect(caught?.message).toContain("429");
  });

  test("missing api key throws before any network call", async () => {
    const { calls } = mockFetch();
    await expect(makeProvider({ apiKey: "" }).generate("sys", "hi")).rejects.toThrow(
      /OPENROUTER_API_KEY/,
    );
    expect(calls.length).toBe(0);
  });
});
