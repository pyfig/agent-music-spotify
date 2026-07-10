import { describe, expect, test } from "bun:test";
import { barParts, displayArtist } from "../src/ui/theme";

describe("displayArtist", () => {
  test("ALL CAPS → Title Case, cyrillic and latin", () => {
    expect(displayArtist("МЭЙБИ БЭЙБИ")).toBe("Мэйби Бэйби");
    expect(displayArtist("ФРЕНДЗОНА")).toBe("Френдзона");
    expect(displayArtist("IC3PEAK")).toBe("Ic3peak");
  });

  test("mixed case untouched", () => {
    expect(displayArtist("Мэйби Бэйби")).toBe("Мэйби Бэйби");
    expect(displayArtist("Komsomolsk")).toBe("Komsomolsk");
    expect(displayArtist("ssshhhiiittt!")).toBe("ssshhhiiittt!");
  });

  test("no letters untouched", () => {
    expect(displayArtist("!!!")).toBe("!!!");
    expect(displayArtist("")).toBe("");
  });
});

describe("barParts", () => {
  test("same glyph for filled and rest — one continuous bar", () => {
    const { filled, rest } = barParts(0.5, 10);
    expect(filled).toBe("━".repeat(5));
    expect(rest).toBe("━".repeat(5));
  });

  test("clamps ratio", () => {
    expect(barParts(-1, 4).filled).toBe("");
    expect(barParts(2, 4).rest).toBe("");
  });
});
