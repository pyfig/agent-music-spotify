import { useEffect, useRef } from "react";
import { useTerminalDimensions } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { theme } from "./theme";
import { DonutAnimation } from "./DonutAnimation";

export interface ResultLine {
  key: string;
  label: string;
  uri?: string;
  resolved: boolean;
}

interface ResultsListProps {
  title?: string;
  lines: ResultLine[];
  selectedIndex: number;
  currentlyPlayingUri?: string | null;
  isPlaying?: boolean;
  loading?: boolean;
}

export function ResultsList({ title, lines, selectedIndex, currentlyPlayingUri, isPlaying, loading }: ResultsListProps) {
  const { width, height } = useTerminalDimensions();
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
      const dw = Math.min(64, Math.max(28, Math.floor(width * 0.6)));
      const dh = Math.min(18, Math.max(8, maxHeight));
      return (
        <box
          style={{
            flexGrow: 1,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <DonutAnimation width={dw} height={dh} />
        </box>
      );
    }
    return (
      <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
        <text fg={theme.muted}>Describe a mood or theme, press Enter — get a playlist.</text>
      </box>
    );
  }
  return (
    <box style={{ flexDirection: "column", flexGrow: 1, flexShrink: 1, minHeight: 5, maxHeight }}>
      {title && <text fg={theme.accent}> {title}</text>}
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
          const icon = isCurrentlyPlaying ? (isPlaying ? " ▶ " : " ⏸ ") : i === selectedIndex ? " ❯ " : "   ";
          const fgColor = isCurrentlyPlaying
            ? theme.green
            : line.resolved
              ? i === selectedIndex
                ? theme.fg
                : theme.subtext
              : theme.red;
          const rowBg = i === selectedIndex ? theme.surface1 : undefined;
          return (
            // Marker in a fixed column, label in its own flex column so wrapped
            // continuation lines keep a hanging indent instead of hitting col 0.
            <box key={line.key} style={{ flexDirection: "row", backgroundColor: rowBg }}>
              <box style={{ width: 3, flexShrink: 0 }}>
                <text fg={fgColor} bg={rowBg}>
                  {icon}
                </text>
              </box>
              <box style={{ flexGrow: 1, flexShrink: 1 }}>
                <text fg={fgColor} bg={rowBg} wrapMode="word">
                  {line.label}
                  {line.resolved ? "" : "  (not found)"}
                </text>
              </box>
            </box>
          );
        })}
      </scrollbox>
    </box>
  );
}
