import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendHistory,
  HISTORY_LIMIT,
  historyEntryToText,
  historyReasoningToText,
  historyPath,
  loadHistory,
  updateHistoryTitle,
  type HistoryEntry,
} from "../src/core/history";

function tempConfig() {
  return { configDir: mkdtempSync(join(tmpdir(), "music-agent-history-")) };
}

function entry(header: string, title = "t"): HistoryEntry {
  return {
    header,
    prompt: "sad songs",
    title,
    playlistName: "Sad",
    tracks: [{ artist: "A", title: "B" }],
    events: [{ kind: "reasoning", delta: "picking" }],
  };
}

describe("history persistence", () => {
  test("append + load round-trips entries in order", async () => {
    const config = tempConfig();
    await appendHistory(config, entry("2026-07-08T10:00:00.000Z", "first"));
    await appendHistory(config, entry("2026-07-08T11:00:00.000Z", "second"));
    const loaded = await loadHistory(config);
    expect(loaded.map((e) => e.title)).toEqual(["first", "second"]);
    expect(loaded[0]!.tracks).toEqual([{ artist: "A", title: "B" }]);
    expect(loaded[0]!.events).toEqual([{ kind: "reasoning", delta: "picking" }]);
  });

  test("missing file → empty array", async () => {
    expect(await loadHistory(tempConfig())).toEqual([]);
  });

  test("corrupt file → empty array", async () => {
    const config = tempConfig();
    await Bun.write(historyPath(config), "{not json");
    expect(await loadHistory(config)).toEqual([]);
    await Bun.write(historyPath(config), JSON.stringify({ nope: 1 }));
    expect(await loadHistory(config)).toEqual([]);
  });

  test("malformed entries are filtered out on load", async () => {
    const config = tempConfig();
    await Bun.write(
      historyPath(config),
      JSON.stringify([entry("h1", "good"), { junk: true }, null]),
    );
    const loaded = await loadHistory(config);
    expect(loaded.map((e) => e.title)).toEqual(["good"]);
  });

  test("append trims to newest HISTORY_LIMIT entries", async () => {
    const config = tempConfig();
    const many: HistoryEntry[] = Array.from({ length: HISTORY_LIMIT }, (_, i) =>
      entry(`h${i}`, `t${i}`),
    );
    await Bun.write(historyPath(config), JSON.stringify(many));
    await appendHistory(config, entry("h-new", "newest"));
    const loaded = await loadHistory(config);
    expect(loaded.length).toBe(HISTORY_LIMIT);
    expect(loaded.at(-1)!.title).toBe("newest");
    expect(loaded[0]!.title).toBe("t1");
  });

  test("updateHistoryTitle patches the matching entry only", async () => {
    const config = tempConfig();
    await appendHistory(config, entry("h1", "one"));
    await appendHistory(config, entry("h2", "two"));
    await updateHistoryTitle(config, "h2", "Summarized");
    const loaded = await loadHistory(config);
    expect(loaded.map((e) => e.title)).toEqual(["one", "Summarized"]);
  });

  test("historyEntryToText formats title, prompt, and track lines", () => {
    const e = entry("h1", "Night Drive");
    expect(historyEntryToText(e)).toBe("Night Drive\nRequest: sad songs\n\nA – B");
  });

  test("historyReasoningToText renders reasoning verbatim and tools compact", () => {
    const e: HistoryEntry = {
      ...entry("h1", "Night Drive"),
      events: [
        { kind: "reasoning", delta: "User wants synthwave.\nPicking classics." },
        { kind: "tool_call", id: "c1", name: "searchTrack", args: { artist: "Kavinsky", title: "Nightcall" } },
        { kind: "tool_result", id: "c1", name: "searchTrack", ok: true, result: { uri: "s:x", title: "y".repeat(300) } },
      ],
    };
    const text = historyReasoningToText(e);
    expect(text).toContain("User wants synthwave.\nPicking classics.");
    expect(text).toContain('⏺ searchTrack {"artist":"Kavinsky","title":"Nightcall"}');
    expect(text).toContain("⎿ ✓ ");
    expect(text).toContain("…"); // long tool result clipped
    expect(text.startsWith("Night Drive\nRequest: sad songs")).toBe(true);
  });

  test("updateHistoryTitle no-ops for a missing header", async () => {
    const config = tempConfig();
    await appendHistory(config, entry("h1", "one"));
    await updateHistoryTitle(config, "nope", "X");
    expect((await loadHistory(config)).map((e) => e.title)).toEqual(["one"]);
  });
});
