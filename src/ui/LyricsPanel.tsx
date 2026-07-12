import type { LyricsResult } from "../lyrics/client";
import { theme } from "./theme";

interface LyricsPanelProps {
  lyrics: LyricsResult;
  currentLine: number;
}

/**
 * Compact 3-row lyrics panel: prev / current / next, horizontally centered.
 * The current line is the middle row — the karaoke pin of the compact view.
 * Placeholder rows keep the height constant at LYRICS_PANEL_ROWS.
 */
export function LyricsPanel({ lyrics, currentLine }: LyricsPanelProps) {
  const lines = lyrics.synced ?? [];
  const idx = currentLine;
  const prev = idx > 0 && idx - 1 < lines.length ? lines[idx - 1] : null;
  const curr = idx >= 0 && idx < lines.length ? lines[idx] : null;
  const next = idx >= 0 && idx + 1 < lines.length ? lines[idx + 1] : null;
  return (
    <>
      <text fg={prev ? theme.muted : theme.surface1}>{prev ? prev.text : "—"}</text>
      <text fg={curr ? theme.accent : theme.surface1}>{curr ? `▸ ${curr.text}` : "—"}</text>
      <text fg={next ? theme.subtext : theme.surface1}>{next ? next.text : "—"}</text>
    </>
  );
}
