import type { Config } from "../config";
import type { ResolvedPlaylist } from "../core/generate-playlist";
import type { RemotePlaylist, Track } from "../music/types";
import { generateRandomPlaylistUser } from "../agent/prompts";
import type { Overlay } from "./overlay";

/**
 * Slash-command dispatch table — the single source of command names,
 * descriptions (SlashMenu renders from here), and handlers. Handlers receive
 * an explicit context of state accessors + actions, so they are unit-testable
 * without rendering the TUI.
 */
export interface CommandCtx {
  config: Config | null;
  providerReady: boolean;
  loading: boolean;
  isSpotifyBackend: boolean;
  authedRef: { current: boolean };
  resolved: ResolvedPlaylist | null;
  committedPlaylist: RemotePlaylist | null;
  currentlyPlayingUri: string | null;
  selectedIndex: number;
  lyricsMode: boolean;
  lyricsFullScreen: boolean;
  priorPlaylistRef: { current: string[] | null };

  setError(msg: string | undefined): void;
  show(msg: string): void;
  setOverlay(o: Overlay | null): void;
  /** /model: refresh the ollama model list, then open the picker. */
  openModelPicker(): Promise<void>;
  runLoginAndResume(resume: string | null): Promise<void>;
  savePlaylist(): Promise<void>;
  cancelInFlight(): void;
  resetSession(): void;
  resetNowPlaying(): void;
  stopPlayer(): Promise<void>;
  setLyricsMode(v: boolean): void;
  setLyricsFullScreen(v: boolean): void;
  clearLyricsCache(): void;
  likeTrack(track: Pick<Track, "artist" | "title">, comment: string): Promise<void>;
  buildMemoryText(): Promise<string | null>;
  openHistory(): Promise<void>;
  setPendingPrompt(v: string | null): void;
  setHasInteracted(v: boolean): void;
  runResolve(prompt: string, qa: never[]): Promise<ResolvedPlaylist | null>;
  quit(): void;
}

export type CommandHandler = (ctx: CommandCtx, arg: string) => Promise<void> | void;

interface CommandDef {
  cmd: string;
  description: string;
  /** Commands that take trailing text (e.g. `/like nice groove`). Anything
   * else with an argument is treated as unknown, matching the old exact-match
   * if-chain ("/model x" errored, it did not open the picker). */
  acceptsArg?: boolean;
  handler: CommandHandler;
}

export const COMMAND_DEFS: CommandDef[] = [
  {
    cmd: "/model",
    description: "switch AI provider / model",
    handler: (ctx) => ctx.openModelPicker(),
  },
  {
    cmd: "/music",
    description: "switch music provider (Spotify / SoundCloud / YouTube Music)",
    handler: (ctx) => ctx.setOverlay({ kind: "backend-picker" }),
  },
  {
    cmd: "/random",
    description: "let the model pick a genre and generate",
    handler: async (ctx) => {
      if (!ctx.config || !ctx.providerReady || ctx.loading) {
        ctx.setError("not ready — still loading or no provider");
        return;
      }
      if (ctx.isSpotifyBackend && !ctx.authedRef.current) {
        ctx.setPendingPrompt("__random__");
        ctx.setOverlay({ kind: "connect-confirm" });
        return;
      }
      ctx.setHasInteracted(true);
      const r = await ctx.runResolve(generateRandomPlaylistUser(), []);
      if (r) ctx.show(`random playlist ready · ${r.resolved.length} tracks`);
    },
  },
  {
    cmd: "/save",
    description: "save current track list as a playlist",
    handler: async (ctx) => {
      if (!ctx.resolved) {
        ctx.setError("nothing to save — generate a track list first");
        return;
      }
      if (ctx.committedPlaylist) {
        ctx.setError("already saved as a playlist");
        return;
      }
      await ctx.savePlaylist();
    },
  },
  {
    cmd: "/clear",
    description: "clear session (results + context + playback)",
    handler: async (ctx) => {
      // Abort any in-flight generation (mirror the double-Esc path) so a
      // clear mid-generation actually stops the loop instead of racing it.
      if (ctx.loading) ctx.cancelInFlight();
      // Stop local playback so a still-running mpv/Spotify doesn't outlive
      // the cleared session (mirror applyBackendChoice).
      await ctx.stopPlayer();
      ctx.resetSession();
      ctx.setError(undefined);
      ctx.resetNowPlaying();
      ctx.setLyricsMode(false);
      ctx.setLyricsFullScreen(false);
      ctx.clearLyricsCache();
      // Wipe the prior-playlist seed so the next request starts fresh.
      ctx.priorPlaylistRef.current = null;
      ctx.show("session cleared");
    },
  },
  {
    cmd: "/login",
    description: "reconnect Spotify account",
    handler: (ctx) => ctx.runLoginAndResume(null),
  },
  {
    cmd: "/clientid",
    description: "set your own Spotify app client ID",
    handler: (ctx) => ctx.setOverlay({ kind: "client-id", text: "" }),
  },
  {
    cmd: "/effort",
    description: "set Claude reasoning effort",
    handler: (ctx) => {
      if (ctx.config?.defaultProvider === "ollama") {
        ctx.setError("effort only applies to the Claude provider");
        return;
      }
      ctx.setOverlay({ kind: "effort-picker" });
    },
  },
  {
    cmd: "/systemprompt",
    description: "set custom system prompt for Claude",
    handler: (ctx) =>
      ctx.setOverlay({ kind: "system-prompt", text: ctx.config?.customSystemPrompt ?? "" }),
  },
  {
    cmd: "/like",
    description: "remember current track (optional comment)",
    acceptsArg: true,
    handler: async (ctx, comment) => {
      const track =
        ctx.resolved?.resolved.find((t) => t.uri === ctx.currentlyPlayingUri) ??
        ctx.resolved?.resolved[ctx.selectedIndex];
      if (!track) {
        ctx.setError("nothing to like — no current track");
        return;
      }
      await ctx.likeTrack(track, comment);
    },
  },
  {
    cmd: "/memory",
    description: "show saved taste memory",
    handler: async (ctx) => {
      const text = await ctx.buildMemoryText();
      ctx.setOverlay({
        kind: "memory",
        text: text ?? "taste memory is empty — /like tracks or generate playlists",
      });
    },
  },
  {
    cmd: "/lyrics",
    description: "toggle realtime lyrics view",
    handler: (ctx) => {
      // Cycle: off → compact → fullscreen → off
      if (ctx.lyricsFullScreen) {
        ctx.setLyricsFullScreen(false);
        ctx.setLyricsMode(false);
      } else if (ctx.lyricsMode) {
        ctx.setLyricsFullScreen(true);
      } else {
        ctx.setLyricsMode(true);
      }
    },
  },
  {
    cmd: "/history",
    description: "browse past sessions & model reasoning",
    handler: (ctx) => ctx.openHistory(),
  },
  {
    cmd: "/forget",
    description: "clear taste memory",
    handler: (ctx) => ctx.setOverlay({ kind: "forget-confirm" }),
  },
  {
    cmd: "/quit",
    description: "exit music-agent",
    handler: (ctx) => ctx.quit(),
  },
];

const COMMAND_MAP = new Map(COMMAND_DEFS.map((d) => [d.cmd, d]));

/** Names + descriptions for the SlashMenu dropdown (same order as the table). */
export const SLASH_COMMANDS = COMMAND_DEFS.map(({ cmd, description }) => ({
  cmd,
  description,
}));

/**
 * Route a submitted line. Returns false for non-command input (caller falls
 * through to generation). Unknown or malformed `/commands` surface an error
 * and never reach the agent.
 */
export async function dispatchCommand(trimmed: string, ctx: CommandCtx): Promise<boolean> {
  if (!trimmed.startsWith("/")) return false;
  const name = trimmed.split(/\s+/)[0]!;
  const def = COMMAND_MAP.get(name);
  const arg = trimmed.slice(name.length).trim();
  if (!def || (arg.length > 0 && !def.acceptsArg)) {
    ctx.setError(`unknown command: ${name}`);
    return true;
  }
  await def.handler(ctx, arg);
  return true;
}
