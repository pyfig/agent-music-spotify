import { useTerminalDimensions } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { HistoryEntry } from "../core/history";
import { toLines, type LineSegment } from "./reasoning";
import { selectTheme, theme } from "./theme";

interface HistoryScreenProps {
  /** Newest-first session list. */
  entries: HistoryEntry[];
  /** When set, the detail view (stored reasoning transcript) is shown. */
  detail: HistoryEntry | null;
  focused: boolean;
  onPick: (entry: HistoryEntry) => void;
  /** Imperative handle so App's keyboard handler can scroll the transcript. */
  scrollRef: React.RefObject<ScrollBoxRenderable | null>;
}

const TONE_FG: Record<LineSegment["tone"], string> = {
  reasoning: theme.subtext,
  call: theme.accent,
  args: theme.subtext,
  ok: theme.green,
  error: theme.red,
};

function fmtHeader(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

/**
 * /history overlay: level 0 is a session list (LLM-summarized titles), level 1
 * shows the stored reasoning transcript of the picked session. Esc navigation
 * (detail → list → close) is owned by App's useKeyboard.
 */
export function HistoryScreen({ entries, detail, focused, onPick, scrollRef }: HistoryScreenProps) {
  const { height } = useTerminalDimensions();

  if (detail) {
    const lines = toLines(detail.events);
    // Fixed height: the scrollbox inside needs a definite vertical budget —
    // with only maxHeight the box shrinks to its text rows and the flexGrow
    // scrollbox collapses to zero.
    const boxHeight = Math.max(8, height - 10);
    return (
      <box
        title={`${detail.title} (esc to go back)`}
        style={{ border: true, borderColor: theme.muted, flexDirection: "column", paddingLeft: 1, paddingRight: 1, height: boxHeight }}
      >
        <box style={{ height: 1, flexShrink: 0 }}>
          <text fg={theme.subtext}>{`${fmtHeader(detail.header)} · ${detail.tracks.length} tracks`}</text>
        </box>
        <box style={{ height: 1, flexShrink: 0 }}>
          <text fg={theme.fg}>{`» ${detail.prompt}`}</text>
        </box>
        <scrollbox
          ref={scrollRef}
          style={{ flexGrow: 1 }}
          scrollbarOptions={{
            showArrows: false,
            trackOptions: { foregroundColor: theme.muted, backgroundColor: theme.surface1 },
          }}
        >
          {lines.length === 0 ? (
            <text fg={theme.muted}> (no reasoning recorded)</text>
          ) : (
            lines.map((line) => (
              <box key={line.key} style={{ flexDirection: "row" }}>
                <box style={{ width: 2 + line.depth * 2, flexShrink: 0 }}>
                  <text fg={theme.muted}>{" ".repeat(line.depth * 2)}{line.marker}</text>
                </box>
                <box style={{ flexGrow: 1, flexShrink: 1 }}>
                  <text wrapMode="word">
                    {line.segments.map((seg, i) => (
                      <span key={i} fg={TONE_FG[seg.tone]}>
                        {seg.text}
                      </span>
                    ))}
                  </text>
                </box>
              </box>
            ))
          )}
        </scrollbox>
        <box style={{ height: 1, flexShrink: 0 }}>
          <text fg={theme.muted}>enter — load & listen · c — copy reasoning · t — copy tracks · esc — back</text>
        </box>
      </box>
    );
  }

  const options = entries.map((e, i) => ({
    name: e.title,
    description: `${fmtHeader(e.header)} · ${e.tracks.length} tracks`,
    value: String(i),
  }));

  return (
    <box
      title="history (esc to close)"
      style={{ border: true, borderColor: theme.muted, height: Math.min(options.length * 2 + 2, Math.max(6, height - 10)) }}
    >
      <select
        focused={focused}
        options={options}
        onSelect={(_, option) => {
          const idx = Number(option?.value);
          const entry = entries[idx];
          if (entry) onPick(entry);
        }}
        style={{ flexGrow: 1, ...selectTheme }}
      />
    </box>
  );
}
