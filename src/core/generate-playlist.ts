import {
  CLARIFY_SYSTEM,
  clarifyUser,
  GENERATE_PLAYLIST_SYSTEM,
  generatePlaylistUserWithAnswers,
  type ClarifyAnswer,
} from "../agent/prompts";
import { parsePlaylistResponse, parseClarifyResponse, withRetry, type TrackRec, type ClarifyRec } from "../agent/parse";
import type { AgentProvider } from "../agent/types";
import type { MusicProvider, RemotePlaylist, Track } from "../music/types";

export interface ResolvedPlaylist {
  name: string;
  description: string;
  resolved: Track[];
  unresolved: TrackRec[];
}

export interface Progress {
  phase: "clarifying" | "thinking" | "resolving" | "creating" | "adding" | "done";
  current?: number;
  total?: number;
}

/** Per-track search budget. A hung backend request (e.g. ytmusic-api with no
 * timeout of its own) would otherwise stall the whole worker pool forever —
 * progress freezes one short of total. The timeout message is deliberately
 * non-network so the classifier below marks the track unresolved instead of
 * failing the entire playlist. */
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

export async function clarify(
  provider: AgentProvider,
  prompt: string,
  signal?: AbortSignal,
): Promise<ClarifyRec> {
  return withRetry(
    () => provider.generate(CLARIFY_SYSTEM, clarifyUser(prompt), undefined, signal),
    parseClarifyResponse,
  );
}

export async function resolvePlaylist(
  provider: AgentProvider,
  music: MusicProvider,
  prompt: string,
  qa: ClarifyAnswer[],
  onProgress?: (progress: Progress) => void,
  onToken?: (delta: string) => void,
  signal?: AbortSignal,
  /** Optional taste-memory block appended to the system prompt. */
  tasteContext?: string,
): Promise<ResolvedPlaylist> {
  onProgress?.({ phase: "thinking" });
  const system = tasteContext
    ? `${GENERATE_PLAYLIST_SYSTEM}\n\n${tasteContext}`
    : GENERATE_PLAYLIST_SYSTEM;
  const rec = await withRetry(
    () =>
      provider.generate(
        system,
        generatePlaylistUserWithAnswers(prompt, qa),
        onToken,
        signal,
      ),
    parsePlaylistResponse,
  );

  const resolved: Track[] = [];
  const unresolved: TrackRec[] = [];
  const total = rec.tracks.length;
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
      const track = rec.tracks[i]!;
      try {
        results[i] = await withTimeout(
          music.searchTrack(track.artist, track.title),
          SEARCH_TIMEOUT_MS,
          "track",
        ).catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          // Auth and transient failures look like "unresolved" — surface them
          // instead of masking them as a genuine not-on-Spotify result.
          // 401/403: bad token / dev-mode allowlist; 429: rate limited; 5xx:
          // server error; network: ECONNRESET/ETIMEDOUT/ENOTFOUND/fetch failed.
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

  for (const [i, track] of rec.tracks.entries()) {
    const found = results[i];
    if (found) {
      resolved.push(found);
    } else {
      unresolved.push(track);
    }
  }
  // Guarantee: artists explicitly named in the prompt always land in the
  // playlist — force-merge their top tracks regardless of what the LLM picked.
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
