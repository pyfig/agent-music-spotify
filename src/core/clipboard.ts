/**
 * Copy text to the system clipboard via the platform's native utility:
 * pbcopy (macOS), wl-copy/xclip (Linux/Wayland/X11), clip.exe (Windows/WSL).
 * Throws when no clipboard utility is available.
 */
export async function copyToClipboard(text: string): Promise<void> {
  const candidates: string[][] =
    process.platform === "darwin"
      ? [["pbcopy"]]
      : process.platform === "win32"
        ? [["clip.exe"]]
        : [["wl-copy"], ["xclip", "-selection", "clipboard"], ["clip.exe"]];

  let lastError: unknown = null;
  for (const cmd of candidates) {
    try {
      const proc = Bun.spawn(cmd, { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
      proc.stdin.write(text);
      await proc.stdin.end();
      const code = await proc.exited;
      if (code === 0) return;
      lastError = new Error(`${cmd[0]} exited with ${code}`);
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(
    `no clipboard utility available (${lastError instanceof Error ? lastError.message : String(lastError)})`,
  );
}
