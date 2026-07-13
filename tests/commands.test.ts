import { test, expect } from "bun:test";
import { COMMAND_DEFS, dispatchCommand, SLASH_COMMANDS, type CommandCtx } from "../src/app/commands";
import type { Overlay } from "../src/app/overlay";

function makeCtx(overrides: Partial<CommandCtx> = {}) {
  const calls: string[] = [];
  const errors: (string | undefined)[] = [];
  const overlays: (Overlay | null)[] = [];
  const ctx: CommandCtx = {
    config: { defaultProvider: "claude-cli", customSystemPrompt: "sys" } as never,
    providerReady: true,
    loading: false,
    isSpotifyBackend: false,
    authedRef: { current: true },
    resolved: null,
    committedPlaylist: null,
    currentlyPlayingUri: null,
    selectedIndex: 0,
    lyricsMode: false,
    lyricsFullScreen: false,
    priorPlaylistRef: { current: ["seed"] },
    setError: (m) => {
      errors.push(m);
    },
    show: (m) => calls.push(`show:${m}`),
    setOverlay: (o) => {
      overlays.push(o);
    },
    openModelPicker: async () => {
      calls.push("openModelPicker");
    },
    runLoginAndResume: async (r) => {
      calls.push(`login:${r}`);
    },
    savePlaylist: async () => {
      calls.push("savePlaylist");
    },
    cancelInFlight: () => calls.push("cancelInFlight"),
    resetSession: () => calls.push("resetSession"),
    resetNowPlaying: () => calls.push("resetNowPlaying"),
    stopPlayer: async () => {
      calls.push("stopPlayer");
    },
    setLyricsMode: (v) => calls.push(`lyricsMode:${v}`),
    setLyricsFullScreen: (v) => calls.push(`lyricsFs:${v}`),
    clearLyricsCache: () => calls.push("clearLyricsCache"),
    likeTrack: async (t, c) => {
      calls.push(`like:${t.artist}-${t.title}:${c}`);
    },
    buildMemoryText: async () => "MEMORY",
    openHistory: async () => {
      calls.push("openHistory");
    },
    setPendingPrompt: (v) => calls.push(`pending:${v}`),
    setHasInteracted: (v) => calls.push(`interacted:${v}`),
    runResolve: async () => {
      calls.push("runResolve");
      return null;
    },
    quit: () => calls.push("quit"),
    ...overrides,
  };
  return { ctx, calls, errors, overlays };
}

test("menu list derives from the dispatch table (same order, 1:1)", () => {
  expect(SLASH_COMMANDS.map((c) => c.cmd)).toEqual(COMMAND_DEFS.map((d) => d.cmd));
  for (const c of SLASH_COMMANDS) expect(c.description.length).toBeGreaterThan(0);
});

test("non-command input falls through (returns false, nothing called)", async () => {
  const { ctx, calls, errors } = makeCtx();
  expect(await dispatchCommand("chill evening beats", ctx)).toBe(false);
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});

test("unknown command errors and never reaches the agent", async () => {
  const { ctx, calls, errors } = makeCtx();
  expect(await dispatchCommand("/nope", ctx)).toBe(true);
  expect(errors).toEqual(["unknown command: /nope"]);
  expect(calls).toEqual([]);
});

test("argument on a no-arg command is unknown (legacy exact-match behavior)", async () => {
  const { ctx, calls, errors } = makeCtx();
  expect(await dispatchCommand("/model gpt", ctx)).toBe(true);
  expect(errors).toEqual(["unknown command: /model"]);
  expect(calls).toEqual([]);
});

test("/model routes to openModelPicker", async () => {
  const { ctx, calls } = makeCtx();
  await dispatchCommand("/model", ctx);
  expect(calls).toEqual(["openModelPicker"]);
});

test("/music opens the backend picker overlay", async () => {
  const { ctx, overlays } = makeCtx();
  await dispatchCommand("/music", ctx);
  expect(overlays).toEqual([{ kind: "backend-picker" }]);
});

test("/like parses the trailing comment and targets the playing track", async () => {
  const resolved = {
    name: "p",
    description: "",
    unresolved: [],
    resolved: [
      { uri: "ytm:a", artist: "A", title: "One" },
      { uri: "ytm:b", artist: "B", title: "Two" },
    ],
  };
  const { ctx, calls } = makeCtx({ resolved: resolved as never, currentlyPlayingUri: "ytm:b" });
  await dispatchCommand("/like great bass", ctx);
  expect(calls).toEqual(["like:B-Two:great bass"]);
});

test("/like without a track errors", async () => {
  const { ctx, errors } = makeCtx();
  await dispatchCommand("/like", ctx);
  expect(errors).toEqual(["nothing to like — no current track"]);
});

test("/save guards: no list, then already committed", async () => {
  const a = makeCtx();
  await dispatchCommand("/save", a.ctx);
  expect(a.errors).toEqual(["nothing to save — generate a track list first"]);

  const b = makeCtx({
    resolved: { resolved: [], unresolved: [], name: "", description: "" } as never,
    committedPlaylist: { id: "1", uri: "u", name: "n" } as never,
  });
  await dispatchCommand("/save", b.ctx);
  expect(b.errors).toEqual(["already saved as a playlist"]);
});

test("/clear mid-generation aborts, stops playback, resets in order", async () => {
  const { ctx, calls } = makeCtx({ loading: true });
  await dispatchCommand("/clear", ctx);
  expect(calls.slice(0, 3)).toEqual(["cancelInFlight", "stopPlayer", "resetSession"]);
  expect(calls).toContain("resetNowPlaying");
  expect(calls).toContain("show:session cleared");
  expect(ctx.priorPlaylistRef.current).toBeNull();
});

test("/lyrics cycles off → compact → fullscreen → off", async () => {
  const off = makeCtx();
  await dispatchCommand("/lyrics", off.ctx);
  expect(off.calls).toEqual(["lyricsMode:true"]);

  const compact = makeCtx({ lyricsMode: true });
  await dispatchCommand("/lyrics", compact.ctx);
  expect(compact.calls).toEqual(["lyricsFs:true"]);

  const fs = makeCtx({ lyricsMode: true, lyricsFullScreen: true });
  await dispatchCommand("/lyrics", fs.ctx);
  expect(fs.calls).toEqual(["lyricsFs:false", "lyricsMode:false"]);
});

test("/effort refuses on ollama, opens picker otherwise", async () => {
  const ollama = makeCtx({ config: { defaultProvider: "ollama" } as never });
  await dispatchCommand("/effort", ollama.ctx);
  expect(ollama.errors).toEqual(["effort only applies to the Claude provider"]);

  const claude = makeCtx();
  await dispatchCommand("/effort", claude.ctx);
  expect(claude.overlays).toEqual([{ kind: "effort-picker" }]);
});

test("/memory shows digest, or the empty hint", async () => {
  const withText = makeCtx();
  await dispatchCommand("/memory", withText.ctx);
  expect(withText.overlays).toEqual([{ kind: "memory", text: "MEMORY" }]);

  const empty = makeCtx({ buildMemoryText: async () => null });
  await dispatchCommand("/memory", empty.ctx);
  expect(empty.overlays[0]).toEqual({
    kind: "memory",
    text: "taste memory is empty — /like tracks or generate playlists",
  });
});

test("/random gates auth on spotify backend", async () => {
  const { ctx, calls, overlays } = makeCtx({
    isSpotifyBackend: true,
    authedRef: { current: false },
  });
  await dispatchCommand("/random", ctx);
  expect(calls).toEqual(["pending:__random__"]);
  expect(overlays).toEqual([{ kind: "connect-confirm" }]);
});

test("/random resolves when ready", async () => {
  const { ctx, calls } = makeCtx();
  await dispatchCommand("/random", ctx);
  expect(calls).toEqual(["interacted:true", "runResolve"]);
});

test("/systemprompt seeds the editor with the current prompt", async () => {
  const { ctx, overlays } = makeCtx();
  await dispatchCommand("/systemprompt", ctx);
  expect(overlays).toEqual([{ kind: "system-prompt", text: "sys" }]);
});
