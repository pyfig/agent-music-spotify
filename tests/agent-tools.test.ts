import { describe, expect, test } from "bun:test";
import {
  dispatchTool,
  MUSIC_AGENT_TOOLS,
  toolsForAnthropic,
  toolsForFamily,
  toolsForGoogle,
  toolsForOpenAIChat,
  toolsForOpenAIResponses,
} from "../src/agent/tools";
import type { MusicProvider, Track } from "../src/music/types";

function fakeMusic(overrides: Partial<MusicProvider> = {}): MusicProvider {
  const base: MusicProvider = {
    name: "spotify",
    capabilities: { remotePlaylists: false, remotePlayback: true, localPlayback: false },
    searchTrack: async () => ({ uri: "spotify:track:t1", title: "Title", artist: "Artist", album: "Album" }),
    searchArtist: async () => ({ id: "aid", name: "Artist" }),
    getArtistTopTracks: async () => [{ uri: "spotify:track:top1", title: "Top", artist: "Artist" }],
  };
  return { ...base, ...overrides } as MusicProvider;
}

describe("tool spec surface", () => {
  test("MUSIC_AGENT_TOOLS has the 6 expected tools", () => {
    const names = MUSIC_AGENT_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual([
      "clarify",
      "finalize_playlist",
      "getArtistTopTracks",
      "searchArtist",
      "searchTrack",
      "web_search",
    ]);
  });

  test("finalize_playlist marks name/tracks/artists as required", () => {
    const finalize = MUSIC_AGENT_TOOLS.find((t) => t.name === "finalize_playlist")!;
    expect(finalize.parameters.required).toEqual(["name", "tracks", "artists"]);
  });
});

describe("toolsForFamily transforms", () => {
  test("openai-compat: produces {type:'function', function:{name,description,parameters}}", () => {
    const out = toolsForOpenAIChat(MUSIC_AGENT_TOOLS);
    expect(out.length).toBe(MUSIC_AGENT_TOOLS.length);
    const first = out[0] as any;
    expect(first.type).toBe("function");
    expect(first.function.name).toBe(MUSIC_AGENT_TOOLS[0]!.name);
    expect(first.function.parameters).toBe(MUSIC_AGENT_TOOLS[0]!.parameters);
  });

  test("openai-responses: produces top-level {type,name,parameters,strict}", () => {
    const out = toolsForOpenAIResponses(MUSIC_AGENT_TOOLS);
    expect((out[0] as any).type).toBe("function");
    expect((out[0] as any).name).toBe(MUSIC_AGENT_TOOLS[0]!.name);
    expect((out[0] as any).strict).toBe(false);
  });

  test("anthropic: produces {name,description,input_schema}", () => {
    const out = toolsForAnthropic(MUSIC_AGENT_TOOLS);
    expect((out[0] as any).name).toBe(MUSIC_AGENT_TOOLS[0]!.name);
    expect((out[0] as any).input_schema).toBe(MUSIC_AGENT_TOOLS[0]!.parameters);
  });

  test("google: wraps in functionDeclarations array of 1 entry", () => {
    const out = toolsForGoogle(MUSIC_AGENT_TOOLS);
    expect(Array.isArray(out)).toBe(true);
    expect((out[0] as any).functionDeclarations.length).toBe(MUSIC_AGENT_TOOLS.length);
    expect((out[0] as any).functionDeclarations[0].name).toBe(MUSIC_AGENT_TOOLS[0]!.name);
  });

  test("toolsForFamily dispatches by family id", () => {
    expect(toolsForFamily("anthropic", MUSIC_AGENT_TOOLS)[0]).toHaveProperty("input_schema");
    expect(toolsForFamily("openai-responses", MUSIC_AGENT_TOOLS)[0]).toHaveProperty("strict");
    expect(toolsForFamily("openai-compat", MUSIC_AGENT_TOOLS)[0]).toHaveProperty("function");
    expect(toolsForFamily("google", MUSIC_AGENT_TOOLS)[0]).toHaveProperty("functionDeclarations");
  });
});

describe("dispatchTool", () => {
  test("searchTrack returns a serializable Track JSON or null", async () => {
    const r = await dispatchTool("searchTrack", { artist: "A", title: "B" }, { music: fakeMusic() });
    expect(r).toEqual({ uri: "spotify:track:t1", title: "Title", artist: "Artist", album: "Album" });
    const r2 = await dispatchTool("searchTrack", { artist: "Nobody", title: "NoTitle" }, {
      music: fakeMusic({ searchTrack: async () => null }),
    });
    expect(r2).toBeNull();
  });

  test("getArtistTopTracks resolves top tracks by id", async () => {
    const r = await dispatchTool("getArtistTopTracks", { artistId: "aid" }, { music: fakeMusic() });
    expect(Array.isArray(r)).toBe(true);
    expect((r as Track[]).length).toBe(1);
  });

  test("getArtistTopTracks honors `limit` arg", async () => {
    let lastLimit: number | undefined;
    const music = fakeMusic({
      getArtistTopTracks: async (_id, limit) => {
        lastLimit = limit;
        return [];
      },
    });
    await dispatchTool("getArtistTopTracks", { artistId: "aid", limit: 12 }, { music });
    expect(lastLimit).toBe(12);
  });

  test("clarify routes through the UI hook and forwards the user answer", async () => {
    const asked: { q: string; opts: string[] }[] = [];
    const r = await dispatchTool(
      "clarify",
      { question: "Which era?", options: ["80s", "90s", "2000s"] },
      {
        music: fakeMusic(),
        onClarify: async (q, opts) => { asked.push({ q, opts }); return "90s"; },
      },
    );
    expect(r).toBe("90s");
    expect(asked).toEqual([{ q: "Which era?", opts: ["80s", "90s", "2000s"] }]);
  });

  test("clarify recovers args wrapped in _raw (streaming providers)", async () => {
    const asked: { q: string; opts: string[] }[] = [];
    const r = await dispatchTool(
      "clarify",
      { _raw: JSON.stringify({ question: "Which era?", options: ["80s", "90s", "2000s"] }) },
      {
        music: fakeMusic(),
        onClarify: async (q, opts) => { asked.push({ q, opts }); return "80s"; },
      },
    );
    expect(r).toBe("80s");
    expect(asked).toEqual([{ q: "Which era?", opts: ["80s", "90s", "2000s"] }]);
  });

  test("clarify coerces options passed as a JSON string", async () => {
    const r = await dispatchTool(
      "clarify",
      { question: "Q?", options: '["a","b","c"]' },
      { music: fakeMusic(), onClarify: async (_q, opts) => opts[0]! },
    );
    expect(r).toBe("a");
  });

  test("clarify throws when no UI hook is wired", async () => {
    await expect(
      dispatchTool("clarify", { question: "Q?", options: ["a", "b", "c"] }, { music: fakeMusic() }),
    ).rejects.toThrow(/no UI hook/);
  });

  test("web_search routes through injected deps.webSearch", async () => {
    const queries: string[] = [];
    const r = await dispatchTool(
      "web_search",
      { query: "artist new album 2026 tracklist", reason: "unknown album" },
      {
        music: fakeMusic(),
        webSearch: async (q) => {
          queries.push(q);
          return [{ title: "T", url: "https://example.com", snippet: "S" }];
        },
      },
    );
    expect(queries).toEqual(["artist new album 2026 tracklist"]);
    expect(r).toEqual([{ title: "T", url: "https://example.com", snippet: "S" }]);
  });

  test("web_search throws on empty query", async () => {
    await expect(
      dispatchTool("web_search", { query: "  " }, { music: fakeMusic(), webSearch: async () => [] }),
    ).rejects.toThrow(/non-empty query/);
  });

  test("unknown tool name throws", async () => {
    await expect(
      dispatchTool("bogus", {}, { music: fakeMusic() }),
    ).rejects.toThrow(/unknown tool/);
  });
});