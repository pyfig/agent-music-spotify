import { describe, expect, test } from "bun:test";
import { parseLrc, currentLineIndex, type LrcLine } from "../src/lyrics/lrc";

describe("parseLrc", () => {
  test("parses standard LRC lines", () => {
    const result = parseLrc("[00:12.00]Line 1\n[00:15.50]Line 2\n[00:20.00]Line 3");
    expect(result).toEqual([
      { timeMs: 12000, text: "Line 1" },
      { timeMs: 15500, text: "Line 2" },
      { timeMs: 20000, text: "Line 3" },
    ]);
  });

  test("handles 2-digit centiseconds (multiplies by 10)", () => {
    const result = parseLrc("[01:05.30]Hello");
    expect(result[0]!).toEqual({ timeMs: 65300, text: "Hello" });
  });

  test("handles 3-digit centiseconds", () => {
    const result = parseLrc("[01:05.300]Hello");
    expect(result[0]!).toEqual({ timeMs: 65300, text: "Hello" });
  });

  test("skips empty lines and whitespace-only lines", () => {
    const result = parseLrc("[00:01.00]A\n\n[00:02.00]B\n  \n[00:03.00]C");
    expect(result).toHaveLength(3);
  });

  test("skips metadata tags (ti, ar, al, by, offset, re, ve, la)", () => {
    const result = parseLrc(
      "[ti:Test Title]\n[ar:Test Artist]\n[al:Test Album]\n[by:Someone]\n[offset:500]\n[00:01.00]Start",
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe("Start");
  });

  test("tolerates repeated timestamps (multiple lines at same time)", () => {
    const result = parseLrc("[00:10.00]First\n[00:10.00]Second\n[00:20.00]Third");
    expect(result).toHaveLength(3);
    expect(result[0]!.text).toBe("First");
    expect(result[1]!.text).toBe("Second");
    expect(result[0]!.timeMs).toBe(result[1]!.timeMs);
  });

  test("sorts unsorted input by timestamp", () => {
    const result = parseLrc("[00:20.00]B\n[00:10.00]A\n[00:30.00]C");
    expect(result.map((l) => l.text)).toEqual(["A", "B", "C"]);
  });

  test("returns empty array for empty input", () => {
    expect(parseLrc("")).toEqual([]);
  });

  test("returns empty array for only tags", () => {
    expect(parseLrc("[ti:Title]\n[ar:Artist]")).toEqual([]);
  });

  test("handles different minute formats", () => {
    const result = parseLrc("[0:00.00]A\n[1:00.00]B\n[12:34.56]C");
    expect(result[0]!.timeMs).toBe(0);
    expect(result[1]!.timeMs).toBe(60000);
    expect(result[2]!.timeMs).toBe(754560);
  });

  test("strips surrounding whitespace from text", () => {
    const result = parseLrc("[00:01.00]  Hello World  ");
    expect(result[0]!.text).toBe("Hello World");
  });
});

describe("currentLineIndex", () => {
  const lines: LrcLine[] = [
    { timeMs: 10000, text: "Ten" },
    { timeMs: 20000, text: "Twenty" },
    { timeMs: 30000, text: "Thirty" },
    { timeMs: 50000, text: "Fifty" },
  ];

  test("returns -1 for position before first line", () => {
    expect(currentLineIndex(lines, 0)).toBe(-1);
    expect(currentLineIndex(lines, 9999)).toBe(-1);
  });

  test("returns index 0 at exact first line timestamp", () => {
    expect(currentLineIndex(lines, 10000)).toBe(0);
  });

  test("returns correct line for position between timestamps", () => {
    expect(currentLineIndex(lines, 15000)).toBe(0);
    expect(currentLineIndex(lines, 25000)).toBe(1);
    expect(currentLineIndex(lines, 35000)).toBe(2);
  });

  test("returns last line for position beyond all timestamps", () => {
    expect(currentLineIndex(lines, 60000)).toBe(3);
    expect(currentLineIndex(lines, 99999)).toBe(3);
  });

  test("returns -1 for empty lines array", () => {
    expect(currentLineIndex([], 1000)).toBe(-1);
  });

  test("single line always returns 0 at or after its timestamp", () => {
    const single: LrcLine[] = [{ timeMs: 5000, text: "Go" }];
    expect(currentLineIndex(single, 5000)).toBe(0);
    expect(currentLineIndex(single, 10000)).toBe(0);
  });

  test("repeated timestamps: returns the earlier entry for same time", () => {
    const dup: LrcLine[] = [
      { timeMs: 10000, text: "A" },
      { timeMs: 10000, text: "B" },
      { timeMs: 20000, text: "C" },
    ];
    const idx = currentLineIndex(dup, 15000);
    expect(idx).toBe(1);
  });
});
