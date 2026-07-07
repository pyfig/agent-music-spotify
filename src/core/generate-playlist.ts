import {
  CLARIFY_SYSTEM,
  clarifyUser,
  agentSystemPrompt,
  GENERATE_PLAYLIST_SYSTEM,
  generatePlaylistUserWithAnswers,
  type ClarifyAnswer,
} from "../agent/prompts";
import {
  parsePlaylistResponse,
  parseClarifyResponse,
  withRetry,
  type TrackRec,
  type ClarifyRec,
} from "../agent/parse";
import { runAgentLoop, type AgentRunResult } from "../agent/loop";
import type { AgentEvent, AgentProvider } from "../agent/types";
import type { MusicProvider, RemotePlaylist, Track } from "../music/types";

export interface ResolvedPlaylist {
  name: string;
  description: string;
  resolved: Track[];
  unresolved: TrackRec[];
}

export interface Progress {
  phase:
    | "clarifying"
    | "thinking"
    | "tool"
    | "resolving"
    | "creating"
    | "adding"
    | "done";
  current?: number;
  total?: number;
  /** Tool-kind when phase === "tool": the tool name called by the agent. */
  toolName?: string;
}

/** Per-track search budget. See note in resolvePlaylistWorker. */
const SEARCH_TIMEOUT_MS = 15_000;

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} search timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Best-effort clarify pass for providers that lack tool-calling support (legacy
 * claude-cli, very old ollama models). For tool-enabled providers this whole
 * step is skipped — the agent loop drives clarify through the `clarify` tool.
 *
 * Carries an optional `tasteContext` block so clarifying questions can be
 * grounded in the user's accumulaabout prior taste (artist names extracted
 * from `tasteForClaborate`); empty string leaves the original CLARIFY_SYSTEM
 * untouched.
 */
export async function clarify(
  provider: AgentProvider,
  prompt: string,
  signal?: AbortSignal,
  tasteContext?: string,
): Promise<ClarifyRec> {
  const system = tasteContext ? `${CLARIFY_SYSTEM}\n\n${tasteContext}` : CLARIFY_SYSTEM;
  return withRetry(
    async () => {
      const r = await provider.generate(system, clarifyUser(prompt), undefined, signal);
      return r.text;
    },
    parseClarifyResponse,
  );
}

export type ClarifyTool = (question: string, options: string[]) => Promise<string>;

export interface ResolvePlaylistOptions {
  onProgress?: (progress: Progress) => void;
  onToken?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
  /** Ordered reasoning/tool-call transcript for the chat-style thinking view. */
  onEvent?: (e: AgentEvent) => void;
  signal?: AbortSignal;
  /** Optional taste-memory block appended to the system prompt. */
  tasteContext?: string;
  /** When the agent emits a clarify tool call, this hook resolves the answer. */
  onClarifyTool?: ClarifyTool;
}

/**
 * Run the agent-end resolvePlaylist via the agent loop when the active provider
 * contributes tool-call support (API providers: openai, opencode, ollama with a
 * tool-capable model), otherwise falls back to a single-shot generate→parse
 * path that the loop already handles internally (its JSON-fallback branch).
 *
 * On top of the agent's `finalize_playlist` recommendation (or of a JSON text
 * answer for non-tool providers), we run the legacy worker pool to:
 *   - match each recommended track against the backend and collect URIs,
 *   - surface infrastructure errors distinctly from " track genuinely not on
 *     backend" results, and trigger the named-artists merge guarantee.
 *
 * Calls the agent loop up front, then the same worker pool + named-artists
 * merge as the legacy path. Reasoning deltas are surfaced separately to the
 * harness for the "thinking around the donut" UI.
 */
export async function resolvePlaylist(
  provider: AgentProvider,
  music: MusicProvider,
  prompt: string,
  qa: ClarifyAnswer[],
  opts: ResolvePlaylistOptions = {},
): Promise<ResolvedPlaylist> {
  const { onProgress, onToken, onReasoning, onEvent, signal, tasteContext, onClarifyTool } = opts;

  // System prompt: prefer the agent-mode preamble, which carries both the
  // curator contract and the tool-usage discipline. The loop's JSON-fallback
  // branch handles providers that silently drop tools (some Ollama models).
  const agentSystem = agentSystemPrompt();
  const baseSystem = tasteContext
    ? `${agentSystem}\n\n${tasteContext}`
    : agentSystem;
  const user = generatePlaylistUserWithAnswers(prompt, qa);

  onProgress?.({ phase: "thinking" });

  // If the provider doesn't advertise a clarify hook, still allow non-tool
  // providers to use this direct path — the loop falls back to JSON parsing.
  // Sinking the loop with no onClarifyTool disables the clarify tool at the
  // harness layer (the dispatcher throws on it, but the agent won't call it
  // anyway since tools-for-prompt step encodes tool specs in the call itself).
  let agentResult: AgentRunResult;
  try {
    agentResult = await runAgentLoop(provider, baseSystem, user, {
      deps: {
        music,
        onClarify: onClarifyTool,
        onToolStart: (name) => onProgress?.({ phase: "tool", toolName: name }),
        onToolEnd: (name) => onProgress?.({ phase: "tool", toolName: name }),
      },
      maxIterations: 6,
      onToken,
      onReasoning,
      onEvent,
      signal,
      onProgress: (phase) => {
        if (phase === "thinking") {
          onProgress?.({ phase: "thinking" });
        } else if (phase.startsWith("tool:")) {
          onProgress?.({ phase: "tool", toolName: phase.slice("tool:".length) });
        }
      },
    });
  } catch (e) {
    // Loop failure (maxIter exceeded, finalize malformed, abort). Don't
    // attempt a legacy single-shot — the loop already exhausted JSON fallback.
    throw e;
  }

  // Re-resolve each track against the backend for URIs. The agent may have
  // already called searchTrack for verification, but the harness doesn't
  // trust that to have produced URIs (some providers normalize tool args
  // differently). Worker pool identical to the legacy path.
  const rec = agentResult.playlist;
  const { resolved, unresolved } = await resolvePlaylistWorker(rec.tracks, music, signal, onProgress);

  // Named-artists guarantee — unchanged from the legacy implementation.
  const artistTracks: Track[] = [];
  for (const name of rec.artists) {
    signal?.throwIfAborted();
    try {
      const artist = await music.searchArtist(name);
      if (!artist) continue;
      artistTracks.push(...(await music.getArtistTopTracks(artist.id, 5)));
    } catch (e) {
      console.error("[resolve] artist top-tracks failed", name, e instanceof Error ? e.message : e);
    }
  }
  const byUri = new Map<string, Track>();
  for (const track of [...artistTracks, ...resolved]) {
    if (!byUri.has(track.uri)) byUri.set(track.uri, track);
  }
  const merged = [...byUri.values()];

  if (merged.length === 0) {
    throw new Error(`no tracks resolved on ${music.name} (check logs for searchTrack errors)`);
  }

  onProgress?.({ phase: "done" });
  return { name: rec.name, description: `Generated for: ${prompt}`, resolved: merged, unresolved };
}

/**
 * Worker pool identical to the legacy resolve step: 5 concurrent searchTrack
 * calls with per-call timeout. Auth / transient failures bubble up; genuine
 * "not on backend" results become null and are pushed to `unresolved`.
 */
async function resolvePlaylistWorker(
  tracks: TrackRec[],
  music: MusicProvider,
  signal: AbortSignal | undefined,
  onProgress?: (progress: Progress) => void,
): Promise<{ resolved: Track[]; unresolved: TrackRec[] }> {
  const resolved: Track[] = [];
  const unresolved: TrackRec[] = [];
  const total = tracks.length;
  onProgress?.({ phase: "resolving", current: 0, total });
  const CONCURRENCY = 5;
  const results: (Track | null)[] = new Array(total).fill(null);
  let nextIndex = 0;
  let completed = 0;
  let failed = false;

  async function worker() {
    for (;;) {
      if (failed) return;
      signal?.throwIfAborted();
      const i = nextIndex++;
      if (i >= total) return;
      const track = tracks[i]!;
      try {
        results[i] = await withTimeout(
          music.searchTrack(track.artist, track.title),
          SEARCH_TIMEOUT_MS,
          "track",
        ).catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          if (/\b(401|403|429)\b|\b5\d\d\b|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed/i.test(msg)) {
            throw e;
          }
          console.error("[resolve] searchTrack failed", track.artist, "-", track.title, msg);
          return null;
        });
      } catch (e) {
        failed = true;
        throw e;
      }
      onProgress?.({ phase: "resolving", current: ++completed, total });
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));

  for (const [i, track] of tracks.entries()) {
    const found = results[i];
    if (found) {
      resolved.push(found);
    } else {
      unresolved.push(track);
    }
  }
  return { resolved, unresolved };
}

export async function commitPlaylist(
  music: MusicProvider,
  name: string,
  description: string,
  resolved: Track[],
  onProgress?: (progress: Progress) => void,
): Promise<RemotePlaylist> {
  if (!music.capabilities.remotePlaylists || !music.createPlaylist || !music.addTracksToPlaylist) {
    throw new Error(`${music.name} cannot create remote playlists — use local playback queue instead`);
  }
  onProgress?.({ phase: "creating" });
  const playlist = await music.createPlaylist(name, description);
  onProgress?.({ phase: "adding" });
  await music.addTracksToPlaylist(
    playlist.id,
    resolved.map((t) => t.uri),
  );
  onProgress?.({ phase: "done" });
  return playlist;
}