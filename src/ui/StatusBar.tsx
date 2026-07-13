import type { Progress } from "../core/generate-playlist";
import { barParts, SPINNER, THINKING_VERBS, theme, truncateLabel } from "./theme";

interface StatusBarProps {
  model: string;
  backend: string;
  authed: boolean;
  loading: boolean;
  error?: string;
  progress?: Progress | null;
  spinnerFrame?: number;
  elapsed?: number;
  cancelHint?: boolean;
  excludedCount?: number;
  volume?: number | null;
  muted?: boolean;
  /** Width of the containing column — the model label budget shrinks with it
   * so the right cluster never overlaps or hard-clips the left one. */
  width?: number;
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
// ellipsis instead of letting flexbox hard-clip mid-word. 24 is the ceiling;
// on narrow columns the budget shrinks further so the excluded tag and the
// volume cluster stay fully visible (see modelMax below).
const MODEL_MAX = 24;
const MODEL_MIN = 8;

// Conservative column estimates for everything sharing the row with the model
// label. Slightly over-reserving just makes the ellipsis kick in a character
// early — under-reserving would hard-clip, which the layout spec forbids.
export function modelMax(width: number | undefined, backend: string, excludedCount: number, volume: number | null, muted: boolean): number {
  if (width === undefined) return MODEL_MAX;
  const prefix = backend.length + 9; // " ♪ backend ✓ · "
  const excluded = excludedCount > 0 ? String(excludedCount).length + 15 : 0; // " · ✗ N excluded"
  const right = muted ? 11 : volume !== null ? 16 : 0; // " 🔊 ▮▮▮▯▯ 100%"
  return Math.max(MODEL_MIN, Math.min(MODEL_MAX, width - prefix - excluded - right));
}

// Rotates every 3s so long reasoning stretches visibly progress — per-tick
// rotation would strobe. Derived from the shared elapsed counter: no extra
// timer or state. Exported for tests.
export function thinkingVerb(elapsed: number): string {
  return THINKING_VERBS[Math.floor(elapsed / 3) % THINKING_VERBS.length]!;
}

function progressBar(current: number, total: number): string {
  const { filled, rest } = barParts(total > 0 ? current / total : 0, BAR_WIDTH);
  return filled + rest;
}

export function progressLabel(progress: Progress, elapsed: number): string {
  switch (progress.phase) {
    case "clarifying":
    case "thinking":
      return thinkingVerb(elapsed);
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
  spinnerFrame = 0,
  elapsed = 0,
  cancelHint = false,
  excludedCount = 0,
  volume = null,
  muted = false,
  width,
}: StatusBarProps) {
  // Backend + model on one line — both are environment identity, and merging
  // them frees the third footer row that model used to occupy in App.
  // During generation the right cluster (spinner · elapsed · vol) needs the
  // width, and flexbox would hard-clip the model mid-word — drop it then.
  const backendLabel = loading
    ? `♪ ${backend} ${authed ? "✓" : "—"}`
    : `♪ ${backend} ${authed ? "✓" : "—"} · ${truncateLabel(model, modelMax(width, backend, excludedCount, volume, muted))}`;
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
              {SPINNER[spinnerFrame % SPINNER.length]} {progressLabel(progress, elapsed)}
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
