import { useEffect, useRef } from "react";
import { useTerminalDimensions } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { AgentEvent } from "../agent/types";
import { displayArtist, theme } from "./theme";
import { ReasoningTranscript } from "./ReasoningTranscript";

export interface ResultLine {
  key: string;
  label: string;
  /** When set, artist renders a step quieter than the title so the eye scans titles. */
  artist?: string;
  title?: string;
  uri?: string;
  resolved: boolean;
}

interface ResultsListProps {
  title?: string;
  /** Track count rendered muted after the title so the name stays dominant. */
  count?: number;
  lines: ResultLine[];
  selectedIndex: number;
  currentlyPlayingUri?: string | null;
  isPlaying?: boolean;
  loading?: boolean;
  /** Ordered reasoning/tool transcript — rendered as a chat log while the agent
   * thinks (no resolved tracks yet), and collapsed to a summary line above the
   * resolved list once tracks arrive. */
  events?: AgentEvent[];
  /** Braille spinner frame for the transcript header glyph. */
  spinnerFrame?: number;
  /** Forwarded to ReasoningTranscript so App can scroll it while the agent is
   * still generating and the resolved list hasn't appeared yet. */
  reasoningScrollRef?: React.RefObject<ScrollBoxRenderable | null>;
}

export function ResultsList({ title, count, lines, selectedIndex, currentlyPlayingUri, isPlaying, loading, events = [], spinnerFrame, reasoningScrollRef }: ResultsListProps) {
  const { height } = useTerminalDimensions();
  const scrollRef = useRef<ScrollBoxRenderable>(null);

  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const viewportHeight = box.viewport.height;
    if (viewportHeight <= 0) return;
    if (selectedIndex < box.scrollTop) {
      box.scrollTop = selectedIndex;
    } else if (selectedIndex >= box.scrollTop + viewportHeight) {
      box.scrollTop = selectedIndex - viewportHeight + 1;
    }
  }, [selectedIndex]);

  // List flexes to fill space between banner and the input cluster below it.
  // maxHeight only caps the donut: ascii title(~2) + ConfirmActions(≤8) +
  // PromptInput(3) + StatusBar(1) + paddingTop(1) ≈ 15
  const maxHeight = Math.max(5, height - 15);

  if (lines.length === 0) {
    if (loading) {
      return <ReasoningTranscript events={events} spinnerFrame={spinnerFrame} scrollRef={reasoningScrollRef} />;
    }
    return (
      <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
        <text fg={theme.muted}>Describe a mood or theme, press Enter — get a playlist.</text>
      </box>
    );
  }
  // Track numbers right-align in a column sized to the largest index.
  const indexWidth = String(lines.length).length;

  return (
    // flexGrow fills to maxHeight the same way the loading-state
    // ReasoningTranscript does, so the input cluster below always lands on
    // the same row regardless of whether the list or the thinking log is
    // what's currently showing above it.
    <box style={{ flexDirection: "column", flexGrow: 1, flexShrink: 1, minHeight: 5, maxHeight }}>
      {/* Once generation finishes the title row below already names the
          playlist — a stale "thought · N tools" summary adds nothing. */}
      {events.length > 0 && loading && <ReasoningTranscript events={events} collapsed />}
      {title && (
        <box style={{ flexDirection: "row", flexShrink: 0 }}>
          <text fg={theme.accent}> {title}</text>
          {count !== undefined && (
            <text fg={theme.muted}>
              {" "}· {count} {count === 1 ? "track" : "tracks"}
            </text>
          )}
        </box>
      )}
      <scrollbox
        ref={scrollRef}
        style={{ flexGrow: 1 }}
        scrollbarOptions={{
          showArrows: false,
          trackOptions: { foregroundColor: theme.muted, backgroundColor: theme.surface1 },
        }}
      >
        {lines.map((line, i) => {
          const isCurrentlyPlaying = line.uri && currentlyPlayingUri === line.uri;
          const isSelected = i === selectedIndex;
          const icon = isCurrentlyPlaying ? (isPlaying ? " ▶ " : " ⏸ ") : isSelected ? " ❯ " : "   ";
          // Title carries the row's tone; artist sits a step quieter unless the
          // row is playing (whole row green) or unresolved (whole row dimmed).
          // The cursor is conveyed by bg + ❯ only — brightening its text made
          // it read as a second "active" track next to the green playing row.
          const titleFg = isCurrentlyPlaying ? theme.green : line.resolved ? theme.subtext : theme.muted;
          const artistFg = isCurrentlyPlaying ? theme.green : theme.muted;
          const rowBg = isSelected ? theme.surface1 : undefined;
          const num = String(i + 1).padStart(indexWidth);
          return (
            // Marker + index in fixed columns, label in its own flex column so
            // wrapped continuation lines keep a hanging indent.
            <box key={line.key} style={{ flexDirection: "row", backgroundColor: rowBg }}>
              <box style={{ width: 3, flexShrink: 0 }}>
                <text fg={isCurrentlyPlaying ? theme.green : theme.accent} bg={rowBg}>
                  {icon}
                </text>
              </box>
              <box style={{ width: indexWidth + 1, flexShrink: 0 }}>
                <text fg={theme.muted} bg={rowBg}>
                  {num}{" "}
                </text>
              </box>
              <box style={{ flexGrow: 1, flexShrink: 1 }}>
                {line.artist && line.title ? (
                  <text bg={rowBg} wrapMode="word">
                    <span fg={artistFg}>{displayArtist(line.artist)} — </span>
                    <span fg={titleFg}>{line.title}</span>
                    {line.resolved ? "" : <span fg={theme.red}>  not found</span>}
                  </text>
                ) : (
                  <text fg={titleFg} bg={rowBg} wrapMode="word">
                    {line.label}
                    {line.resolved ? "" : "  not found"}
                  </text>
                )}
              </box>
            </box>
          );
        })}
      </scrollbox>
    </box>
  );
}
