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

describe("resultSummary", () => {
  test("string passthrough", () => {
    expect(resultSummary("darker")).toBe("darker");
  });
  test("picks uri, artist–title, and error", () => {
    expect(resultSummary({ uri: "spotify:track:6f" })).toBe("spotify:track:6f");
    expect(resultSummary({ artist: "Bibio", title: "Lovers" })).toBe("Bibio – Lovers");
    expect(resultSummary({ error: "boom" })).toBe("boom");
  });
});

describe("toLines", () => {
  test("renders reasoning, call, and result tones in order", () => {
    const events: AgentEvent[] = [
      { kind: "reasoning", delta: "line one\n\nline two" },
      { kind: "tool_call", id: "c1", name: "searchTrack", args: { artist: "Burial", title: "Archangel" } },
      { kind: "tool_result", id: "c1", name: "searchTrack", ok: true, result: { uri: "spotify:track:6f" } },
      { kind: "tool_result", id: "c2", name: "searchTrack", ok: false, result: { error: "not found" } },
    ];
    const lines = toLines(events);
    expect(lines.map((l) => l.tone)).toEqual(["reasoning", "reasoning", "call", "ok", "error"]);
    expect(lines[0]!.text).toBe("· line one");
    expect(lines[2]!.text).toBe("⏺ searchTrack(Burial, Archangel)");
    expect(lines[3]!.text).toBe("  ⎿ ✓ spotify:track:6f");
    expect(lines[4]!.text).toBe("  ⎿ ✗ not found");
  });
});
