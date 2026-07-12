import { afterEach, describe, expect, test } from "bun:test";
import { OllamaProvider } from "../src/agent/providers/ollama";
import { MUSIC_AGENT_TOOLS } from "../src/agent/tools";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function ndjsonResponse(objects: unknown[]): Response {
  const body = objects.map((o) => `${JSON.stringify(o)}\n`).join("");
  return new Response(body, { status: 200 });
}

function mockFetch(handler: (call: { url: string; body: any }, n: number) => Response): {
  calls: { url: string; body: any }[];
} {
  const calls: { url: string; body: any }[] = [];
  globalThis.fetch = (async (input: any, init: any) => {
    const call = { url: String(input), body: JSON.parse(init.body) };
    calls.push(call);
    return handler(call, calls.length);
  }) as typeof fetch;
  return { calls };
}

const doneChunk = { message: { role: "assistant", content: "" }, done: true };

describe("OllamaProvider thinking", () => {
  test("requests think:true so tool-bearing calls still stream message.thinking", async () => {
    // Without think:true the daemon silently drops thinking whenever `tools`
    // is present in the request — reasoning never reaches the UI.
    const { calls } = mockFetch(() =>
      ndjsonResponse([{ message: { role: "assistant", content: '{"ok":true}' } }, doneChunk]),
    );
    const provider = new OllamaProvider({ url: "http://localhost:11434", model: "m" });
    await provider.generate("sys", "hi", undefined, undefined, { tools: MUSIC_AGENT_TOOLS });
    expect(calls[0]!.body.think).toBe(true);
  });

  test("retries without think when the model does not support thinking", async () => {
    const { calls } = mockFetch((call) => {
      if (call.body.think) {
        return new Response(JSON.stringify({ error: '"m" does not support thinking' }), { status: 400 });
      }
      return ndjsonResponse([{ message: { role: "assistant", content: "ok" } }, doneChunk]);
    });
    const provider = new OllamaProvider({ url: "http://localhost:11434", model: "m" });
    const result = await provider.generate("sys", "hi");
    expect(result.text).toBe("ok");
    expect(calls.length).toBe(2);
    expect(calls[0]!.body.think).toBe(true);
    expect(calls[1]!.body.think).toBeUndefined();
  });

  test("non-thinking 4xx errors are not retried", async () => {
    mockFetch(() => new Response(JSON.stringify({ error: "model not found" }), { status: 404 }));
    const provider = new OllamaProvider({ url: "http://localhost:11434", model: "m" });
    expect(provider.generate("sys", "hi")).rejects.toThrow(/model not found/);
  });

  test("serializes historical tool_call arguments as objects, not JSON strings", async () => {
    // Ollama's /api/chat rejects the OpenAI-style stringified `arguments` in
    // assistant history with 400 "Value looks like object, but can't find
    // closing '}' symbol" — the daemon expects a plain object.
    const { calls } = mockFetch(() =>
      ndjsonResponse([{ message: { role: "assistant", content: "done" } }, doneChunk]),
    );
    const provider = new OllamaProvider({ url: "http://localhost:11434", model: "m" });
    await provider.generateMessages(
      "sys",
      [
        { role: "user", content: "find artist Radiohead" },
        { role: "assistant", content: "", toolCalls: [{ id: "call_0", name: "searchArtist", args: { name: "Radiohead" } }] },
        { role: "tool", callId: "call_0", name: "searchArtist", content: '{"id":"abc123","name":"Radiohead"}' },
      ],
      undefined,
      undefined,
      { tools: MUSIC_AGENT_TOOLS },
    );
    const assistant = calls[0]!.body.messages.find((m: any) => m.role === "assistant");
    expect(assistant.tool_calls[0].function.arguments).toEqual({ name: "Radiohead" });
  });

  test("forwards message.thinking deltas to onReasoning", async () => {
    mockFetch(() =>
      ndjsonResponse([
        { message: { role: "assistant", content: "", thinking: "hmm " } },
        { message: { role: "assistant", content: "", thinking: "okay" } },
        { message: { role: "assistant", content: "answer" } },
        doneChunk,
      ]),
    );
    const provider = new OllamaProvider({ url: "http://localhost:11434", model: "m" });
    const reasoning: string[] = [];
    const result = await provider.generate("sys", "hi", undefined, undefined, {
      onReasoning: (d) => reasoning.push(d),
    });
    expect(reasoning.join("")).toBe("hmm okay");
    expect(result.text).toBe("answer");
  });
});
