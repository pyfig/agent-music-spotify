import { describe, expect, test } from "bun:test";
import { parsePlaylistResponse } from "../src/agent/parse";

describe("parsePlaylistResponse", () => {
  test("parses valid JSON", () => {
    const text = JSON.stringify({
      name: "Rainy Sunday",
      tracks: [{ artist: "Bon Iver", title: "Holocene" }],
    });
    expect(parsePlaylistResponse(text)).toEqual({
      name: "Rainy Sunday",
      tracks: [{ artist: "Bon Iver", title: "Holocene" }],
    });
  });

  test("parses JSON wrapped in markdown fences", () => {
    const text =
      "```json\n" +
      JSON.stringify({ name: "X", tracks: [{ artist: "A", title: "B" }] }) +
      "\n```";
    expect(parsePlaylistResponse(text)).toEqual({ name: "X", tracks: [{ artist: "A", title: "B" }] });
  });

  test("throws on garbage input", () => {
    expect(() => parsePlaylistResponse("not json at all")).toThrow();
  });

  test("throws when name missing", () => {
    expect(() => parsePlaylistResponse(JSON.stringify({ tracks: [{ artist: "A", title: "B" }] }))).toThrow();
  });

  test("throws when tracks missing or empty", () => {
    expect(() => parsePlaylistResponse(JSON.stringify({ name: "X" }))).toThrow();
    expect(() => parsePlaylistResponse(JSON.stringify({ name: "X", tracks: [] }))).toThrow();
  });

  test("drops malformed track entries", () => {
    const text = JSON.stringify({
      name: "X",
      tracks: [{ artist: "A", title: "B" }, { artist: 5 }, "junk"],
    });
    expect(parsePlaylistResponse(text).tracks).toEqual([{ artist: "A", title: "B" }]);
  });
});
