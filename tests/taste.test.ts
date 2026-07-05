import { describe, expect, test } from "bun:test";
import {
  addLine,
  appendSession,
  emptyTaste,
  formatTaste,
  MAX_RAW_SESSIONS,
  needsRotation,
  parseTaste,
  rotate,
  tastePromptPrefix,
  type Taste,
} from "../src/core/taste";

const SAMPLE = `## Preferences (curated)
- likes: synthwave, dark electro
- avoid: country

## Recent sessions (raw, max 10)
### Session 2026-07-05T14:00
- Carpenter Brut – Turbo Killer
- Perturbator – Future Club (liked: "banger")

### Session 2026-07-06T09:30
- Molchat Doma – Sudno
`;

describe("taste parse/format", () => {
  test("roundtrip preserves preferences and sessions", () => {
    const taste = parseTaste(SAMPLE);
    expect(taste.preferences).toEqual([
      "- likes: synthwave, dark electro",
      "- avoid: country",
    ]);
    expect(taste.sessions.length).toBe(2);
    expect(taste.sessions[0]!.header).toBe("2026-07-05T14:00");
    expect(taste.sessions[0]!.lines.length).toBe(2);
    const reparsed = parseTaste(formatTaste(taste));
    expect(reparsed).toEqual(taste);
  });

  test("empty input parses to empty taste", () => {
    expect(parseTaste("")).toEqual(emptyTaste());
  });
});

describe("taste sessions", () => {
  test("addLine appends to existing session or creates one", () => {
    let taste = emptyTaste();
    taste = addLine(taste, "2026-07-06T10:00", "- A – B");
    taste = addLine(taste, "2026-07-06T10:00", '- C – D (liked: "nice")');
    expect(taste.sessions.length).toBe(1);
    expect(taste.sessions[0]!.lines.length).toBe(2);
  });

  test("11th session triggers rotation which folds oldest into preferences", async () => {
    let taste: Taste = { preferences: ["- likes: jazz"], sessions: [] };
    for (let i = 0; i < MAX_RAW_SESSIONS + 1; i++) {
      taste = appendSession(taste, { header: `2026-07-0${(i % 9) + 1}T0${i}:00`, lines: [`- Artist${i} – Song${i}`] });
    }
    expect(needsRotation(taste)).toBe(true);
    let summarized = "";
    const rotated = await rotate(taste, async (raw) => {
      summarized = raw;
      return "- likes: Artist0 style\n- avoid: nothing";
    });
    expect(summarized).toContain("Artist0");
    expect(rotated.sessions.length).toBe(MAX_RAW_SESSIONS);
    expect(rotated.sessions[0]!.lines[0]).toContain("Artist1");
    expect(rotated.preferences).toEqual([
      "- likes: jazz",
      "- likes: Artist0 style",
      "- avoid: nothing",
    ]);
  });

  test("rotate is a no-op under the limit", async () => {
    const taste = parseTaste(SAMPLE);
    const rotated = await rotate(taste, async () => {
      throw new Error("should not be called");
    });
    expect(rotated).toEqual(taste);
  });
});

describe("taste prompt prefix", () => {
  test("empty taste yields empty prefix", () => {
    expect(tastePromptPrefix(emptyTaste())).toBe("");
  });

  test("small file goes in whole", () => {
    const prefix = tastePromptPrefix(parseTaste(SAMPLE));
    expect(prefix).toContain("synthwave");
    expect(prefix).toContain("Molchat Doma");
  });

  test("oversized file falls back to preferences + last 3 sessions", () => {
    let taste: Taste = { preferences: ["- likes: jazz"], sessions: [] };
    for (let i = 0; i < 10; i++) {
      taste = appendSession(taste, {
        header: `2026-07-06T0${i}:00`,
        lines: Array.from({ length: 20 }, (_, j) => `- Artist${i} – ${"Long Song Title ".repeat(5)}${j}`),
      });
    }
    const prefix = tastePromptPrefix(taste);
    expect(prefix).toContain("- likes: jazz");
    expect(prefix).not.toContain("Artist6 –"); // 4th from the end, dropped
    expect(prefix).toContain("Artist9 –");
    expect(prefix).toContain("Artist7 –");
  });
});
