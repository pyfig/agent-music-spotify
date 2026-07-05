import {
  CLARIFY_SYSTEM,
  clarifyUser,
  GENERATE_PLAYLIST_SYSTEM,
  generatePlaylistUserWithAnswers,
  type ClarifyAnswer,
} from "../agent/prompts";
import { parsePlaylistResponse, parseClarifyResponse, withRetry, type TrackRec, type ClarifyRec } from "../agent/parse";
import type { AgentProvider } from "../agent/types";
import type { SpotifyClient, SpotifyPlaylist, SpotifyTrack } from "../spotify/client";

export interface ResolvedPlaylist {
  name: string;
  description: string;
  resolved: SpotifyTrack[];
  unresolved: TrackRec[];
}

export interface Progress {
  phase: "clarifying" | "thinking" | "resolving" | "creating" | "adding" | "done";
  current?: number;
  total?: number;
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
  spotify: SpotifyClient,
  prompt: string,
  qa: ClarifyAnswer[],
  onProgress?: (progress: Progress) => void,
  onToken?: (delta: string) => void,
  signal?: AbortSignal,
): Promise<ResolvedPlaylist> {
  onProgress?.({ phase: "thinking" });
  const rec = await withRetry(
    () =>
      provider.generate(
        GENERATE_PLAYLIST_SYSTEM,
        generatePlaylistUserWithAnswers(prompt, qa),
        onToken,
        signal,
      ),
    parsePlaylistResponse,
  );

  const resolved: SpotifyTrack[] = [];
  const unresolved: TrackRec[] = [];
  const total = rec.tracks.length;
  onProgress?.({ phase: "resolving", current: 0, total });
  const CONCURRENCY = 5;
  const results: (SpotifyTrack | null)[] = new Array(total).fill(null);
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
        results[i] = await spotify.searchTrack(track.artist, track.title).catch((e) => {
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
  if (resolved.length === 0) {
    throw new Error("no tracks resolved on Spotify (check logs for searchTrack errors)");
  }

  onProgress?.({ phase: "done" });
  return { name: rec.name, description: `Generated for: ${prompt}`, resolved, unresolved };
}

export async function commitPlaylist(
  spotify: SpotifyClient,
  name: string,
  description: string,
  resolved: SpotifyTrack[],
  onProgress?: (progress: Progress) => void,
): Promise<SpotifyPlaylist> {
  onProgress?.({ phase: "creating" });
  const playlist = await spotify.createPlaylist(name, description);
  onProgress?.({ phase: "adding" });
  await spotify.addTracksToPlaylist(
    playlist.id,
    resolved.map((t) => t.uri),
  );
  onProgress?.({ phase: "done" });
  return playlist;
}
