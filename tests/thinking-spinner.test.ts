import { describe, expect, test } from "bun:test";
import { SPINNER, THINKING_VERBS } from "../src/ui/theme";
import { progressLabel, thinkingVerb } from "../src/ui/StatusBar";

describe("SPINNER frames", () => {
  test("every frame is a single cell so the status row never shifts", () => {
    for (const frame of SPINNER) {
      expect(frame.length).toBe(1);
    }
  });
});

describe("THINKING_VERBS", () => {
  test("every verb is at most 14 printable chars and ends with …", () => {
    for (const verb of THINKING_VERBS) {
      expect(verb.length).toBeLessThanOrEqual(14);
      expect(verb.endsWith("…")).toBe(true);
    }
  });
});

describe("thinkingVerb rotation", () => {
  test("advances every 3 elapsed seconds, sequentially", () => {
    expect(thinkingVerb(0)).toBe(THINKING_VERBS[0]!);
    expect(thinkingVerb(2)).toBe(THINKING_VERBS[0]!);
    expect(thinkingVerb(3)).toBe(THINKING_VERBS[1]!);
    expect(thinkingVerb(5)).toBe(THINKING_VERBS[1]!);
    expect(thinkingVerb(6)).toBe(THINKING_VERBS[2]!);
  });

  test("wraps around after a full cycle", () => {
    expect(thinkingVerb(THINKING_VERBS.length * 3)).toBe(THINKING_VERBS[0]!);
    expect(thinkingVerb(24)).toBe(THINKING_VERBS[(24 / 3) % THINKING_VERBS.length]!);
  });
});

describe("progressLabel", () => {
  test("thinking and clarifying show the elapsed-selected verb, no token count", () => {
    for (const phase of ["thinking", "clarifying"] as const) {
      for (const elapsed of [0, 3, 7, 30]) {
        const label = progressLabel({ phase }, elapsed);
        expect(label).toBe(thinkingVerb(elapsed));
        expect(label).not.toContain("n=");
      }
    }
  });

  test("non-reasoning phases keep their labels", () => {
    expect(progressLabel({ phase: "resolving", current: 3, total: 10 }, 5)).toContain("resolving");
    expect(progressLabel({ phase: "resolving", current: 3, total: 10 }, 5)).toContain("3/10");
    expect(progressLabel({ phase: "tool", toolName: "search" }, 5)).toBe("tool: search");
    expect(progressLabel({ phase: "creating" }, 5)).toBe("creating playlist");
    expect(progressLabel({ phase: "adding" }, 5)).toBe("adding tracks");
    expect(progressLabel({ phase: "done" }, 5)).toBe("done");
  });
});
