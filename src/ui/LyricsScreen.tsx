import type { LrcLine } from "../lyrics/lrc";
import type { LyricsResult } from "../lyrics/client";
import { theme } from "./theme";

interface LyricsScreenProps {
  lyrics: LyricsResult;
  currentLine: number;
  interpolatedPosMs: number;
}

export function LyricsScreen({ lyrics, currentLine, interpolatedPosMs }: LyricsScreenProps) {
  const durationMs = lyrics.synced?.length
    ? lyrics.synced[lyrics.synced.length - 1]!.timeMs + 5000
    : 0;
  const progressPct = durationMs > 0 ? Math.min(100, (interpolatedPosMs / durationMs) * 100) : 0;

  if (!lyrics.synced?.length && lyrics.plain) {
    return (
      <box
        title="lyrics (esc to close)"
        style={{ border: true, borderColor: theme.muted, flexDirection: "column", paddingLeft: 1, paddingRight: 1 }}
      >
        <text fg={theme.subtext}> (not synced)</text>
        {lyrics.plain.split("\n").map((line, i) => (
          <text key={`p${i}`} fg={theme.fg}>{line}</text>
        ))}
      </box>
    );
  }

  const lines = lyrics.synced ?? [];
  // Show from ~3 lines before current to the end, with current centered.
  const start = Math.max(0, currentLine - 3);
  const visible = lines.slice(start);

  return (
    <box
      title="lyrics (esc to close)"
      style={{ border: true, borderColor: theme.muted, flexDirection: "column", paddingLeft: 1, paddingRight: 1 }}
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
            {isCurrent ? "▸ " : "  "}
            {line.text}
          </text>
        );
      })}
    </box>
  );
}

export type { LrcLine };
