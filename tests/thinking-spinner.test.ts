import { describe, expect, test } from "bun:test";
import { SPINNER, THINKING_SPINNER } from "../src/ui/theme";
import { spinnerGlyph } from "../src/ui/StatusBar";

describe("THINKING_SPINNER frames", () => {
  test("every frame is a single cell so the status row never shifts", () => {
    for (const frame of THINKING_SPINNER) {
      expect(frame.length).toBe(1);
    }
  });

  test("frame sets are visually distinct", () => {
    for (const frame of THINKING_SPINNER) {
      expect(SPINNER).not.toContain(frame);
    }
  });
});

describe("spinnerGlyph phase selection", () => {
  test("thinking and clarifying use the musical frames", () => {
    for (const phase of ["thinking", "clarifying"] as const) {
      for (let frame = 0; frame < THINKING_SPINNER.length * 2; frame++) {
        expect(THINKING_SPINNER as readonly string[]).toContain(spinnerGlyph(phase, frame));
      }
    }
  });

  test("resolving/tool/creating keep the braille frames", () => {
    for (const phase of ["resolving", "tool", "creating"] as const) {
      for (let frame = 0; frame < SPINNER.length; frame++) {
        expect(SPINNER as readonly string[]).toContain(spinnerGlyph(phase, frame));
      }
    }
  });
});
