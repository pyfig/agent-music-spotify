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

/** Compact one-line result: string as-is, title/uri/error picked out, else JSON. */
export function resultSummary(result: unknown): string {
  let s: string;
  if (typeof result === "string") {
    s = result;
  } else if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.error === "string") s = r.error;
    // Prefer human-readable names over opaque URIs like `ytm:e8J15cWYfzU`.
    else if (typeof r.title === "string")
      s = typeof r.artist === "string" ? `${r.artist} – ${r.title}` : r.title;
    else if (typeof r.uri === "string") s = r.uri;
    else s = JSON.stringify(result);
  } else {
    s = String(result);
  }
  return s.length > 48 ? `${s.slice(0, 47)}…` : s;
}

export interface LineSegment {
  text: string;
  /** Theme role — the component maps this to a color token. */
  tone: "reasoning" | "call" | "args" | "ok" | "error";
}

export interface TranscriptLine {
  key: string;
  segments: LineSegment[];
  /** Rendered in its own fixed-width column so wrapped continuation lines
   * keep a hanging indent under the text instead of column 0. */
  marker: string;
  /** Extra indent step for lines nested under a call (orphan results). */
  depth: 0 | 1;
}

/** Cap rendered transcript lines so a multi-KB thinking stream can't blow up
 * layout; the scrollbox keeps the tail visible. */
export const MAX_LINES = 200;

/**
 * Flatten ordered events into renderable lines. Each tool result is paired
 * with its call by id and rendered inline on the call's line — with parallel
 * dispatch results arrive long after their calls, so appending them in stream
 * order would produce an unreadable orphan column of `⎿ ✓ …` lines.
 */
export function toLines(events: AgentEvent[]): TranscriptLine[] {
  const results = new Map<string, Extract<AgentEvent, { kind: "tool_result" }>>();
  for (const e of events) if (e.kind === "tool_result") results.set(e.id, e);

  const lines: TranscriptLine[] = [];
  const paired = new Set<string>();

  const callLine = (e: Extract<AgentEvent, { kind: "tool_call" }>, i: number) => {
    const segments: LineSegment[] = [
      { text: e.name, tone: "call" },
      { text: `(${argSummary(e.args)})`, tone: "args" },
    ];
    const r = results.get(e.id);
    if (r) {
      paired.add(e.id);
      segments.push({
        text: ` ${r.ok ? "✓" : "✗"} ${resultSummary(r.result)}`,
        tone: r.ok ? "ok" : "error",
      });
    }
    lines.push({ key: `c${i}`, segments, marker: "⏺", depth: 0 });
  };

  const orphanLine = (e: Extract<AgentEvent, { kind: "tool_result" }>, i: number) => {
    // Defensive: a result whose call never appeared in the stream. Nested
    // one step under its (missing) call, same as a paired result would read.
    lines.push({
      key: `t${i}`,
      segments: [{ text: `${e.ok ? "✓" : "✗"} ${resultSummary(e.result)}`, tone: e.ok ? "ok" : "error" }],
      marker: "⎿",
      depth: 1,
    });
  };

  let i = 0;
  while (i < events.length) {
    const e = events[i]!;
    if (e.kind === "reasoning") {
      e.delta
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .forEach((l, j) =>
          lines.push({
            key: `r${i}-${j}`,
            segments: [{ text: l, tone: "reasoning" }],
            marker: "·",
            depth: 0,
          }),
        );
      i++;
    } else if (e.kind === "tool_call") {
      // Gather the run of same-name calls; interleaved results are transparent
      // since they render inline on their call's line anyway.
      const run: number[] = [i];
      let j = i + 1;
      let spanEnd = i + 1;
      while (j < events.length) {
        const n = events[j]!;
        if (n.kind === "tool_result") {
          j++;
          continue;
        }
        if (n.kind === "tool_call" && n.name === e.name) {
          run.push(j);
          j++;
          spanEnd = j;
          continue;
        }
        break;
      }

      if (run.length <= 2) {
        callLine(e, i);
        i++;
      } else {
        // Collapse: first call keeps its full line, the rest fold into one
        // tally line so a 12-track queue doesn't flood the transcript.
        callLine(e, i);
        const rest = run.slice(1).map((k) => events[k] as Extract<AgentEvent, { kind: "tool_call" }>);
        let ok = 0;
        let err = 0;
        let lastError: unknown;
        for (const c of rest) {
          const r = results.get(c.id);
          if (!r) continue;
          paired.add(c.id);
          if (r.ok) ok++;
          else {
            err++;
            lastError = r.result;
          }
        }
        const segments: LineSegment[] = [
          { text: e.name, tone: "call" },
          { text: ` ×${rest.length}`, tone: "args" },
        ];
        const done = ok + err;
        if (done < rest.length) {
          segments.push({ text: ` … ${done}/${rest.length} done`, tone: "args" });
        } else if (err > 0) {
          segments.push({ text: ` ✓ ${ok}`, tone: "ok" });
          segments.push({ text: ` / ✗ ${err} ${resultSummary(lastError)}`, tone: "error" });
        } else {
          segments.push({ text: ` ✓ ${ok} ok`, tone: "ok" });
        }
        lines.push({ key: `g${run[1]}`, segments, marker: "⏺", depth: 0 });

        // Orphan results inside the span still get their defensive line.
        for (let k = i + 1; k < spanEnd; k++) {
          const n = events[k]!;
          if (n.kind === "tool_result" && !paired.has(n.id)) orphanLine(n, k);
        }
        i = spanEnd;
      }
    } else {
      if (!paired.has(e.id)) orphanLine(e, i);
      i++;
    }
  }
  return lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines;
}

/** Number of tool calls in the transcript (for the collapsed summary). */
export function countTools(events: AgentEvent[]): number {
  return events.reduce((n, e) => (e.kind === "tool_call" ? n + 1 : n), 0);
}
