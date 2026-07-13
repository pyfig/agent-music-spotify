import { describe, expect, test } from "bun:test";
import { lyricsPanelStateFor } from "../src/app/render";
import type { LyricsResult } from "../src/lyrics/client";

const SYNCED: LyricsResult = { synced: [{ timeMs: 0, text: "line" }], plain: "line" };
const PLAIN_ONLY: LyricsResult = { plain: "just text" };

describe("lyricsPanelStateFor", () => {
  test("no playback → waiting, regardless of stale lyrics data", () => {
    expect(lyricsPanelStateFor(null, null)).toBe("waiting");
    expect(lyricsPanelStateFor(null, SYNCED)).toBe("waiting");
  });

  test("playing with unresolved lookup → loading", () => {
    expect(lyricsPanelStateFor("spotify:track:1", null)).toBe("loading");
  });

  test("definitive miss → none", () => {
    expect(lyricsPanelStateFor("spotify:track:1", "none")).toBe("none");
  });

  test("fetch failure → error, distinct from none", () => {
    expect(lyricsPanelStateFor("spotify:track:1", "error")).toBe("error");
  });

  test("synced lyrics → synced", () => {
    expect(lyricsPanelStateFor("spotify:track:1", SYNCED)).toBe("synced");
  });

  test("plain-only lyrics → none (compact panel can't scroll them)", () => {
    expect(lyricsPanelStateFor("spotify:track:1", PLAIN_ONLY)).toBe("none");
  });
});
