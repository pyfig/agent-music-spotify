import { describe, expect, test } from "bun:test";
import { parsePlaylistResponse, parseClarifyResponse } from "../src/agent/parse";

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

describe("parseClarifyResponse", () => {
  test("parses zero questions (no clarification needed)", () => {
    expect(parseClarifyResponse(JSON.stringify({ questions: [] }))).toEqual({ questions: [] });
  });

  test("parses questions with 3 options", () => {
    const text = JSON.stringify({
      questions: [{ text: "Which era?", options: ["80s", "90s", "2000s"] }],
    });
    expect(parseClarifyResponse(text)).toEqual({
      questions: [{ text: "Which era?", options: ["80s", "90s", "2000s"] }],
    });
  });

  test("truncates more than 3 questions", () => {
    const text = JSON.stringify({
      questions: [
        { text: "Q1", options: ["a", "b", "c"] },
        { text: "Q2", options: ["a", "b", "c"] },
        { text: "Q3", options: ["a", "b", "c"] },
        { text: "Q4", options: ["a", "b", "c"] },
      ],
    });
    expect(parseClarifyResponse(text).questions.length).toBe(3);
  });

  test("truncates more than 3 options per question", () => {
    const text = JSON.stringify({
      questions: [{ text: "Q", options: ["a", "b", "c", "d", "e"] }],
    });
    expect(parseClarifyResponse(text).questions[0]?.options).toEqual(["a", "b", "c"]);
  });

  test("drops malformed question entries", () => {
    const text = JSON.stringify({
      questions: [{ text: "Q", options: ["a", "b"] }, { text: 5, options: [] }, "junk"],
    });
    expect(parseClarifyResponse(text).questions).toEqual([{ text: "Q", options: ["a", "b"] }]);
  });

  test("throws when 'questions' field missing", () => {
    expect(() => parseClarifyResponse(JSON.stringify({}))).toThrow();
  });
});
