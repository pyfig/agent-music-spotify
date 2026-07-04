import type { AgentProvider } from "../types";

export class ClaudeCliProvider implements AgentProvider {
  name = "claude-cli";

  async generate(system: string, user: string): Promise<string> {
    const proc = Bun.spawn(
      ["claude", "-p", user, "--append-system-prompt", system, "--output-format", "json"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
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
