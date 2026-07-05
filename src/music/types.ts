export interface Track {
  /** Provider-specific URI: spotify:track:x / sc:12345 / ytm:videoId */
  uri: string;
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  artwork?: string;
}

export interface RemotePlaylist {
  id: string;
  uri: string;
  url?: string;
  name: string;
}

export interface ProviderCapabilities {
  /** Can create playlists on the service side. */
  remotePlaylists: boolean;
  /** Spotify Connect-style playback controlled via the service's API. */
  remotePlayback: boolean;
  /** Can resolve a stream URL playable by a local player (mpv). */
  localPlayback: boolean;
}

export type MusicBackend = "spotify" | "soundcloud" | "youtube-music";

export interface MusicProvider {
  readonly name: MusicBackend;
  readonly capabilities: ProviderCapabilities;

  searchTrack(artist: string, title: string): Promise<Track | null>;
  searchArtist(name: string): Promise<{ id: string; name: string } | null>;
  getArtistTopTracks(artistId: string, limit?: number): Promise<Track[]>;

  // Present only when capabilities.remotePlaylists:
  createPlaylist?(name: string, description?: string): Promise<RemotePlaylist>;
  addTracksToPlaylist?(playlistId: string, uris: string[]): Promise<void>;

  // Present only when capabilities.localPlayback: returns something mpv can
  // play — a direct stream URL or a page URL for ytdl.
  resolvePlayableUrl?(track: Track): Promise<string>;
}
