import type { Progress } from "../core/generate-playlist";
import { theme } from "./theme";

interface StatusBarProps {
  model: string;
  backend: string;
  authed: boolean;
  loading: boolean;
  error?: string;
  progress?: Progress | null;
  tokenCount?: number;
  spinnerFrame?: number;
  elapsed?: number;
  cancelHint?: boolean;
  excludedCount?: number;
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const BAR_WIDTH = 10;

function progressBar(current: number, total: number): string {
  const filled = total > 0 ? Math.round((current / total) * BAR_WIDTH) : 0;
  return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}

function progressLabel(progress: Progress, tokenCount: number): string {
  switch (progress.phase) {
    case "clarifying":
      return "clarifying…";
    case "thinking":
      return `thinking ${tokenCount > 0 ? `n=${tokenCount}` : "…"}`;
    case "resolving": {
      const current = progress.current ?? 0;
      const total = progress.total ?? 0;
      return `resolving [${progressBar(current, total)}] ${current}/${total}`;
    }
    case "creating":
      return "creating playlist";
    case "adding":
      return "adding tracks";
    case "done":
      return "done";
  }
}

export function StatusBar({
  model,
  backend,
  authed,
  loading,
  error,
  progress,
  tokenCount = 0,
  spinnerFrame = 0,
  elapsed = 0,
  cancelHint = false,
  excludedCount = 0,
}: StatusBarProps) {
  const backendLabel = `♪ ${backend} ${authed ? "✓" : "—"}`;
  return (
    <box style={{ height: 1, flexShrink: 0, flexDirection: "row" }}>
      {error ? (
        <text fg={theme.red}> {error}</text>
      ) : loading && progress ? (
        <>
          <text fg={theme.subtext}>
            {" "}
            {model} ·{" "}
          </text>
          <text fg={theme.accent}>
            {SPINNER[spinnerFrame % SPINNER.length]} {progressLabel(progress, tokenCount)} ·{" "}
            {elapsed}s
          </text>
          {cancelHint && <text fg={theme.yellow}> · esc cancels</text>}
        </>
      ) : (
        <>
          <text fg={theme.subtext}>
            {" "}
            {model} · {backendLabel}
            {loading ? " · generating…" : " · /model · ⏎ play · q quit"}
          </text>
          {!!excludedCount && !loading && !error ? (
            <text fg={theme.maroon}> · {excludedCount} excluded</text>
          ) : null}
        </>
      )}
    </box>
  );
}
