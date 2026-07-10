import type { Progress } from "../core/generate-playlist";
import { barParts, SPINNER, theme, truncateLabel } from "./theme";

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

// Volume gets its own short glyph/width so it never reads as a second
// progress bar next to the resolving/track bars (both ━ at width 10).
const VOLUME_BAR_WIDTH = 5;

function volumeBarParts(volume: number): { filled: string; rest: string } {
  const r = Math.max(0, Math.min(1, volume / 100));
  const n = Math.round(r * VOLUME_BAR_WIDTH);
  return { filled: "▮".repeat(n), rest: "▯".repeat(VOLUME_BAR_WIDTH - n) };
}

// Long provider:model labels (e.g. "opencode-go:deepseek-v4-flash") must not
// push the backend indicator and key hints off the row — truncate with an
// ellipsis instead of letting flexbox hard-clip mid-word. 24 leaves room for
// the "✗ N excluded" tag on typical widths.
const MODEL_MAX = 24;

function progressBar(current: number, total: number): string {
  const { filled, rest } = barParts(total > 0 ? current / total : 0, BAR_WIDTH);
  return filled + rest;
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
  // Backend + model on one line — both are environment identity, and merging
  // them frees the third footer row that model used to occupy in App.
  // During generation the right cluster (spinner · elapsed · vol) needs the
  // width, and flexbox would hard-clip the model mid-word — drop it then.
  const backendLabel = loading
    ? `♪ ${backend} ${authed ? "✓" : "—"}`
    : `♪ ${backend} ${authed ? "✓" : "—"} · ${truncateLabel(model, MODEL_MAX)}`;
  return (
    <box style={{ height: 1, flexShrink: 0, flexDirection: "row" }}>
      {error ? (
        <text fg={theme.red}> {error}</text>
      ) : loading && progress ? (
        <>
          {/* Left: backend + model identity. */}
          <box style={{ flexDirection: "row", flexShrink: 1, overflow: "hidden" }}>
            <text fg={theme.subtext}>
              {" "}
              {backendLabel}
            </text>
            {/* flexShrink 0: without it the overflow-hidden left box clips the
                label to a bare red number that reads as noise. */}
            {!!excludedCount && (
              <text fg={theme.maroon} style={{ flexShrink: 0 }}>
                {" "}· ✗ {excludedCount} excluded
              </text>
            )}
          </box>
          {/* Right: spinner + thinking/vol — keeps its width so it never clips. */}
          <box style={{ flexDirection: "row", flexShrink: 0, flexGrow: 1, justifyContent: "flex-end" }}>
            <text fg={theme.accent}>
              {SPINNER[spinnerFrame % SPINNER.length]} {progressLabel(progress, tokenCount)}
              {" · "}
              {elapsed}s
            </text>
            {cancelHint && <text fg={theme.yellow}> · esc cancels</text>}
            {muted ? (
              <text fg={theme.maroon}> · 🔇 muted</text>
            ) : volume !== null ? (
              <text>
                <span fg={theme.subtext}> · 🔊 </span>
                <span fg={theme.yellow}>{volumeBarParts(volume).filled}</span>
                <span fg={theme.muted}>{volumeBarParts(volume).rest}</span>
                <span fg={theme.subtext}> {volume}%</span>
              </text>
            ) : null}
          </box>
        </>
      ) : (
        <>
          {/* Left: backend + model identity. */}
          <box style={{ flexDirection: "row", flexShrink: 1, overflow: "hidden" }}>
            <text fg={theme.subtext}>
              {" "}
              {backendLabel}
              {loading ? " · generating…" : ""}
            </text>
            {!!excludedCount && !loading && !error ? (
              <text fg={theme.maroon} style={{ flexShrink: 0 }}>
                {" "}· ✗ {excludedCount} excluded
              </text>
            ) : null}
          </box>
          {/* Right: hints + volume — keeps its width so hints never get clipped. */}
          <box style={{ flexDirection: "row", flexShrink: 0, flexGrow: 1, justifyContent: "flex-end" }}>
            {/* "/ commands" hint removed — the input placeholder already says
                "(/ for commands)" one row above; two hints for the same key
                on adjacent lines is noise. */}
            {muted ? (
              <text fg={theme.maroon}> 🔇 muted</text>
            ) : volume !== null ? (
              <text>
                <span fg={theme.subtext}> 🔊 </span>
                <span fg={theme.yellow}>{volumeBarParts(volume).filled}</span>
                <span fg={theme.muted}>{volumeBarParts(volume).rest}</span>
                <span fg={theme.subtext}> {volume}%</span>
              </text>
            ) : null}
          </box>
        </>
      )}
    </box>
  );
}
