import type { AgentMessage, AgentProvider, AgentResult, GenerateOptions } from "../types";
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
    opts?: GenerateOptions,
  ): Promise<AgentResult> {
    return this.generate(system, joinMessagesAsText(messages), onToken, signal, opts);
  }

  async generate(
    system: string,
    user: string,
    onToken?: (delta: string) => void,
    signal?: AbortSignal,
    opts?: GenerateOptions,
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
      // stream-json + verbose + include-partial-messages gives real token-level
      // thinking_delta/text_delta events as the model works, instead of the
      // single JSON blob `--output-format json` buffers until the whole
      // response (including all extended thinking) is done — with tool-heavy
      // prompts that made the UI look hung for 30s-2min with zero reasoning
      // shown even though the CLI was actively working the whole time.
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
    );
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
    signal?.addEventListener("abort", () => proc.kill(), { once: true });

    let result: string | undefined;
    // At effort low/medium the CLI emits no thinking_delta at all, which left
    // the reasoning transcript blank; fall back to mirroring the answer text
    // into the reasoning channel so the UI shows live activity.
    let sawThinking = false;
    const readStdout = async () => {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          handleLine(line);
        }
      }
      if (buf.trim()) handleLine(buf.trim());
    };
    const handleLine = (line: string) => {
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line);
      } catch {
        return;
      }
      if (obj.type === "stream_event") {
        const event = obj.event as Record<string, unknown> | undefined;
        if (event?.type === "content_block_delta") {
          const delta = event.delta as Record<string, unknown> | undefined;
          if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
            sawThinking = true;
            opts?.onReasoning?.(delta.thinking);
          } else if (delta?.type === "text_delta" && typeof delta.text === "string") {
            onToken?.(delta.text);
            if (!sawThinking) opts?.onReasoning?.(delta.text);
          }
        }
      } else if (obj.type === "result") {
        const r = obj.result;
        if (typeof r === "string") result = r;
      }
    };

    const [, stderr, exitCode] = await Promise.all([
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
    if (result === undefined) {
      throw new Error("unexpected claude CLI JSON shape");
    }
    return { text: result };
  }
}
