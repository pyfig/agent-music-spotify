import { useEffect, useRef } from "react";
import { useTerminalDimensions } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { AgentEvent } from "../agent/types";
import { countTools, toLines, type TranscriptLine } from "./reasoning";
import { SPINNER, theme } from "./theme";

interface ReasoningTranscriptProps {
  /** Ordered reasoning/tool events, coalesced by the app reducer. */
  events: AgentEvent[];
  /** When true, render just a one-line summary above the resolved track list. */
  collapsed?: boolean;
  /** Braille spinner frame index for the animated header glyph. */
  spinnerFrame?: number;
}

const TONE_FG: Record<TranscriptLine["tone"], string> = {
  reasoning: theme.subtext,
  call: theme.accent,
  ok: theme.green,
  error: theme.red,
};

export function ReasoningTranscript({ events, collapsed, spinnerFrame = 0 }: ReasoningTranscriptProps) {
  const { height } = useTerminalDimensions();
  const scrollRef = useRef<ScrollBoxRenderable>(null);

  // Auto-scroll to the latest line as events stream in (mirrors ResultsList).
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    box.scrollTop = Number.MAX_SAFE_INTEGER;
  }, [events]);

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
  // Same vertical budget as the resolved list so header + input + status fit.
  const maxHeight = Math.max(5, height - 15);

  return (
    <box style={{ flexDirection: "column", flexGrow: 1, flexShrink: 1, minHeight: 3, maxHeight }}>
      <box style={{ flexDirection: "row", flexShrink: 0 }}>
        <text fg={theme.accent}> {SPINNER[spinnerFrame % SPINNER.length]} music-agent</text>
        <text fg={theme.subtext}> · thinking</text>
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
          <text fg={theme.muted}> · working…</text>
        ) : (
          lines.map((line) => (
            <text key={line.key} fg={TONE_FG[line.tone]} wrapMode="word">
              {line.text}
            </text>
          ))
        )}
      </scrollbox>
    </box>
  );
}
