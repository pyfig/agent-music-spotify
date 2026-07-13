import type { LyricsResult } from "../lyrics/client";
import { theme } from "./theme";

/** What the persistent panel should communicate while lyrics mode is on. */
export type LyricsPanelState = "waiting" | "loading" | "synced" | "none" | "error";

interface LyricsPanelProps {
  state: LyricsPanelState;
  /** Present only when state === "synced". */
  lyrics: LyricsResult | null;
  currentLine: number;
}

const STATE_MESSAGES: Record<Exclude<LyricsPanelState, "synced">, string> = {
  waiting: "waiting for playback…",
  loading: "loading lyrics…",
  none: "no synchronized lyrics for this track",
  error: "lyrics unavailable — fetch failed",
};

/** Rule between the results list and the panel — without it a wrapped or
 * adjacent track row reads as the first lyric line. */
const SEPARATOR = "── ♪ lyrics ──";

/**
 * Compact lyrics panel, persistent while lyrics mode is on: a separator row,
 * then either prev / current / next synced lines (current = the karaoke pin)
 * or a single centered state message. Row count is identical in every state
 * so transitions never shift the surrounding layout.
 */
export function LyricsPanel({ state, lyrics, currentLine }: LyricsPanelProps) {
  if (state !== "synced" || !lyrics) {
    const msg = STATE_MESSAGES[state === "synced" ? "loading" : state];
    return (
      <>
        <text fg={theme.surface1}>{SEPARATOR}</text>
        <text fg={theme.surface1}>—</text>
        <text fg={theme.muted}>♪ {msg}</text>
        <text fg={theme.surface1}>—</text>
      </>
    );
  }
  const lines = lyrics.synced ?? [];
  const idx = currentLine;
  const prev = idx > 0 && idx - 1 < lines.length ? lines[idx - 1] : null;
  const curr = idx >= 0 && idx < lines.length ? lines[idx] : null;
  const next = idx >= 0 && idx + 1 < lines.length ? lines[idx + 1] : null;
  return (
    <>
      <text fg={theme.surface1}>{SEPARATOR}</text>
      <text fg={prev ? theme.muted : theme.surface1}>{prev ? prev.text : "—"}</text>
      <text fg={curr ? theme.accent : theme.surface1}>{curr ? `▸ ${curr.text}` : "—"}</text>
      <text fg={next ? theme.subtext : theme.surface1}>{next ? next.text : "—"}</text>
    </>
  );
}
