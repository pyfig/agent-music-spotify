import { describe, expect, test } from "bun:test";
import { argSummary, countTools, reduceEvents, resultSummary, toLines } from "../src/ui/reasoning";
import type { AgentEvent } from "../src/agent/types";

describe("reduceEvents", () => {
  test("coalesces consecutive reasoning deltas into one block", () => {
    let acc: AgentEvent[] = [];
    acc = reduceEvents(acc, { kind: "reasoning", delta: "pick " });
    acc = reduceEvents(acc, { kind: "reasoning", delta: "a set" });
    expect(acc).toEqual([{ kind: "reasoning", delta: "pick a set" }]);
  });

  test("tool events always append and break the reasoning block", () => {
    let acc: AgentEvent[] = [];
    acc = reduceEvents(acc, { kind: "reasoning", delta: "think" });
    acc = reduceEvents(acc, { kind: "tool_call", id: "c1", name: "searchTrack", args: { artist: "A" } });
    acc = reduceEvents(acc, { kind: "tool_result", id: "c1", name: "searchTrack", ok: true, result: "x" });
    // A reasoning delta after a tool starts a NEW block, not a merge.
    acc = reduceEvents(acc, { kind: "reasoning", delta: "more" });
    expect(acc.map((e) => e.kind)).toEqual(["reasoning", "tool_call", "tool_result", "reasoning"]);
    expect(acc[0]).toEqual({ kind: "reasoning", delta: "think" });
    expect(acc[3]).toEqual({ kind: "reasoning", delta: "more" });
  });
});

describe("countTools", () => {
  test("counts only tool_call events", () => {
    const events: AgentEvent[] = [
      { kind: "reasoning", delta: "x" },
      { kind: "tool_call", id: "1", name: "searchTrack", args: {} },
      { kind: "tool_result", id: "1", name: "searchTrack", ok: true, result: "y" },
      { kind: "tool_call", id: "2", name: "searchArtist", args: {} },
    ];
    expect(countTools(events)).toBe(2);
  });
});

describe("argSummary", () => {
  test("joins string/number values, skips objects", () => {
    expect(argSummary({ artist: "Burial", title: "Archangel" })).toBe("Burial, Archangel");
    expect(argSummary({ tracks: [1, 2], name: "X" })).toBe("X");
  });
  test("truncates long summaries", () => {
    const s = argSummary({ q: "x".repeat(80) });
    expect(s.length).toBe(40);
    expect(s.endsWith("…")).toBe(true);
  });
});

describe("toLines collapsing", () => {
  const call = (id: string, name = "queueTrack"): AgentEvent => ({
    kind: "tool_call",
    id,
    name,
    args: { uri: id },
  });
  const res = (id: string, ok = true, result: unknown = "ok"): AgentEvent => ({
    kind: "tool_result",
    id,
    name: "queueTrack",
    ok,
    result,
  });
  const text = (line: { segments: { text: string }[]; marker: string; depth: 0 | 1 }) =>
    `${"  ".repeat(line.depth)}${line.marker} ${line.segments.map((s) => s.text).join("")}`;

  test("two same-name calls stay uncollapsed", () => {
    const lines = toLines([call("1"), res("1"), call("2"), res("2")]);
    expect(lines.length).toBe(2);
    expect(text(lines[0]!)).toContain("queueTrack(1)");
    expect(text(lines[1]!)).toContain("queueTrack(2)");
  });

  test("run of 5 collapses to first call + tally line", () => {
    const events = ["1", "2", "3", "4", "5"].flatMap((id) => [call(id), res(id)]);
    const lines = toLines(events);
    expect(lines.length).toBe(2);
    expect(text(lines[0]!)).toContain("queueTrack(1)");
    expect(text(lines[1]!)).toBe("⏺ queueTrack ×4 ✓ 4 ok");
  });

  test("reasoning breaks the run", () => {
    const events: AgentEvent[] = [
      call("1"),
      res("1"),
      call("2"),
      res("2"),
      { kind: "reasoning", delta: "hmm" },
      call("3"),
      res("3"),
    ];
    const lines = toLines(events);
    // No group reaches 3 → all normal lines.
    expect(lines.length).toBe(4);
    expect(lines.every((l) => !text(l).includes("×"))).toBe(true);
  });

  test("failure in collapsed run shows tally with last error", () => {
    const events: AgentEvent[] = [
      call("1"),
      res("1"),
      call("2"),
      res("2", false, { error: "boom" }),
      call("3"),
      res("3"),
      call("4"),
      res("4"),
    ];
    const lines = toLines(events);
    expect(lines.length).toBe(2);
    expect(text(lines[1]!)).toBe("⏺ queueTrack ×3 ✓ 2 / ✗ 1 boom");
  });

  test("pending results show progress tally while streaming", () => {
    const events: AgentEvent[] = [call("1"), res("1"), call("2"), res("2"), call("3"), call("4")];
    const lines = toLines(events);
    expect(lines.length).toBe(2);
    expect(text(lines[1]!)).toBe("⏺ queueTrack ×3 … 1/3 done");
  });

  test("different tool breaks the run", () => {
    const events: AgentEvent[] = [
      call("1"),
      res("1"),
      call("2"),
      res("2"),
      call("s1", "searchTrack"),
      res("s1"),
      call("3"),
      res("3"),
    ];
    const lines = toLines(events);
    expect(lines.length).toBe(4);
  });
});

describe("resultSummary", () => {
  test("string passthrough", () => {
    expect(resultSummary("darker")).toBe("darker");
  });
  test("prefers artist–title over uri, error over both", () => {
    expect(resultSummary({ uri: "spotify:track:6f" })).toBe("spotify:track:6f");
    expect(resultSummary({ uri: "ytm:e8J15cWYfzU", artist: "Bibio", title: "Lovers" })).toBe("Bibio – Lovers");
    expect(resultSummary({ artist: "Bibio", title: "Lovers" })).toBe("Bibio – Lovers");
    expect(resultSummary({ error: "boom", uri: "ytm:x" })).toBe("boom");
  });
});

describe("toLines", () => {
  const text = (l: { segments: { text: string }[]; marker: string; depth: 0 | 1 }) =>
    `${"  ".repeat(l.depth)}${l.marker} ${l.segments.map((s) => s.text).join("")}`;

  test("pairs results with their calls by id into one line", () => {
    const events: AgentEvent[] = [
      { kind: "reasoning", delta: "line one\n\nline two" },
      { kind: "tool_call", id: "c1", name: "searchTrack", args: { artist: "Burial", title: "Archangel" } },
      { kind: "tool_call", id: "c2", name: "searchTrack", args: { artist: "Bibio" } },
      // Parallel dispatch: results arrive after both calls, out of order.
      { kind: "tool_result", id: "c2", name: "searchTrack", ok: false, result: { error: "not found" } },
      { kind: "tool_result", id: "c1", name: "searchTrack", ok: true, result: { uri: "ytm:6f", artist: "Burial", title: "Archangel" } },
    ];
    const lines = toLines(events);
    expect(lines.length).toBe(4); // 2 reasoning + 2 merged call lines
    expect(text(lines[0]!)).toBe("· line one");
    expect(text(lines[2]!)).toBe("⏺ searchTrack(Burial, Archangel) ✓ Burial – Archangel");
    expect(lines[2]!.segments.map((s) => s.tone)).toEqual(["call", "args", "ok"]);
    expect(text(lines[3]!)).toBe("⏺ searchTrack(Bibio) ✗ not found");
    expect(lines[3]!.segments.map((s) => s.tone)).toEqual(["call", "args", "error"]);
  });

  test("pending call renders without a result segment", () => {
    const lines = toLines([{ kind: "tool_call", id: "c1", name: "searchTrack", args: { q: "x" } }]);
    expect(text(lines[0]!)).toBe("⏺ searchTrack(x)");
  });

  test("orphan result without a matching call still renders", () => {
    const lines = toLines([
      { kind: "tool_result", id: "ghost", name: "searchTrack", ok: true, result: "done" },
    ]);
    expect(text(lines[0]!)).toBe("  ⎿ ✓ done");
  });
});
