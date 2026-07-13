import { useRef } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { AgentEvent } from "../agent/types";
import { countTools, toLines, type LineSegment } from "./reasoning";
import { SPINNER, theme } from "./theme";

interface ReasoningTranscriptProps {
  /** Ordered reasoning/tool events, coalesced by the app reducer. */
  events: AgentEvent[];
  /** When true, render just a one-line summary above the resolved track list. */
  collapsed?: boolean;
  /** Braille spinner frame index for the animated header glyph. */
  spinnerFrame?: number;
  /** Imperative handle owned by App so its keyboard handler can scroll the
   * transcript while the agent is still thinking (Up/Down land here instead of
   * moving a nonexistent selection). When omitted, a local ref is used. */
  scrollRef?: React.RefObject<ScrollBoxRenderable | null>;
  /** Height cap from App's layoutBudget, forwarded by ResultsList. The
   * transcript never measures the terminal itself (design D2). Unused when
   * collapsed. */
  maxHeight?: number;
}

const TONE_FG: Record<LineSegment["tone"], string> = {
  reasoning: theme.subtext,
  call: theme.accent,
  args: theme.subtext,
  ok: theme.green,
  error: theme.red,
};

export function ReasoningTranscript({ events, collapsed, spinnerFrame = 0, scrollRef: externalScrollRef, maxHeight = 5 }: ReasoningTranscriptProps) {
  const localScrollRef = useRef<ScrollBoxRenderable>(null);
  const scrollRef = externalScrollRef ?? localScrollRef;

  // Stick-to-bottom is handled by `stickyScroll` on the scrollbox, not by a
  // forced scrollTop write — that would override the framework's
  // pin-on-content-grow / disengage-on-manual-scroll state and yank the view
  // back to the tail every time the user scrolled up to read earlier reasoning.

  if (collapsed) {
    const toolCount = countTools(events);
    return (
      <box style={{ height: 1, flexShrink: 0, flexDirection: "row" }}>
        <text fg={theme.accent}> ✻ </text>
        <text fg={theme.subtext}>
          thought · {toolCount} {toolCount === 1 ? "tool" : "tools"}
        </text>
      </box>
    );
  }

  const lines = toLines(events);

  return (
    // flexGrow up to maxHeight: while events stream in, the transcript holds a
    // stable full-budget height so the input cluster doesn't slide down a row
    // every time a new reasoning line arrives.
    <box style={{ flexDirection: "column", flexGrow: 1, flexShrink: 1, minHeight: 3, maxHeight }}>
      <box style={{ flexDirection: "row", flexShrink: 0 }}>
        {/* Phase/tool status lives in StatusBar only — this header is just the
            agent identity glyph, not a second status line. */}
        <text fg={theme.accent}> {SPINNER[spinnerFrame % SPINNER.length]} music-agent</text>
      </box>
      <scrollbox
        ref={scrollRef}
        style={{ flexGrow: 1 }}
        // stickyScroll keeps the view pinned to the tail as events stream in,
        // disengages when the user scrolls up to read history, and re-engages
        // automatically once they scroll back down — the standard chat-tail.
        stickyScroll
        stickyStart="bottom"
        scrollbarOptions={{
          showArrows: false,
          trackOptions: { foregroundColor: theme.muted, backgroundColor: theme.surface1 },
        }}
      >
        {lines.length === 0 ? (
          <text fg={theme.muted}> · working…</text>
        ) : (
          lines.map((line) => (
            // Marker in a fixed column, text in its own flex column: wrapped
            // continuation lines land under the text, not under the marker.
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
    </box>
  );
}
