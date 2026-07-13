import { describe, expect, test } from "bun:test";
import { truncatedRowParts } from "../src/ui/ResultsList";

describe("truncatedRowParts", () => {
  test("short labels pass through untouched", () => {
    const parts = truncatedRowParts({ label: "", artist: "Tycho", title: "Awake", resolved: true }, 60);
    expect(parts.artistText).toBe("Tycho — ");
    expect(parts.titleText).toBe("Awake");
  });

  test("overlong title truncates to one line with an ellipsis", () => {
    const title = "An Extremely Long Track Title That Would Wrap Onto A Second Row And Read As Lyrics";
    const parts = truncatedRowParts({ label: "", artist: "Artist", title, resolved: true }, 40);
    const total = parts.artistText.length + parts.titleText.length;
    expect(total).toBeLessThanOrEqual(40);
    expect(parts.titleText.endsWith("…")).toBe(true);
  });

  test("overlong artist is capped so the title keeps a visible tail", () => {
    const artist = "An Orchestra With An Unreasonably Long Name Featuring Someone";
    const parts = truncatedRowParts({ label: "", artist, title: "Song", resolved: true }, 40);
    expect(parts.artistText.endsWith("…")).toBe(true);
    expect(parts.titleText).toBe("Song");
    expect(parts.artistText.length + parts.titleText.length).toBeLessThanOrEqual(40);
  });

  test("unresolved rows reserve room for the not-found suffix", () => {
    const title = "Another Very Long Track Title That Must Not Push The Suffix Off The Row";
    const parts = truncatedRowParts({ label: "", artist: "Artist", title, resolved: false }, 40);
    expect(parts.artistText.length + parts.titleText.length + "  not found".length).toBeLessThanOrEqual(40);
  });

  test("label-only rows truncate at 60 and 80 columns", () => {
    const label = "x".repeat(200);
    for (const w of [60, 80]) {
      const parts = truncatedRowParts({ label, resolved: true }, w);
      expect(parts.titleText.length).toBeLessThanOrEqual(w);
      expect(parts.titleText.endsWith("…")).toBe(true);
    }
  });
});
