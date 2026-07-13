import { describe, expect, test } from "bun:test";
import type { ReactElement, ReactNode } from "react";
import { LyricsScreen } from "../src/ui/LyricsScreen";
import { LyricsPanel } from "../src/ui/LyricsPanel";
import type { LyricsResult } from "../src/lyrics/client";

// These components return plain element trees over opentui intrinsics
// ("box"/"text"), so we assert on the tree directly — no renderer needed,
// same spirit as the other pure UI tests in this suite.

function flatten(node: ReactNode): ReactElement[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (typeof node === "object" && "props" in (node as any)) {
    const el = node as ReactElement;
    const children = flatten((el.props as any).children);
    return [el, ...children];
  }
  return [];
}

function textRows(root: ReactNode): string[] {
  return flatten(root)
    .filter((el) => el.type === "text")
    .map((el) => childText((el.props as any).children));
}

function styleOf(root: ReactNode): any {
  const el = flatten(root)[0]!;
  return (el.props as any).style;
}

function childText(children: ReactNode): string {
  if (children === null || children === undefined || typeof children === "boolean") return "";
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(childText).join("");
  return "";
}

function makeLyrics(lineCount: number): LyricsResult {
  return {
    synced: Array.from({ length: lineCount }, (_, i) => ({ timeMs: i * 1000, text: `line ${i}` })),
  };
}

describe("LyricsScreen karaoke window", () => {
  test("renders at most maxLines lyric rows", () => {
    const el = LyricsScreen({ lyrics: makeLyrics(50), currentLine: 20, interpolatedPosMs: 20000, maxLines: 9 });
    const rows = textRows(el).filter((t) => t.includes("line "));
    expect(rows).toHaveLength(9);
  });

  test("current line sits at the vertical middle of the window mid-song", () => {
    const el = LyricsScreen({ lyrics: makeLyrics(50), currentLine: 20, interpolatedPosMs: 20000, maxLines: 9 });
    const rows = textRows(el).filter((t) => t.includes("line "));
    // Window start 16 → current (20) is the 5th of 9 rows (index 4) and marked.
    expect(rows[4]).toBe("▸ line 20");
    expect(rows[0]).toBe("line 16");
    expect(rows[8]).toBe("line 24");
  });

  test("advance shifts the window one row, marker row stays put", () => {
    const at20 = textRows(LyricsScreen({ lyrics: makeLyrics(50), currentLine: 20, interpolatedPosMs: 0, maxLines: 9 })).filter((t) => t.includes("line "));
    const at21 = textRows(LyricsScreen({ lyrics: makeLyrics(50), currentLine: 21, interpolatedPosMs: 0, maxLines: 9 })).filter((t) => t.includes("line "));
    expect(at20[4]).toBe("▸ line 20");
    expect(at21[4]).toBe("▸ line 21");
    expect(at21[0]).toBe("line 17");
  });

  test("window clamps at the end of the sheet", () => {
    const el = LyricsScreen({ lyrics: makeLyrics(50), currentLine: 49, interpolatedPosMs: 0, maxLines: 9 });
    const rows = textRows(el).filter((t) => t.includes("line "));
    expect(rows[0]).toBe("line 41");
    expect(rows[8]).toBe("▸ line 49");
  });

  test("lyric column is horizontally centered", () => {
    const el = LyricsScreen({ lyrics: makeLyrics(50), currentLine: 20, interpolatedPosMs: 0, maxLines: 9 });
    expect(styleOf(el).alignItems).toBe("center");
  });

  test("plain-only lyrics are window-bounded and centered", () => {
    const plain = { plain: Array.from({ length: 40 }, (_, i) => `plain ${i}`).join("\n") };
    const el = LyricsScreen({ lyrics: plain, currentLine: -1, interpolatedPosMs: 0, maxLines: 9 });
    expect(styleOf(el).alignItems).toBe("center");
    const rows = textRows(el).filter((t) => t.includes("plain "));
    expect(rows).toHaveLength(9);
    expect(rows[0]).toBe("plain 0");
  });
});

describe("LyricsPanel", () => {
  const SEP = "── ♪ lyrics ──";

  test("prev / current / next rows with the middle row marked", () => {
    const el = LyricsPanel({ state: "synced", lyrics: makeLyrics(10), currentLine: 5 });
    const rows = textRows(el);
    expect(rows).toEqual([SEP, "line 4", "▸ line 5", "line 6"]);
  });

  test("placeholders keep the panel at three rows on the first line", () => {
    const el = LyricsPanel({ state: "synced", lyrics: makeLyrics(10), currentLine: 0 });
    const rows = textRows(el);
    expect(rows).toEqual([SEP, "—", "▸ line 0", "line 1"]);
  });

  test("no current line yet renders placeholders, still three rows", () => {
    const el = LyricsPanel({ state: "synced", lyrics: makeLyrics(10), currentLine: -1 });
    const rows = textRows(el);
    expect(rows).toEqual([SEP, "—", "—", "—"]);
  });

  test.each([
    ["waiting", "waiting for playback…"],
    ["loading", "loading lyrics…"],
    ["none", "no synchronized lyrics for this track"],
    ["error", "lyrics unavailable — fetch failed"],
  ] as const)("state %s renders its message at constant row count", (state, msg) => {
    const el = LyricsPanel({ state, lyrics: null, currentLine: -1 });
    const rows = textRows(el);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toBe(SEP);
    expect(rows[2]).toBe(`♪ ${msg}`);
  });
});
