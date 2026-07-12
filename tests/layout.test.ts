import { describe, expect, test } from "bun:test";
import { karaokeWindow, layoutBudget, wrappedRows, LOGO_MIN_HEIGHT, LYRICS_PANEL_ROWS, MIN_LYRICS_SCREEN_ROWS, MIN_RESULTS_HEIGHT } from "../src/ui/layout";

const NONE = { awaitingConfirm: false, nowPlaying: false, toast: false, slashOpen: false, lyricsPanel: false };

describe("layoutBudget", () => {
  test("17-row terminal, plain list: list gets all rows minus input+status+padding", () => {
    const b = layoutBudget(17, NONE);
    // 17 - padding(1) - input(3) - status(1) = 12 → title row + ≥8 track rows.
    expect(b.resultsMaxHeight).toBe(12);
    expect(b.paddingTop).toBe(1);
    expect(b.logoFits).toBe(true);
    expect(b.slashMaxVisible).toBe(2);
  });

  test("24-row terminal, plain list", () => {
    const b = layoutBudget(24, NONE);
    expect(b.resultsMaxHeight).toBe(19); // 24 - 1 - 3 - 1
    expect(b.slashMaxVisible).toBe(3);
  });

  test("40-row terminal, plain list", () => {
    const b = layoutBudget(40, NONE);
    expect(b.resultsMaxHeight).toBe(35); // 40 - 1 - 3 - 1
    expect(b.slashMaxVisible).toBe(3);
  });

  test("12-row terminal: logo still fits, list floors above minimum", () => {
    const b = layoutBudget(12, NONE);
    expect(b.logoFits).toBe(true);
    expect(b.paddingTop).toBe(1);
    expect(b.resultsMaxHeight).toBe(7); // 12 - 1 - 3 - 1
  });

  test("below 12 rows: logo and padding drop, floor holds", () => {
    const b = layoutBudget(11, NONE);
    expect(b.logoFits).toBe(false);
    expect(b.paddingTop).toBe(0);
    expect(b.resultsMaxHeight).toBe(7); // 11 - 0 - 3 - 1
    expect(layoutBudget(8, NONE).resultsMaxHeight).toBe(MIN_RESULTS_HEIGHT);
    expect(layoutBudget(1, NONE).resultsMaxHeight).toBe(MIN_RESULTS_HEIGHT);
  });

  test("ConfirmActions reserves its 10 rows", () => {
    const b = layoutBudget(24, { ...NONE, awaitingConfirm: true });
    expect(b.resultsMaxHeight).toBe(9); // 24 - 1 - 3 - 1 - 10
  });

  test("now-playing and toast rows each reserve one row", () => {
    expect(layoutBudget(24, { ...NONE, nowPlaying: true }).resultsMaxHeight).toBe(18);
    expect(layoutBudget(24, { ...NONE, nowPlaying: true, toast: true }).resultsMaxHeight).toBe(17);
  });

  test("open slash menu reserves visible rows plus chrome", () => {
    // height 24 → slashMaxVisible 3, chrome 3 → 19 - 6 = 13.
    expect(layoutBudget(24, { ...NONE, slashOpen: true }).resultsMaxHeight).toBe(13);
    // height 17 → slashMaxVisible 2 → 12 - 5 = 7.
    expect(layoutBudget(17, { ...NONE, slashOpen: true }).resultsMaxHeight).toBe(7);
  });

  test("slash menu tiers degrade 3 → 2 → 1", () => {
    expect(layoutBudget(20, NONE).slashMaxVisible).toBe(3);
    expect(layoutBudget(19, NONE).slashMaxVisible).toBe(2);
    expect(layoutBudget(15, NONE).slashMaxVisible).toBe(2);
    expect(layoutBudget(14, NONE).slashMaxVisible).toBe(1);
  });

  test("everything at once on a small terminal still respects the floor", () => {
    const b = layoutBudget(17, { awaitingConfirm: true, nowPlaying: true, toast: true, slashOpen: true, lyricsPanel: false });
    expect(b.resultsMaxHeight).toBe(MIN_RESULTS_HEIGHT);
  });

  test("lyrics panel consumes 3 rows when flagged and height permits", () => {
    const without = layoutBudget(24, { ...NONE, nowPlaying: true });
    const withLyrics = layoutBudget(24, { ...NONE, nowPlaying: true, lyricsPanel: true });
    expect(withLyrics.resultsMaxHeight).toBe(without.resultsMaxHeight - LYRICS_PANEL_ROWS);
  });

  test("lyrics panel hides first on short terminals (before logo)", () => {
    // At height 14: consumed = padding(1) + input(3) + status(1) + nowPlaying(1) = 6.
    // baseResults = 14 - 6 = 8. With lyrics: 8 - 3 = 5 ≥ 5 → fits, floor.
    const fits = layoutBudget(14, { ...NONE, nowPlaying: true, lyricsPanel: true });
    expect(fits.resultsMaxHeight).toBe(5);
    expect(fits.logoFits).toBe(true);

    // At height 12: consumed = 6. baseResults = 12 - 6 = 6. With lyrics: 6 - 3 = 3 < 5 → hide.
    const hidden = layoutBudget(12, { ...NONE, nowPlaying: true, lyricsPanel: true });
    expect(hidden.resultsMaxHeight).toBe(6);
    expect(hidden.logoFits).toBe(true); // logo still fits even though lyrics is hidden
  });

  test("lyrics panel hidden cannot force results below floor", () => {
    // At height 11: logo doesn't fit (padding = 0). consumed = 0 + 3 + 1 + 1 = 5.
    // baseResults = 11 - 5 = 6. With lyrics: 6 - 3 = 3 < 5 → hide lyrics.
    const b = layoutBudget(11, { ...NONE, nowPlaying: true, lyricsPanel: true });
    expect(b.resultsMaxHeight).toBe(6);
    expect(b.logoFits).toBe(false);
  });

  test("lyrics panel row constant matches contract", () => {
    expect(LYRICS_PANEL_ROWS).toBe(3);
  });

  test("logo threshold constant matches the documented contract", () => {
    expect(LOGO_MIN_HEIGHT).toBe(12);
  });

  test("lyricsScreenRows: height minus padding, status, footer and chrome", () => {
    // 30 - padding(1) - status(1) - nowPlaying(1) - chrome(3) = 24.
    expect(layoutBudget(30, { ...NONE, nowPlaying: true }).lyricsScreenRows).toBe(24);
    // 15 - 1 - 1 - 1 - 3 = 9.
    expect(layoutBudget(15, { ...NONE, nowPlaying: true }).lyricsScreenRows).toBe(9);
    // No footer when nothing is playing: 15 - 1 - 1 - 3 = 10.
    expect(layoutBudget(15, NONE).lyricsScreenRows).toBe(10);
    // 10 rows: padding drops → 10 - 0 - 1 - 1 - 3 = 5.
    expect(layoutBudget(10, { ...NONE, nowPlaying: true }).lyricsScreenRows).toBe(5);
    // Tiny terminal floors at the minimum.
    expect(layoutBudget(5, { ...NONE, nowPlaying: true }).lyricsScreenRows).toBe(MIN_LYRICS_SCREEN_ROWS);
  });
});

describe("karaokeWindow", () => {
  test("mid-song: current line pinned to the middle of the window", () => {
    // 50 lines, window 9, current 20 → start = 20 - 4 = 16, current at row 4.
    expect(karaokeWindow(50, 20, 9)).toEqual({ start: 16, end: 25 });
    // Even window 8: floor((8-1)/2) = 3 → current sits just above center.
    expect(karaokeWindow(50, 20, 8)).toEqual({ start: 17, end: 25 });
  });

  test("advance shifts the window by exactly one line", () => {
    const a = karaokeWindow(50, 20, 9);
    const b = karaokeWindow(50, 21, 9);
    expect(b.start).toBe(a.start + 1);
    expect(b.end).toBe(a.end + 1);
  });

  test("start of sheet clamps at 0", () => {
    expect(karaokeWindow(50, 0, 9)).toEqual({ start: 0, end: 9 });
    expect(karaokeWindow(50, 3, 9)).toEqual({ start: 0, end: 9 });
    // First line past the half-window starts scrolling.
    expect(karaokeWindow(50, 5, 9)).toEqual({ start: 1, end: 10 });
  });

  test("end of sheet clamps at total", () => {
    expect(karaokeWindow(50, 49, 9)).toEqual({ start: 41, end: 50 });
    expect(karaokeWindow(50, 46, 9)).toEqual({ start: 41, end: 50 });
  });

  test("whole sheet fits: no scrolling at all", () => {
    expect(karaokeWindow(5, 3, 9)).toEqual({ start: 0, end: 5 });
    expect(karaokeWindow(9, 0, 9)).toEqual({ start: 0, end: 9 });
  });

  test("no current line yet anchors at the top", () => {
    expect(karaokeWindow(50, -1, 9)).toEqual({ start: 0, end: 9 });
  });
});

describe("wrappedRows", () => {
  test("short text is one row", () => {
    expect(wrappedRows("Tycho — Awake", 60)).toBe(1);
    expect(wrappedRows("", 60)).toBe(1);
  });

  test("greedy word wrap counts continuation rows", () => {
    // 20-col line: "aaaa bbbb cccc dddd" (19) fits; adding "eeee" wraps.
    expect(wrappedRows("aaaa bbbb cccc dddd", 20)).toBe(1);
    expect(wrappedRows("aaaa bbbb cccc dddd eeee", 20)).toBe(2);
  });

  test("word longer than the line hard-breaks", () => {
    expect(wrappedRows("a".repeat(45), 20)).toBe(3);
  });

  test("degenerate width never divides by zero", () => {
    expect(wrappedRows("anything", 0)).toBe(1);
  });
});

describe("StatusBar modelMax", () => {
  test("60-col terminal (56-col column), excluded + volume: label shrinks but stays readable", async () => {
    const { modelMax } = await import("../src/ui/StatusBar");
    // spec scenario: long provider:model, tracks excluded, volume shown.
    const max = modelMax(56, "spotify", 24, 80, false);
    // prefix 16 + excluded 17 + volume 16 = 49 → 7 → floor 8.
    expect(max).toBeGreaterThanOrEqual(8);
    expect(max).toBeLessThan(24);
  });

  test("wide column keeps the 24-char ceiling", async () => {
    const { modelMax } = await import("../src/ui/StatusBar");
    expect(modelMax(72, "spotify", 0, null, false)).toBe(24);
    expect(modelMax(undefined, "spotify", 5, 50, false)).toBe(24);
  });
});
