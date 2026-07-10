import { describe, expect, test } from "bun:test";
import { ClaudeCliProvider } from "../src/agent/providers/claude-cli";
import type { GenerateOptions } from "../src/agent/types";

describe("ClaudeCliProvider generateMessages wiring", () => {
  test("forwards GenerateOptions (onReasoning etc.) to generate", async () => {
    // Regression: when the loop switched to generateMessages (native
    // multi-turn), the claude-cli signature dropped `opts` — onReasoning
    // never reached the provider and the reasoning transcript showed
    // "working…" for the whole generation.
    const provider = new ClaudeCliProvider();
    let receivedOpts: GenerateOptions | undefined;
    provider.generate = async (_system, _user, _onToken, _signal, opts) => {
      receivedOpts = opts;
      return { text: "{}" };
    };
    const onReasoning = () => {};
    await provider.generateMessages("sys", [{ role: "user", content: "hi" }], undefined, undefined, {
      onReasoning,
    });
    expect(receivedOpts).toBeDefined();
    expect(receivedOpts?.onReasoning).toBe(onReasoning);
  });
});
