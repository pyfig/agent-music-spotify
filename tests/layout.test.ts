import { describe, expect, test } from "bun:test";
import { layoutBudget, wrappedRows, LOGO_MIN_HEIGHT, MIN_RESULTS_HEIGHT } from "../src/ui/layout";

const NONE = { awaitingConfirm: false, nowPlaying: false, toast: false, slashOpen: false };

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
    const b = layoutBudget(17, { awaitingConfirm: true, nowPlaying: true, toast: true, slashOpen: true });
    expect(b.resultsMaxHeight).toBe(MIN_RESULTS_HEIGHT);
  });

  test("logo threshold constant matches the documented contract", () => {
    expect(LOGO_MIN_HEIGHT).toBe(12);
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
