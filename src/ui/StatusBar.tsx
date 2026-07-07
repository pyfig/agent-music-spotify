import type { Progress } from "../core/generate-playlist";
import { SPINNER, theme } from "./theme";

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
  volume?: number | null;
  muted?: boolean;
}

const BAR_WIDTH = 10;

// Long provider:model labels (e.g. "opencode-go:deepseek-v4-flash") must not
// push the backend indicator and key hints off the row — truncate with an
// ellipsis instead of letting flexbox hard-clip mid-word.
const MODEL_MAX = 24;

function truncateLabel(s: string, max = MODEL_MAX): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function progressBar(current: number, total: number): string {
  const filled = total > 0 ? Math.round((current / total) * BAR_WIDTH) : 0;
  return "━".repeat(filled) + "─".repeat(BAR_WIDTH - filled);
}

function volumeBar(pct: number): string {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  const filled = Math.round((v / 100) * BAR_WIDTH);
  return "━".repeat(filled) + "─".repeat(BAR_WIDTH - filled);
}

function progressLabel(progress: Progress, tokenCount: number): string {
  switch (progress.phase) {
    case "clarifying":
      return "clarifying…";
    case "thinking":
      return `thinking ${tokenCount > 0 ? `n=${tokenCount}` : "…"}`;
    case "tool": {
      const name = progress.toolName ?? "";
      return name.length > 0 ? `tool: ${name}` : "tool…";
    }
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
  volume = null,
  muted = false,
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
            {truncateLabel(model)} ·{" "}
          </text>
          <text fg={theme.accent}>
            {SPINNER[spinnerFrame % SPINNER.length]} {progressLabel(progress, tokenCount)} ·{" "}
            {elapsed}s
          </text>
          {cancelHint && <text fg={theme.yellow}> · esc cancels</text>}
        </>
      ) : (
        <>
          {/* Left: identity (model · backend) — shrinks first when narrow. */}
          <box style={{ flexDirection: "row", flexShrink: 1, overflow: "hidden" }}>
            <text fg={theme.subtext}>
              {" "}
              {truncateLabel(model)} · {backendLabel}
              {loading ? " · generating…" : ""}
            </text>
            {!!excludedCount && !loading && !error ? (
              <text fg={theme.maroon}> · {excludedCount} excluded</text>
            ) : null}
          </box>
          {/* Right: hints + volume — keeps its width so hints never get clipped. */}
          <box style={{ flexDirection: "row", flexShrink: 0, flexGrow: 1, justifyContent: "flex-end" }}>
            {!loading && (
              <text>
                <span fg={theme.subtext}>/</span>
                <span fg={theme.muted}> commands · </span>
                <span fg={theme.subtext}>⏎</span>
                <span fg={theme.muted}> play · </span>
                <span fg={theme.subtext}>q</span>
                <span fg={theme.muted}> quit</span>
              </text>
            )}
            {muted ? (
              <text fg={theme.maroon}> · 🔇 muted</text>
            ) : volume !== null ? (
              <text>
                <span fg={theme.subtext}> · vol </span>
                <span fg={theme.accent}>{volumeBar(volume)}</span>
                <span fg={theme.subtext}> {volume}%</span>
              </text>
            ) : null}
          </box>
        </>
      )}
    </box>
  );
}
