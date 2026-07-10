import { describe, expect, test } from "bun:test";
import { runAgentLoop } from "../src/agent/loop";
import { joinMessagesAsText } from "../src/agent/providers/messages";
import type { AgentEvent, AgentMessage, AgentProvider, AgentResult, GenerateOptions, ToolCall } from "../src/agent/types";
import type { MusicProvider, Track } from "../src/music/types";

/**
 * Adapts a generate-only mock into a full AgentProvider: generateMessages
 * flattens the history to a single user string, so legacy assertions on the
 * `user` prompt keep working against the native-transport loop.
 */
function fromGenerate(p: { name: string; generate: AgentProvider["generate"] }): AgentProvider {
  return {
    ...p,
    generateMessages: (system, messages, onToken, signal, opts) =>
      p.generate(system, joinMessagesAsText(messages), onToken, signal, opts),
  };
}

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
  const provider = fromGenerate({
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
  });
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
    const provider = fromGenerate({
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
    });
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
    const provider = fromGenerate({
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
    });
    await runAgentLoop(provider, "sys", "user", { deps: { music: fakeMusic() }, maxIterations: 3 });
    expect(userPrompts[1]).toContain("Now continue");
    expect(userPrompts[2]).toContain("FINAL STEP");
  });

  test("malformed finalize_playlist args bounce back to the model when budget remains", async () => {
    const userPrompts: string[] = [];
    let call = 0;
    const provider = fromGenerate({
      name: "capture",
      generate: async (_system, user) => {
        userPrompts.push(user);
        call++;
        if (call === 1) {
          return { text: "", toolCalls: [{ id: "c1", name: "finalize_playlist", args: { name: "X", tracks: [], artists: [] } }] };
        }
        return {
          text: "",
          toolCalls: [{ id: "c2", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] } }],
        };
      },
    });
    const r = await runAgentLoop(provider, "sys", "user", { deps: { music: fakeMusic() }, maxIterations: 4 });
    expect(r.playlist.name).toBe("X");
    expect(r.playlist.tracks).toEqual([{ artist: "A", title: "B" }]);
    expect(userPrompts[1]).toContain("finalize_playlist rejected");
    expect(userPrompts[1]).toContain("missing 'name' or non-empty 'tracks'");
  });

  test("malformed finalize_playlist args throw once budget is exhausted", async () => {
    const { provider } = scriptedProvider([
      { text: "", toolCalls: [{ id: "c1", name: "finalize_playlist", args: { name: "X", tracks: [], artists: [] } }] },
    ]);
    await expect(
      runAgentLoop(provider, "sys", "user", { deps: { music: fakeMusic() }, maxIterations: 1 }),
    ).rejects.toThrow(/missing 'name' or non-empty 'tracks'/);
  });
});

describe("runAgentLoop duplicate-call detection", () => {
  test("identical repeated call is not re-dispatched; cached result + warning fed back", async () => {
    let searchCalls = 0;
    const music = fakeMusic({
      searchTrack: async (artist, title) => {
        searchCalls++;
        return fakeTrack("spotify:track:x", artist, title);
      },
    });
    const userPrompts: string[] = [];
    let call = 0;
    const provider = fromGenerate({
      name: "repeater",
      generate: async (_system, user) => {
        userPrompts.push(user);
        if (call++ < 2) {
          // Same tool, same args (key order shuffled on the repeat).
          return {
            text: "",
            toolCalls: [{ id: `c${call}`, name: "searchTrack", args: call === 1 ? { artist: "A", title: "B" } : { title: "B", artist: "A" } }],
          };
        }
        return {
          text: "",
          toolCalls: [{ id: "cf", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] } }],
        };
      },
    });
    const r = await runAgentLoop(provider, "sys", "user", { deps: { music } });
    expect(r.playlist.name).toBe("X");
    expect(searchCalls).toBe(1);
    expect(r.toolTrace).toEqual(["searchTrack", "searchTrack (duplicate)", "finalize_playlist"]);
    // The second follow-up turn carries the duplicate warning + cached result.
    expect(userPrompts[2]).toContain("[duplicate call");
    expect(userPrompts[2]).toContain("spotify:track:x");
  });

  test("same tool with different args dispatches normally", async () => {
    let searchCalls = 0;
    const music = fakeMusic({
      searchTrack: async (artist, title) => {
        searchCalls++;
        return fakeTrack(`spotify:track:${title}`, artist, title);
      },
    });
    const { provider } = scriptedProvider([
      { text: "", toolCalls: [{ id: "c1", name: "searchTrack", args: { artist: "A", title: "B" } }] },
      { text: "", toolCalls: [{ id: "c2", name: "searchTrack", args: { artist: "A", title: "C" } }] },
      { text: "", toolCalls: [{ id: "c3", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] } }] },
    ]);
    const r = await runAgentLoop(provider, "sys", "user", { deps: { music } });
    expect(searchCalls).toBe(2);
    expect(r.toolTrace).toEqual(["searchTrack", "searchTrack", "finalize_playlist"]);
  });

  test("repeated clarify with identical args still reaches the UI hook", async () => {
    let clarifyHookCalls = 0;
    const { provider } = scriptedProvider([
      { text: "", toolCalls: [{ id: "c1", name: "clarify", args: { question: "Era?", options: ["80s", "90s"] } }] },
      { text: "", toolCalls: [{ id: "c2", name: "clarify", args: { question: "Era?", options: ["80s", "90s"] } }] },
      { text: "", toolCalls: [{ id: "c3", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] } }] },
    ]);
    await runAgentLoop(provider, "sys", "user", {
      deps: {
        music: fakeMusic(),
        onClarify: async () => {
          clarifyHookCalls++;
          return "80s";
        },
      },
    });
    expect(clarifyHookCalls).toBe(2);
  });

  test("errored call is not cached; identical retry re-dispatches", async () => {
    let attempts = 0;
    const music = fakeMusic({
      searchArtist: async () => {
        attempts++;
        if (attempts === 1) throw new Error("network down");
        return { id: "aid", name: "A" };
      },
    });
    const { provider } = scriptedProvider([
      { text: "", toolCalls: [{ id: "c1", name: "searchArtist", args: { name: "A" } }] },
      { text: "", toolCalls: [{ id: "c2", name: "searchArtist", args: { name: "A" } }] },
      { text: "", toolCalls: [{ id: "c3", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] } }] },
    ]);
    await runAgentLoop(provider, "sys", "user", { deps: { music } });
    expect(attempts).toBe(2);
  });
});

describe("runAgentLoop dynamic budget", () => {
  const finalize: AgentResult = {
    text: "",
    toolCalls: [{ id: "cf", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] } }],
  };

  /** Provider that searches unique tracks (n per turn) until told to finalize,
   * capturing every user prompt. */
  function searchingProvider(perTurn: number): { provider: AgentProvider; prompts: string[] } {
    const prompts: string[] = [];
    let turn = 0;
    const provider = fromGenerate({
      name: "searcher",
      generate: async (_system, user) => {
        prompts.push(user);
        if (user.includes("FINAL STEP") || user.includes("enough verified tracks") || user.includes("out of research budget")) return finalize;
        const t = turn++;
        return {
          text: "",
          toolCalls: Array.from({ length: perTurn }, (_, j) => ({
            id: `c${t}-${j}`,
            name: "searchTrack",
            args: { artist: `A${t}-${j}`, title: `T${t}-${j}` },
          })),
        };
      },
    });
    return { provider, prompts };
  }

  const verifyingMusic = () =>
    fakeMusic({ searchTrack: async (artist, title) => fakeTrack(`s:${artist}:${title}`, artist, title) });

  test("sufficiency: requested count reached → soft finalize demand early", async () => {
    const { provider, prompts } = searchingProvider(5);
    const r = await runAgentLoop(provider, "sys", "playlist of 5 tracks", { deps: { music: verifyingMusic() } });
    expect(r.playlist.name).toBe("X");
    // Turn 0 verifies 5 tracks → the very next continuation demands finalize.
    expect(prompts[1]).toContain("enough verified tracks");
    expect(prompts[1]).not.toContain("Do not call any other tool");
    expect(r.iterations).toBeLessThanOrEqual(2);
  });

  test("default target is 10: 9 verified → continue, 10 → demand", async () => {
    const nine = searchingProvider(9);
    await runAgentLoop(nine.provider, "sys", "sad songs", { deps: { music: verifyingMusic() } });
    expect(nine.prompts[1]).toContain("Now continue");

    const ten = searchingProvider(10);
    await runAgentLoop(ten.provider, "sys", "sad songs", { deps: { music: verifyingMusic() } });
    expect(ten.prompts[1]).toContain("enough verified tracks");
  });

  test("stall: two progressless turns → soft finalize demand despite budget left", async () => {
    const prompts: string[] = [];
    let turn = 0;
    // Every turn repeats the same call; searchTrack returns null so nothing is
    // ever verified — turn 0 and 1 are progressless, prompt 2 must demand.
    const provider = fromGenerate({
      name: "staller",
      generate: async (_system, user) => {
        prompts.push(user);
        if (user.includes("FINAL STEP") || user.includes("enough verified tracks") || user.includes("out of research budget")) return finalize;
        turn++;
        return { text: "", toolCalls: [{ id: `c${turn}`, name: "searchTrack", args: { artist: "A", title: "B" } }] };
      },
    });
    const music = fakeMusic({ searchTrack: async () => null });
    const r = await runAgentLoop(provider, "sys", "user", { deps: { music }, maxIterations: 8 });
    expect(r.playlist.name).toBe("X");
    expect(prompts[1]).toContain("Now continue"); // 1 stalled turn: not yet
    expect(prompts[2]).toContain("enough verified tracks"); // 2 stalled turns: demand
    expect(r.iterations).toBeLessThanOrEqual(3);
  });

  test("clarify-only turn extends the budget by one", async () => {
    // maxIterations=2. Without extension: clarify turn + 1 research turn, the
    // research turn being also the last → rescue. With extension the provider
    // gets clarify + research + finalize turns normally.
    let turn = 0;
    const provider = fromGenerate({
      name: "clarifier",
      generate: async (_system, user) => {
        const t = turn++;
        if (t === 0) {
          return { text: "", toolCalls: [{ id: "cq", name: "clarify", args: { question: "Era?", options: ["80s"] } }] };
        }
        if (t === 1 && !user.includes("out of research budget")) {
          return { text: "", toolCalls: [{ id: "cs", name: "searchTrack", args: { artist: "A", title: "B" } }] };
        }
        return finalize;
      },
    });
    const r = await runAgentLoop(provider, "sys", "user", {
      deps: { music: verifyingMusic(), onClarify: async (_q, o) => o[0]! },
      maxIterations: 2,
    });
    expect(r.playlist.name).toBe("X");
    // 3 loop iterations (clarify, search, finalize) — no rescue path needed.
    expect(r.iterations).toBe(3);
    expect(r.toolTrace).toEqual(["clarify", "searchTrack", "finalize_playlist"]);
  });
});

describe("runAgentLoop finalize verification bounce", () => {
  const bigFinalize = (id: string): AgentResult => ({
    text: "",
    toolCalls: [
      {
        id,
        name: "finalize_playlist",
        args: {
          name: "X",
          tracks: Array.from({ length: 10 }, (_, j) => ({ artist: `A${j}`, title: `T${j}` })),
          artists: [],
        },
      },
    ],
  });

  test("mostly-unverified finalize is bounced once, second finalize accepted", async () => {
    const prompts: string[] = [];
    let call = 0;
    const provider = fromGenerate({
      name: "hallucinator",
      generate: async (_system, user) => {
        prompts.push(user);
        call++;
        return bigFinalize(`cf${call}`);
      },
    });
    const r = await runAgentLoop(provider, "sys", "user", { deps: { music: fakeMusic() } });
    expect(r.playlist.tracks.length).toBe(10);
    expect(call).toBe(2); // bounced once, then accepted
    expect(prompts[1]).toContain("finalize rejected");
    expect(prompts[1]).toContain("A0 – T0");
    expect(prompts[1]).toContain("Verify the rejected tracks NOW");
  });

  test("no bounce when most tracks are verified", async () => {
    const music = fakeMusic({
      searchTrack: async (artist, title) => fakeTrack(`s:${title}`, artist, title),
    });
    let call = 0;
    const provider = fromGenerate({
      name: "verifier",
      generate: async () => {
        if (call++ === 0) {
          // Verify 8 of the 10 tracks first.
          return {
            text: "",
            toolCalls: Array.from({ length: 8 }, (_, j) => ({
              id: `c${j}`,
              name: "searchTrack",
              args: { artist: `A${j}`, title: `T${j}` },
            })),
          };
        }
        return bigFinalize("cf");
      },
    });
    const r = await runAgentLoop(provider, "sys", "user", { deps: { music } });
    expect(r.playlist.tracks.length).toBe(10);
    expect(call).toBe(2); // no bounce round-trip
  });

  test("no bounce for small track lists", async () => {
    let call = 0;
    const provider = fromGenerate({
      name: "tiny",
      generate: async () => {
        call++;
        return {
          text: "",
          toolCalls: [{ id: "cf", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] } }],
        };
      },
    });
    await runAgentLoop(provider, "sys", "user", { deps: { music: fakeMusic() } });
    expect(call).toBe(1);
  });
});

describe("runAgentLoop anti-restate continuation", () => {
  test("normal continuation tells the model not to restate its analysis", async () => {
    const prompts: string[] = [];
    let call = 0;
    const provider = fromGenerate({
      name: "capture",
      generate: async (_system, user) => {
        prompts.push(user);
        if (call++ === 0) {
          return { text: "", toolCalls: [{ id: "c1", name: "searchTrack", args: { artist: "A", title: "B" } }] };
        }
        return {
          text: "",
          toolCalls: [{ id: "cf", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] } }],
        };
      },
    });
    await runAgentLoop(provider, "sys", "user", { deps: { music: fakeMusic() } });
    expect(prompts[1]).toContain("Do not restate your analysis");
  });
});

describe("runAgentLoop retry + backoff", () => {
  const finalizeResult: AgentResult = {
    text: "",
    toolCalls: [{ id: "cf", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] } }],
  };

  test("transient 429 error retries and the run completes", async () => {
    let attempts = 0;
    const provider = fromGenerate({
      name: "flaky",
      generate: async () => {
        if (attempts++ === 0) throw new Error("provider request failed: 429 Too Many Requests");
        return finalizeResult;
      },
    });
    const r = await runAgentLoop(provider, "sys", "user", { deps: { music: fakeMusic() } });
    expect(r.playlist.name).toBe("X");
    expect(attempts).toBe(2);
  });

  test("non-transient error throws immediately without retry", async () => {
    let attempts = 0;
    const provider = fromGenerate({
      name: "broken",
      generate: async () => {
        attempts++;
        throw new Error("invalid api key");
      },
    });
    await expect(
      runAgentLoop(provider, "sys", "user", { deps: { music: fakeMusic() } }),
    ).rejects.toThrow("invalid api key");
    expect(attempts).toBe(1);
  });

  test("transient error gives up after retries are exhausted", async () => {
    let attempts = 0;
    const provider = fromGenerate({
      name: "dead",
      generate: async () => {
        attempts++;
        throw new Error("fetch failed");
      },
    });
    await expect(
      runAgentLoop(provider, "sys", "user", { deps: { music: fakeMusic() } }),
    ).rejects.toThrow("fetch failed");
    expect(attempts).toBe(3); // initial + 2 retries
  }, 10_000);

  test("429 with retryAfterMs from a Retry-After header uses that delay, not the default schedule", async () => {
    let attempts = 0;
    const provider = fromGenerate({
      name: "flaky",
      generate: async () => {
        if (attempts++ === 0) {
          const err = new Error("rate limited") as Error & { status?: number; retryAfterMs?: number };
          err.status = 429;
          err.retryAfterMs = 10;
          throw err;
        }
        return finalizeResult;
      },
    });
    const start = Date.now();
    const r = await runAgentLoop(provider, "sys", "user", { deps: { music: fakeMusic() } });
    expect(r.playlist.name).toBe("X");
    expect(attempts).toBe(2);
    expect(Date.now() - start).toBeLessThan(400);
  });

  test("400 'prompt is too long' is never retried even though attempts remain", async () => {
    let attempts = 0;
    const provider = fromGenerate({
      name: "overflow",
      generate: async () => {
        attempts++;
        const err = new Error("upstream 400: prompt is too long for this model") as Error & { status?: number };
        err.status = 400;
        throw err;
      },
    });
    await expect(
      runAgentLoop(provider, "sys", "user", { deps: { music: fakeMusic() } }),
    ).rejects.toThrow(/prompt is too long/);
    expect(attempts).toBe(1);
  });

  test("a transient 500 whose message happens to mention 'context' is still retried (status wins over message-sniffing)", async () => {
    let attempts = 0;
    const provider = fromGenerate({
      name: "flaky-gateway",
      generate: async () => {
        if (attempts++ === 0) {
          const err = new Error("upstream error: context deadline exceeded") as Error & { status?: number };
          err.status = 500;
          throw err;
        }
        return finalizeResult;
      },
    });
    const r = await runAgentLoop(provider, "sys", "user", { deps: { music: fakeMusic() } });
    expect(r.playlist.name).toBe("X");
    expect(attempts).toBe(2);
  });
});

describe("runAgentLoop reasoning-effort policy", () => {
  test("research turns leave reasoningEffort unset; hard-demand and rescue turns use 'low'", async () => {
    const optsSeen: (GenerateOptions | undefined)[] = [];
    const provider = fromGenerate({
      name: "capture",
      generate: async (_system, _user, _onToken, _signal, opts) => {
        optsSeen.push(opts);
        return { text: "", toolCalls: [{ id: `c${optsSeen.length}`, name: "searchTrack", args: { artist: "A", title: "B" } }] };
      },
    });
    await runAgentLoop(provider, "sys", "user", { deps: { music: fakeMusic() }, maxIterations: 2 });
    expect(optsSeen.length).toBe(3); // turn 0 (research), turn 1 (hard-demand), rescue call
    expect(optsSeen[0]?.reasoningEffort).toBeUndefined();
    expect(optsSeen[1]?.reasoningEffort).toBe("low");
    expect(optsSeen[2]?.reasoningEffort).toBe("low");
    expect(optsSeen[2]?.maxTokens).toBe(2048);
  });

  test("forced first-turn clarify turn uses reasoningEffort 'low'", async () => {
    const optsSeen: (GenerateOptions | undefined)[] = [];
    let call = 0;
    const provider = fromGenerate({
      name: "capture",
      generate: async (_system, _user, _onToken, _signal, opts) => {
        optsSeen.push(opts);
        call++;
        if (call === 1) {
          return { text: "", toolCalls: [{ id: "c1", name: "clarify", args: { question: "Q?", options: ["a", "b", "c"] } }] };
        }
        return { text: "", toolCalls: [{ id: "c2", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] } }] };
      },
    });
    const r = await runAgentLoop(provider, "sys", "user", {
      deps: { music: fakeMusic(), onClarify: async () => "a" },
      firstTurnToolChoice: "clarify",
    });
    expect(optsSeen[0]?.reasoningEffort).toBe("low");
    expect(optsSeen[0]?.toolChoice).toEqual({ name: "clarify" });
    expect(r.playlist.name).toBe("X");
  });

  test("a bounced-finalize retry turn uses reasoningEffort 'low'", async () => {
    const optsSeen: (GenerateOptions | undefined)[] = [];
    let call = 0;
    const provider = fromGenerate({
      name: "capture",
      generate: async (_system, _user, _onToken, _signal, opts) => {
        optsSeen.push(opts);
        call++;
        if (call === 1) {
          return { text: "", toolCalls: [{ id: "c1", name: "finalize_playlist", args: { name: "X", tracks: [], artists: [] } }] };
        }
        return { text: "", toolCalls: [{ id: "c2", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] } }] };
      },
    });
    await runAgentLoop(provider, "sys", "user", { deps: { music: fakeMusic() }, maxIterations: 4 });
    expect(optsSeen[0]?.reasoningEffort).toBeUndefined();
    expect(optsSeen[1]?.reasoningEffort).toBe("low");
  });
});

describe("runAgentLoop tool-result truncation", () => {
  test("huge tool result is clipped in the follow-up prompt but full in events", async () => {
    const bigTitle = "x".repeat(5000);
    const music = fakeMusic({
      searchTrack: async (artist) => fakeTrack("spotify:track:big", artist, bigTitle),
    });
    const userPrompts: string[] = [];
    let call = 0;
    const provider = fromGenerate({
      name: "capture",
      generate: async (_system, user) => {
        userPrompts.push(user);
        if (call++ === 0) {
          return { text: "", toolCalls: [{ id: "c1", name: "searchTrack", args: { artist: "A", title: "B" } }] };
        }
        return {
          text: "",
          toolCalls: [{ id: "c2", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] } }],
        };
      },
    });
    const events: AgentEvent[] = [];
    await runAgentLoop(provider, "sys", "user", { deps: { music }, onEvent: (e) => events.push(e) });
    expect(userPrompts[1]).toContain("…[truncated]");
    // Model-visible line is bounded; the UI event still carries the full title.
    const resultEvent = events.find((e) => e.kind === "tool_result");
    expect(resultEvent?.kind).toBe("tool_result");
    if (resultEvent?.kind === "tool_result") {
      expect(JSON.stringify(resultEvent.result)).toContain(bigTitle);
    }
  });
});

describe("runAgentLoop result slimming", () => {
  test("artwork fields are stripped from the prompt but kept in UI events", async () => {
    const music = fakeMusic({
      getArtistTopTracks: async () => [
        { ...fakeTrack("s:1", "A", "T1"), artwork: "https://img.example/very-long-artwork-url-1" },
        { ...fakeTrack("s:2", "A", "T2"), artwork: "https://img.example/very-long-artwork-url-2" },
      ] as Track[],
    });
    const prompts: string[] = [];
    let call = 0;
    const provider = fromGenerate({
      name: "artful",
      generate: async (_system, user) => {
        prompts.push(user);
        if (call++ === 0) {
          return { text: "", toolCalls: [{ id: "c1", name: "getArtistTopTracks", args: { artistId: "aid" } }] };
        }
        return {
          text: "",
          toolCalls: [{ id: "cf", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A", title: "T1" }], artists: [] } }],
        };
      },
    });
    const events: AgentEvent[] = [];
    await runAgentLoop(provider, "sys", "user", { deps: { music }, onEvent: (e) => events.push(e) });
    expect(prompts[1]).toContain("T1");
    expect(prompts[1]).toContain("T2");
    expect(prompts[1]).not.toContain("artwork");
    const resultEvent = events.find((e) => e.kind === "tool_result");
    if (resultEvent?.kind === "tool_result") {
      expect(JSON.stringify(resultEvent.result)).toContain("artwork");
    } else {
      throw new Error("missing tool_result event");
    }
  });
});

describe("runAgentLoop parallel dispatch", () => {
  test("independent calls in one turn run concurrently, results stay in call order", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const music = fakeMusic({
      searchTrack: async (artist, title) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight--;
        return fakeTrack(`spotify:track:${title}`, artist, title);
      },
    });
    const userPrompts: string[] = [];
    let call = 0;
    const provider = fromGenerate({
      name: "batcher",
      generate: async (_system, user) => {
        userPrompts.push(user);
        if (call++ === 0) {
          return {
            text: "",
            toolCalls: [
              { id: "c1", name: "searchTrack", args: { artist: "A", title: "First" } },
              { id: "c2", name: "searchTrack", args: { artist: "B", title: "Second" } },
            ],
          };
        }
        return {
          text: "",
          toolCalls: [{ id: "cf", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A", title: "First" }], artists: [] } }],
        };
      },
    });
    const r = await runAgentLoop(provider, "sys", "user", { deps: { music } });
    expect(r.playlist.name).toBe("X");
    expect(maxInFlight).toBe(2);
    // Result lines keep the original call order.
    const followUp = userPrompts[1]!;
    expect(followUp.indexOf("First")).toBeLessThan(followUp.indexOf("Second"));
  });

  test("in-batch duplicate call dispatches once and is marked duplicate", async () => {
    let searches = 0;
    const music = fakeMusic({
      searchTrack: async (artist, title) => {
        searches++;
        return fakeTrack("spotify:track:x", artist, title);
      },
    });
    const { provider } = scriptedProvider([
      {
        text: "",
        toolCalls: [
          { id: "c1", name: "searchTrack", args: { artist: "A", title: "B" } },
          { id: "c2", name: "searchTrack", args: { artist: "A", title: "B" } },
        ],
      },
      { text: "", toolCalls: [{ id: "cf", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] } }] },
    ]);
    const r = await runAgentLoop(provider, "sys", "user", { deps: { music } });
    expect(searches).toBe(1);
    expect(r.toolTrace).toEqual(["searchTrack", "searchTrack (duplicate)", "finalize_playlist"]);
  });
});

describe("runAgentLoop firstTurnToolChoice", () => {
  test("forced tool choice reaches the provider on iteration 0 only", async () => {
    const seenChoices: (string | undefined)[] = [];
    let call = 0;
    const provider = fromGenerate({
      name: "choice-capture",
      generate: async (_system, _user, _onToken, _signal, opts) => {
        seenChoices.push(opts?.toolChoice?.name);
        if (call++ === 0) {
          return { text: "", toolCalls: [{ id: "c1", name: "clarify", args: { question: "Era?", options: ["80s", "90s", "00s"] } }] };
        }
        return {
          text: "",
          toolCalls: [{ id: "c2", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] } }],
        };
      },
    });
    const r = await runAgentLoop(provider, "sys", "user", {
      firstTurnToolChoice: "clarify",
      deps: { music: fakeMusic(), onClarify: async (_q, opts) => opts[0]! },
    });
    expect(r.playlist.name).toBe("X");
    expect(seenChoices).toEqual(["clarify", undefined]);
  });

  test("no firstTurnToolChoice → provider never sees a toolChoice", async () => {
    const seenChoices: (string | undefined)[] = [];
    const provider = fromGenerate({
      name: "choice-capture",
      generate: async (_system, _user, _onToken, _signal, opts) => {
        seenChoices.push(opts?.toolChoice?.name);
        return {
          text: "",
          toolCalls: [{ id: "c1", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] } }],
        };
      },
    });
    await runAgentLoop(provider, "sys", "user", { deps: { music: fakeMusic() } });
    expect(seenChoices).toEqual([undefined]);
  });
});

describe("runAgentLoop onEvent transcript", () => {
  test("emits reasoning, tool_call, then tool_result in call order", async () => {
    // First generate streams reasoning + a searchTrack call; second finalizes.
    let call = 0;
    const provider = fromGenerate({
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
    });

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
    const provider = fromGenerate({
      name: "boom",
      generate: async (_system, _user, _onToken, signal) => {
        signal?.throwIfAborted();
        // searchArtist throws → loop catches and emits an error result.
        return { text: "", toolCalls: [{ id: "c1", name: "searchArtist", args: { name: "A" } }] };
      },
    });
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

describe("runAgentLoop native multi-turn transport", () => {
  /** Provider capturing the exact (system, messages) of every generateMessages call. */
  function nativeProvider(
    script: (call: number) => AgentResult,
  ): { provider: AgentProvider; seenSystems: string[]; seenPerCall: AgentMessage[][] } {
    const seenSystems: string[] = [];
    const seenPerCall: AgentMessage[][] = [];
    let call = 0;
    const provider: AgentProvider = {
      name: "native",
      generate: async () => {
        throw new Error("the loop must use generateMessages, never generate()");
      },
      generateMessages: async (system, messages) => {
        seenSystems.push(system);
        seenPerCall.push(messages.map((m) => ({ ...m })));
        return script(call++);
      },
    };
    return { provider, seenSystems, seenPerCall };
  }

  test("3-iteration run: history carries role:'tool' messages, system stays constant, no concatenated user blob", async () => {
    const { provider, seenSystems, seenPerCall } = nativeProvider((call) => {
      if (call < 2) {
        return { text: "", toolCalls: [{ id: `c${call}`, name: "searchTrack", args: { artist: `A${call}`, title: `T${call}` } }] };
      }
      return { text: "", toolCalls: [{ id: "cf", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A0", title: "T0" }], artists: [] } }] };
    });
    const music = fakeMusic({
      searchTrack: async (artist, title) => fakeTrack(`s:${title}`, artist, title),
    });
    const r = await runAgentLoop(provider, "sys", "find some tracks", { deps: { music } });
    expect(r.playlist.name).toBe("X");
    expect(seenPerCall.length).toBe(3);
    // System prompt is the same object every turn — no history leaks into it.
    expect(seenSystems).toEqual(["sys", "sys", "sys"]);
    // The original request is never rewritten or grown.
    for (const msgs of seenPerCall) {
      expect(msgs[0]).toEqual({ role: "user", content: "find some tracks" });
    }
    // Third call sees the full structured history: two assistant turns, each
    // followed by its call_id-linked tool result, plus continuations.
    const roles = seenPerCall[2]!.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "tool", "user", "assistant", "tool", "user"]);
    const firstTool = seenPerCall[2]![2]!;
    expect(firstTool).toMatchObject({ role: "tool", callId: "c0", name: "searchTrack" });
    if (firstTool.role === "tool") expect(firstTool.content).toContain("T0");
    // Append-only prefix invariant across turns.
    expect(seenPerCall[2]!.slice(0, seenPerCall[1]!.length)).toEqual(seenPerCall[1]!);
    expect(seenPerCall[1]!.slice(0, seenPerCall[0]!.length)).toEqual(seenPerCall[0]!);
  });

  test("failed dispatch is fed back as an isError tool message", async () => {
    const { provider, seenPerCall } = nativeProvider((call) => {
      if (call === 0) return { text: "", toolCalls: [{ id: "c1", name: "searchArtist", args: { name: "A" } }] };
      return { text: "", toolCalls: [{ id: "cf", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] } }] };
    });
    const music = fakeMusic({
      searchArtist: async () => {
        throw new Error("network down");
      },
    });
    await runAgentLoop(provider, "sys", "user", { deps: { music } });
    const toolMsg = seenPerCall[1]!.find((m) => m.role === "tool");
    expect(toolMsg).toMatchObject({ role: "tool", callId: "c1", isError: true });
    if (toolMsg?.role === "tool") expect(toolMsg.content).toContain("network down");
  });

  test("compression: old iterations fold into a digest, last two stay verbatim", async () => {
    const bigTitle = "y".repeat(1900); // each tool message ~2KB after clipping
    const music = fakeMusic({
      searchTrack: async (artist, title) => fakeTrack("spotify:track:big", artist, title),
    });
    const { provider, seenPerCall } = nativeProvider((call) => {
      if (call < 14) {
        // 3 fat searches per turn (~6KB) → 60K threshold crossed around turn 10.
        return {
          text: "",
          toolCalls: [0, 1, 2].map((j) => ({
            id: `c${call}-${j}`,
            name: "searchTrack",
            args: { artist: `A${call}-${j}`, title: `${bigTitle}${call}${j}` },
          })),
        };
      }
      return { text: "", toolCalls: [{ id: "cf", name: "finalize_playlist", args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] } }] };
    });
    const r = await runAgentLoop(provider, "sys", "user", { deps: { music }, maxIterations: 16 });
    expect(r.playlist.name).toBe("X");
    // First history the provider saw after a compaction ran.
    const compacted = seenPerCall.find((msgs) => msgs[1]?.content.includes("elided"));
    expect(compacted).toBeDefined();
    // Digest replaced the old span: original request survives, then summary.
    expect(compacted![0]).toEqual({ role: "user", content: "user" });
    expect(compacted![1]!.content).toContain("earlier tool results elided");
    expect(compacted![1]!.content).toContain("Do not repeat these calls");
    // The last two full iterations are kept verbatim as structured turns.
    expect(compacted!.filter((m) => m.role === "assistant").length).toBe(2);
    expect(compacted!.filter((m) => m.role === "tool").length).toBe(6); // 2 iterations × 3 calls
    // Every history the provider ever saw stays bounded — raw accumulation
    // over 14 fat turns would reach ~90KB.
    for (const msgs of seenPerCall) {
      expect(msgs.reduce((n, m) => n + m.content.length, 0)).toBeLessThan(70_000);
    }
  });
});