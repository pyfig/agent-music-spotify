import type { AgentMessage, AgentProvider, AgentResult } from "../types";
import { joinMessagesAsText } from "./messages";

export interface ClaudeCliConfig {
  model?: string;
  effort?: string;
  systemPrompt?: string;
}

export class ClaudeCliProvider implements AgentProvider {
  name = "claude-cli";
  private model: string;
  private effort?: string;
  private customSystemPrompt?: string;

  constructor(config: ClaudeCliConfig = {}) {
    this.model = config.model ?? "sonnet";
    this.effort = config.effort;
    this.customSystemPrompt = config.systemPrompt;
  }

  // TODO: `claude -p` is a one-shot prompt with no message-history flag, so
  // multi-turn is flattened to text here. If the CLI grows a native history
  // input, switch this to it.
  async generateMessages(
    system: string,
    messages: AgentMessage[],
    onToken?: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<AgentResult> {
    return this.generate(system, joinMessagesAsText(messages), onToken, signal);
  }

  async generate(
    system: string,
    user: string,
    onToken?: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<AgentResult> {
    const args = [
      "claude",
      "-p",
      user,
      "--model",
      this.model,
    ];
    if (this.effort && this.effort !== "none") {
      args.push("--effort", this.effort);
    }
    const appendedSystem = this.customSystemPrompt
      ? `${system}\n\n${this.customSystemPrompt}`
      : system;
    args.push(
      "--append-system-prompt",
      appendedSystem,
      "--output-format",
      "json",
    );
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
    signal?.addEventListener("abort", () => proc.kill(), { once: true });
    // Read stdout in chunks so onToken gets a signal even if the CLI buffers.
    const readStdout = async () => {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let out = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        out += chunk;
        onToken?.(chunk);
      }
      return out;
    };
    const [stdout, stderr, exitCode] = await Promise.all([
      readStdout(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (signal?.aborted) {
      throw new DOMException("generation cancelled", "AbortError");
    }
    if (exitCode !== 0) {
      throw new Error(`claude CLI exited ${exitCode}: ${stderr.trim()}`);
    }
    const parsed = JSON.parse(stdout);
    const result = parsed.result ?? parsed.response ?? stdout;
    if (typeof result !== "string") {
      throw new Error("unexpected claude CLI JSON shape");
    }
    return { text: result };
  }
}
