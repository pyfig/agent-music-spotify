import type { AgentEvent } from "../agent/types";

/**
 * Fold a streamed agent event into the transcript. Consecutive reasoning
 * deltas coalesce into a single thinking block; tool calls/results always
 * append so call order is preserved for the chat-style view.
 */
export function reduceEvents(prev: AgentEvent[], e: AgentEvent): AgentEvent[] {
  if (e.kind === "reasoning") {
    const last = prev[prev.length - 1];
    if (last && last.kind === "reasoning") {
      return [...prev.slice(0, -1), { kind: "reasoning", delta: last.delta + e.delta }];
    }
  }
  return [...prev, e];
}

/** Values-only arg preview: `searchTrack(Burial, Archangel)`. */
export function argSummary(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const v of Object.values(args)) {
    if (typeof v === "string" || typeof v === "number") parts.push(String(v));
    if (parts.length >= 3) break;
  }
  const s = parts.join(", ");
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
}

/** Compact one-line result: string as-is, uri/title/error picked out, else JSON. */
export function resultSummary(result: unknown): string {
  let s: string;
  if (typeof result === "string") {
    s = result;
  } else if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.error === "string") s = r.error;
    else if (typeof r.uri === "string") s = r.uri;
    else if (typeof r.title === "string")
      s = typeof r.artist === "string" ? `${r.artist} – ${r.title}` : r.title;
    else s = JSON.stringify(result);
  } else {
    s = String(result);
  }
  return s.length > 48 ? `${s.slice(0, 47)}…` : s;
}

export interface TranscriptLine {
  key: string;
  text: string;
  /** Theme role — the component maps this to a color token. */
  tone: "reasoning" | "call" | "ok" | "error";
}

/** Cap rendered transcript lines so a multi-KB thinking stream can't blow up
 * layout; the scrollbox keeps the tail visible. */
export const MAX_LINES = 200;

/**
 * Flatten ordered events into renderable lines (reasoning split per newline,
 * tool call + result as compact one-liners).
 */
export function toLines(events: AgentEvent[]): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  events.forEach((e, i) => {
    if (e.kind === "reasoning") {
      e.delta
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .forEach((l, j) => lines.push({ key: `r${i}-${j}`, text: `· ${l}`, tone: "reasoning" }));
    } else if (e.kind === "tool_call") {
      lines.push({ key: `c${i}`, text: `⏺ ${e.name}(${argSummary(e.args)})`, tone: "call" });
    } else {
      const mark = e.ok ? "✓" : "✗";
      lines.push({
        key: `t${i}`,
        text: `  ⎿ ${mark} ${resultSummary(e.result)}`,
        tone: e.ok ? "ok" : "error",
      });
    }
  });
  return lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines;
}

/** Number of tool calls in the transcript (for the collapsed summary). */
export function countTools(events: AgentEvent[]): number {
  return events.reduce((n, e) => (e.kind === "tool_call" ? n + 1 : n), 0);
}
