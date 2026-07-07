import { describe, expect, test } from "bun:test";
import { runAgentLoop } from "../src/agent/loop";
import type { AgentEvent, AgentProvider, AgentResult, ToolCall } from "../src/agent/types";
import type { MusicProvider, Track } from "../src/music/types";

function fakeTrack(uri: string, artist: string, title: string): Track {
  return { uri, artist, title };
}

function fakeMusic(overrides: Partial<MusicProvider> = {}): MusicProvider {
  const base: MusicProvider = {
    name: "spotify",
    capabilities: { remotePlaylists: false, remotePlayback: true, localPlayback: false },
    searchTrack: async () => fakeTrack("spotify:track:fake", "Artist", "Title"),
    searchArtist: async () => ({ id: "aid", name: "Artist" }),
    getArtistTopTracks: async () => [fakeTrack("spotify:track:top1", "Artist", "TopA")],
  };
  return { ...base, ...overrides } as MusicProvider;
}

/** Builds a scripted provider that walks a queue of canned responses. */
function scriptedProvider(
  responses: (AgentResult | ((call: ToolCall) => AgentResult))[],
): { provider: AgentProvider; calls: ToolCall[] } {
  let i = 0;
  const calls: ToolCall[] = [];
  const provider: AgentProvider = {
    name: "scripted",
    generate: async (
      _system: string,
      _user: string,
      _onToken?: (delta: string) => void,
      signal?: AbortSignal,
    ) => {
      signal?.throwIfAborted();
      const next = responses[i++] ?? (responses[responses.length - 1] as AgentResult);
      const result = typeof next === "function" ? (next as (c: ToolCall) => AgentResult)(calls[calls.length - 1]!) : next;
      // Track tool-call history to make scripted dispatch tests assertable.
      if (result.toolCalls) calls.push(...result.toolCalls);
      return result;
    },
  };
  return { provider, calls };
}

describe("runAgentLoop termination", () => {
  test("finalize_playlist tool is captured and loop stops", async () => {
    const { provider } = scriptedProvider([
      {
        text: "",
        toolCalls: [
          {
            id: "c1",
            name: "finalize_playlist",
            args: {
              name: "Vibe Test",
              tracks: [{ artist: "A", title: "B" }],
              artists: ["A"],
            },
          },
        ],
      },
    ]);
    const r = await runAgentLoop(provider, "sys", "user", { deps: { music: fakeMusic() } });
    expect(r.playlist.name).toBe("Vibe Test");
    expect(r.playlist.tracks).toEqual([{ artist: "A", title: "B" }]);
    expect(r.playlist.artists).toEqual(["A"]);
    expect(r.iterations).toBe(1);
    expect(r.toolTrace).toEqual(["finalize_playlist"]);
  });

  test("JSON text answer with no tool calls is parsed as fallback", async () => {
    const { provider } = scriptedProvider([
      {
        text: JSON.stringify({
          name: "X",
          tracks: [{ artist: "A", title: "B" }],
          artists: [],
        }),
      },
    ]);
    const r = await runAgentLoop(provider, "sys", "user", { deps: { music: fakeMusic() } });
    expect(r.playlist.name).toBe("X");
    expect(r.iterations).toBe(1);
    expect(r.toolTrace).toEqual([]);
  });

  test("tool dispatch happens for non-finalize tools before continuing", async () => {
    let searchCalls = 0;
    const music = fakeMusic({
      searchTrack: async (artist, title) => {
        searchCalls++;
        return fakeTrack("spotify:track:x", artist, title);
      },
    });
    const { provider, calls } = scriptedProvider([
      {
        text: "",
        toolCalls: [{ id: "c1", name: "searchTrack", args: { artist: "A", title: "B" } }],
      },
      {
        text: "",
        toolCalls: [
          {
            id: "c2",
            name: "finalize_playlist",
            args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] },
          },
        ],
      },
    ]);
    const r = await runAgentLoop(provider, "sys", "user", { deps: { music } });
    expect(r.playlist.name).toBe("X");
    expect(searchCalls).toBe(1);
    expect(calls.map((c) => c.name)).toEqual(["searchTrack", "finalize_playlist"]);
  });

  test("clarify tool blocks awaiting the UI hook", async () => {
    let clarifyHookCalls = 0;
    const { provider } = scriptedProvider([
      { text: "", toolCalls: [{ id: "c1", name: "clarify", args: { question: "Which era?", options: ["80s", "90s", "2000s"] } }] },
      {
        text: "",
        toolCalls: [
          {
            id: "c2",
            name: "finalize_playlist",
            args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] },
          },
        ],
      },
    ]);
    const r = await runAgentLoop(provider, "sys", "user", {
      deps: {
        music: fakeMusic(),
        onClarify: async (q, opts) => {
          clarifyHookCalls++;
          expect(q).toBe("Which era?");
          expect(opts).toEqual(["80s", "90s", "2000s"]);
          return "80s";
        },
      },
    });
    expect(clarifyHookCalls).toBe(1);
    expect(r.clarifyAnswers).toEqual([{ question: "Which era?", answer: "80s" }]);
  });

  test("web_search dispatches via deps.webSearch then loop continues to finalize", async () => {
    const queries: string[] = [];
    const { provider, calls } = scriptedProvider([
      { text: "", toolCalls: [{ id: "c1", name: "web_search", args: { query: "obscure artist 2026 album tracklist" } }] },
      {
        text: "",
        toolCalls: [
          {
            id: "c2",
            name: "finalize_playlist",
            args: { name: "Fresh", tracks: [{ artist: "A", title: "B" }], artists: [] },
          },
        ],
      },
    ]);
    const r = await runAgentLoop(provider, "sys", "user", {
      deps: {
        music: fakeMusic(),
        webSearch: async (q) => {
          queries.push(q);
          return [{ title: "T", url: "https://example.com", snippet: "S" }];
        },
      },
    });
    expect(r.playlist.name).toBe("Fresh");
    expect(queries).toEqual(["obscure artist 2026 album tracklist"]);
    expect(calls.map((c) => c.name)).toEqual(["web_search", "finalize_playlist"]);
  });

  test("maxIterations exceeded throws only when nothing is salvageable", async () => {
    // Every response is a non-terminal tool call; searchTrack finds nothing so
    // there are no verified tracks to salvage and no text to parse.
    const { provider, calls } = scriptedProvider([
      { text: "", toolCalls: [{ id: `c0`, name: "searchTrack", args: { artist: "A", title: "B" } }] },
      { text: "", toolCalls: [{ id: `c1`, name: "searchTrack", args: { artist: "A", title: "B" } }] },
      { text: "", toolCalls: [{ id: `c2`, name: "searchTrack", args: { artist: "A", title: "B" } }] },
      { text: "", toolCalls: [{ id: `c3`, name: "searchTrack", args: { artist: "A", title: "B" } }] },
      { text: "", toolCalls: [{ id: `c4`, name: "searchTrack", args: { artist: "A", title: "B" } }] },
    ]);
    const music = fakeMusic({ searchTrack: async () => null });
    await expect(
      runAgentLoop(provider, "sys", "user", { deps: { music }, maxIterations: 4 }),
    ).rejects.toThrow(/maxIterations/);
    // 4 loop iterations + 1 finalize-only rescue call.
    expect(calls.length).toBe(5);
  });

  test("budget exhausted: finalize-only rescue call recovers the playlist", async () => {
    const seenTools: string[][] = [];
    let call = 0;
    const provider: AgentProvider = {
      name: "rescued",
      generate: async (_system, _user, _onToken, _signal, opts2) => {
        seenTools.push((opts2?.tools ?? []).map((t) => t.name));
        if (call++ < 2) {
          return { text: "", toolCalls: [{ id: `c${call}`, name: "searchTrack", args: { artist: "A", title: "B" } }] };
        }
        return {
          text: "",
          toolCalls: [{ id: "cf", name: "finalize_playlist", args: { name: "Rescued", tracks: [{ artist: "A", title: "B" }], artists: [] } }],
        };
      },
    };
    const r = await runAgentLoop(provider, "sys", "user", { deps: { music: fakeMusic() }, maxIterations: 2 });
    expect(r.playlist.name).toBe("Rescued");
    // Rescue call offers only finalize_playlist.
    expect(seenTools[2]).toEqual(["finalize_playlist"]);
  });

  test("budget exhausted with failed rescue: salvages verified tracks", async () => {
    const { provider } = scriptedProvider([
      { text: "", toolCalls: [{ id: `c0`, name: "searchTrack", args: { artist: "A", title: "B" } }] },
      { text: "", toolCalls: [{ id: `c1`, name: "searchTrack", args: { artist: "C", title: "D" } }] },
      { text: "", toolCalls: [{ id: `c2`, name: "searchTrack", args: { artist: "A", title: "B" } }] },
    ]);
    const music = fakeMusic({
      searchTrack: async (artist, title) => fakeTrack(`spotify:track:${title}`, artist, title),
    });
    const r = await runAgentLoop(provider, "sys", "user", { deps: { music }, maxIterations: 2 });
    expect(r.playlist.name).toBe("Playlist");
    expect(r.playlist.tracks).toEqual([
      { artist: "A", title: "B" },
      { artist: "C", title: "D" },
    ]);
  });

  test("penultimate iteration demands finalize_playlist in the follow-up turn", async () => {
    const userPrompts: string[] = [];
    let call = 0;
    const provider: AgentProvider = {
      name: "capture",
      generate: async (_system, user) => {
        userPrompts.push(user);
        if (call++ < 2) {
          return { text: "", toolCalls: [{ id: `c${call}`, name: "searchTrack", args: { artist: "A", title: "B" } }] };
        }
        return {
          text: "",
          toolCalls: [{ id: "cf", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] } }],
        };
      },
    };
    await runAgentLoop(provider, "sys", "user", { deps: { music: fakeMusic() }, maxIterations: 3 });
    expect(userPrompts[1]).toContain("Now continue");
    expect(userPrompts[2]).toContain("FINAL STEP");
  });

  test("finalize_playlist args malformed (missing tracks) errors before loop returns", async () => {
    const { provider } = scriptedProvider([
      { text: "", toolCalls: [{ id: "c1", name: "finalize_playlist", args: { name: "X", tracks: [], artists: [] } }] },
    ]);
    await expect(
      runAgentLoop(provider, "sys", "user", { deps: { music: fakeMusic() } }),
    ).rejects.toThrow(/missing 'name' or non-empty 'tracks'/);
  });
});

describe("runAgentLoop onEvent transcript", () => {
  test("emits reasoning, tool_call, then tool_result in call order", async () => {
    // First generate streams reasoning + a searchTrack call; second finalizes.
    let call = 0;
    const provider: AgentProvider = {
      name: "reasoner",
      generate: async (_system, _user, _onToken, signal, opts) => {
        signal?.throwIfAborted();
        if (call++ === 0) {
          opts?.onReasoning?.("pick ");
          opts?.onReasoning?.("a set");
          return { text: "", toolCalls: [{ id: "c1", name: "searchTrack", args: { artist: "A", title: "B" } }] };
        }
        return {
          text: "",
          toolCalls: [{ id: "c2", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] } }],
        };
      },
    };

    const events: AgentEvent[] = [];
    const r = await runAgentLoop(provider, "sys", "user", {
      deps: { music: fakeMusic() },
      onEvent: (e) => events.push(e),
    });

    expect(r.playlist.name).toBe("X");
    expect(events.map((e) => e.kind)).toEqual([
      "reasoning",
      "reasoning",
      "tool_call",
      "tool_result",
      "tool_call",
      "tool_result",
    ]);

    const searchResult = events[3]!;
    expect(searchResult.kind).toBe("tool_result");
    if (searchResult.kind === "tool_result") {
      expect(searchResult.id).toBe("c1");
      expect(searchResult.name).toBe("searchTrack");
      expect(searchResult.ok).toBe(true);
    }

    const finalizeCall = events[4]!;
    expect(finalizeCall.kind).toBe("tool_call");
    if (finalizeCall.kind === "tool_call") expect(finalizeCall.name).toBe("finalize_playlist");
  });

  test("failed tool dispatch surfaces an ok:false tool_result", async () => {
    const provider: AgentProvider = {
      name: "boom",
      generate: async (_system, _user, _onToken, signal) => {
        signal?.throwIfAborted();
        // searchArtist throws → loop catches and emits an error result.
        return { text: "", toolCalls: [{ id: "c1", name: "searchArtist", args: { name: "A" } }] };
      },
    };
    const music = fakeMusic({
      searchArtist: async () => {
        throw new Error("network down");
      },
    });
    const events: AgentEvent[] = [];
    await expect(
      runAgentLoop(provider, "sys", "user", { deps: { music }, maxIterations: 1, onEvent: (e) => events.push(e) }),
    ).rejects.toThrow();
    const result = events.find((e) => e.kind === "tool_result");
    expect(result?.kind).toBe("tool_result");
    if (result?.kind === "tool_result") {
      expect(result.ok).toBe(false);
      expect(result.result).toEqual({ error: "network down" });
    }
  });
});