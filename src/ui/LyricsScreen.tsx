import type { LrcLine } from "../lyrics/lrc";
import type { LyricsResult } from "../lyrics/client";
import { karaokeWindow } from "./layout";
import { theme } from "./theme";

interface LyricsScreenProps {
  lyrics: LyricsResult;
  currentLine: number;
  interpolatedPosMs: number;
  /** Lyric lines the viewport may show (budget.lyricsScreenRows). */
  maxLines: number;
}

export function LyricsScreen({ lyrics, currentLine, interpolatedPosMs, maxLines }: LyricsScreenProps) {
  const durationMs = lyrics.synced?.length
    ? lyrics.synced[lyrics.synced.length - 1]!.timeMs + 5000
    : 0;
  const progressPct = durationMs > 0 ? Math.min(100, (interpolatedPosMs / durationMs) * 100) : 0;

  if (!lyrics.synced?.length && lyrics.plain) {
    const plainLines = lyrics.plain.split("\n");
    const { start, end } = karaokeWindow(plainLines.length, -1, maxLines);
    return (
      <box
        title="lyrics (esc to close)"
        style={{ border: true, borderColor: theme.muted, flexDirection: "column", alignItems: "center" }}
      >
        <text fg={theme.subtext}>(not synced)</text>
        {plainLines.slice(start, end).map((line, i) => (
          <text key={`p${start + i}`} fg={theme.fg}>{line}</text>
        ))}
      </box>
    );
  }

  const lines = lyrics.synced ?? [];
  // Karaoke scroll: current line pinned to the vertical middle of the window,
  // clamped at the sheet's edges; the window moves one line per advance.
  const { start, end } = karaokeWindow(lines.length, currentLine, maxLines);
  const visible = lines.slice(start, end);

  return (
    <box
      title="lyrics (esc to close)"
      style={{ border: true, borderColor: theme.muted, flexDirection: "column", alignItems: "center" }}
    >
      <box style={{ height: 1, flexShrink: 0 }}>
        <text fg={theme.subtext}>
          {progressPct.toFixed(0)}%
        </text>
      </box>
      {visible.map((line, i) => {
        const idx = start + i;
        const isCurrent = idx === currentLine;
        return (
          <text
            key={`l${idx}`}
            fg={isCurrent ? theme.accent : idx < currentLine ? theme.muted : theme.fg}
          >
            {isCurrent ? "▸ " : ""}
            {line.text}
          </text>
        );
      })}
    </box>
  );
}

export type { LrcLine };
