import { GENERATE_PLAYLIST_SYSTEM, generatePlaylistUser } from "../agent/prompts";
import { parsePlaylistResponse, withRetry, type TrackRec } from "../agent/parse";
import type { AgentProvider } from "../agent/types";
import type { SpotifyClient, SpotifyPlaylist, SpotifyTrack } from "../spotify/client";

export interface GeneratedPlaylist {
  playlist: SpotifyPlaylist;
  resolved: SpotifyTrack[];
  unresolved: TrackRec[];
}

export async function generatePlaylist(
  provider: AgentProvider,
  spotify: SpotifyClient,
  prompt: string,
): Promise<GeneratedPlaylist> {
  const rec = await withRetry(
    () => provider.generate(GENERATE_PLAYLIST_SYSTEM, generatePlaylistUser(prompt)),
    parsePlaylistResponse,
  );

  const resolved: SpotifyTrack[] = [];
  const unresolved: TrackRec[] = [];
  for (const track of rec.tracks) {
    const found = await spotify.searchTrack(track.artist, track.title).catch(() => null);
    if (found) {
      resolved.push(found);
    } else {
      unresolved.push(track);
    }
  }
  if (resolved.length === 0) {
    throw new Error("no tracks resolved on Spotify");
  }

  const playlist = await spotify.createPlaylist(rec.name, `Generated for: ${prompt}`);
  await spotify.addTracksToPlaylist(
    playlist.id,
    resolved.map((t) => t.uri),
  );

  return { playlist, resolved, unresolved };
}
