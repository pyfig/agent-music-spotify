import type { AgentProvider } from "../types";

export interface ClaudeCliConfig {
  model?: string;
}

export class ClaudeCliProvider implements AgentProvider {
  name = "claude-cli";
  private model: string;

  constructor(config: ClaudeCliConfig = {}) {
    this.model = config.model ?? "sonnet";
  }

  async generate(
    system: string,
    user: string,
    onToken?: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const proc = Bun.spawn(
      [
        "claude",
        "-p",
        user,
        "--model",
        this.model,
        "--effort",
        "low",
        "--append-system-prompt",
        system,
        "--output-format",
        "json",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
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
    return result;
  }
}
