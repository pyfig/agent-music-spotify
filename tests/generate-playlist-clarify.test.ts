import { describe, expect, test } from "bun:test";
import { resolvePlaylist } from "../src/core/generate-playlist";
import type { AgentProvider, AgentResult, GenerateOptions } from "../src/agent/types";
import type { MusicProvider, Track } from "../src/music/types";

function fakeTrack(uri: string, artist: string, title: string): Track {
  return { uri, artist, title };
}

function stubMusic(): MusicProvider {
  return {
    name: "spotify",
    capabilities: { remotePlaylists: false, remotePlayback: true, localPlayback: false },
    searchTrack: async (artist, title) => fakeTrack(`stub:${artist}:${title}`, artist, title),
    searchArtist: async () => null,
    getArtistTopTracks: async () => [],
  } as MusicProvider;
}

/**
 * Scripted provider: first turn emits a clarify tool call, second turn
 * finalizes. Records the GenerateOptions of every call so tests can assert
 * exactly which turn carried a forced toolChoice.
 */
/** Adapts a generate-only mock into a full AgentProvider for these tests. */
function withMessages(p: { name: string; generate: AgentProvider["generate"] }): AgentProvider {
  return {
    ...p,
    generateMessages: (system, _messages, onToken, signal, opts) =>
      p.generate(system, "", onToken, signal, opts),
  };
}

function clarifyThenFinalizeProvider(): { provider: AgentProvider; seenOpts: (GenerateOptions | undefined)[] } {
  const seenOpts: (GenerateOptions | undefined)[] = [];
  let call = 0;
  const provider = withMessages({
    name: "scripted",
    generate: async (_system, _user, _onToken, _signal, opts): Promise<AgentResult> => {
      seenOpts.push(opts);
      if (call++ === 0) {
        return {
          text: "",
          toolCalls: [
            {
              id: "c1",
              name: "clarify",
              args: { question: "Какое настроение?", options: ["Меланхолия", "Светлая грусть", "Драма"] },
            },
          ],
        };
      }
      return {
        text: "",
        toolCalls: [
          {
            id: "c2",
            name: "finalize_playlist",
            args: { name: "Грустный вечер", tracks: [{ artist: "A", title: "B" }], artists: [] },
          },
        ],
      };
    },
  });
  return { provider, seenOpts };
}

/** Provider that finalizes immediately (no clarify turn scripted). */
function finalizeProvider(): { provider: AgentProvider; seenOpts: (GenerateOptions | undefined)[] } {
  const seenOpts: (GenerateOptions | undefined)[] = [];
  const provider = withMessages({
    name: "scripted",
    generate: async (_system, _user, _onToken, _signal, opts): Promise<AgentResult> => {
      seenOpts.push(opts);
      return {
        text: "",
        toolCalls: [
          {
            id: "c1",
            name: "finalize_playlist",
            args: { name: "X", tracks: [{ artist: "A", title: "B" }], artists: [] },
          },
        ],
      };
    },
  });
  return { provider, seenOpts };
}

describe("resolvePlaylist forceClarify wiring", () => {
  test("vague prompt + clarify hook + empty qa → clarify forced on turn 0 only", async () => {
    const { provider, seenOpts } = clarifyThenFinalizeProvider();
    const clarifyCalls: { question: string; options: string[] }[] = [];
    const r = await resolvePlaylist(provider, stubMusic(), "грустные песни", [], {
      onClarifyTool: async (question, options) => {
        clarifyCalls.push({ question, options });
        return options[0]!;
      },
    });
    expect(seenOpts[0]?.toolChoice).toEqual({ name: "clarify" });
    expect(seenOpts[1]?.toolChoice).toBeUndefined();
    expect(clarifyCalls).toEqual([
      { question: "Какое настроение?", options: ["Меланхолия", "Светлая грусть", "Драма"] },
    ]);
    expect(r.resolved.length).toBeGreaterThan(0);
    expect(r.name).toBe("Грустный вечер");
  });

  test("pinned prompt → no forced clarify", async () => {
    const { provider, seenOpts } = finalizeProvider();
    await resolvePlaylist(provider, stubMusic(), "80s japanese city pop, 25 tracks", [], {
      onClarifyTool: async (_q, options) => options[0]!,
    });
    expect(seenOpts[0]?.toolChoice).toBeUndefined();
  });

  test("clarify answers already collected → no forced clarify", async () => {
    const { provider, seenOpts } = finalizeProvider();
    await resolvePlaylist(provider, stubMusic(), "грустные песни", [
      { question: "Mood?", answer: "melancholy" },
    ], {
      onClarifyTool: async (_q, options) => options[0]!,
    });
    expect(seenOpts[0]?.toolChoice).toBeUndefined();
  });

  test("no clarify hook → no forced clarify even on a vague prompt", async () => {
    const { provider, seenOpts } = finalizeProvider();
    await resolvePlaylist(provider, stubMusic(), "грустные песни", []);
    expect(seenOpts[0]?.toolChoice).toBeUndefined();
  });
});
