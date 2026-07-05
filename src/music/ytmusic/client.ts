import type { MusicProvider, ProviderCapabilities, Track } from "../types";

/**
 * The slice of ytmusic-api we use; injectable in tests. Anonymous init is
 * enough for search/artist/top-tracks — no cookies needed.
 */
export interface YtmApi {
  searchSongs(query: string): Promise<any[]>;
  searchArtists(query: string): Promise<any[]>;
  getArtistSongs(artistId: string): Promise<any[]>;
}

function normalizeName(s: string): string {
  return s.normalize("NFKD").toLowerCase().trim();
}

function toTrack(song: any): Track {
  return {
    uri: `ytm:${song.videoId}`,
    title: song.name,
    artist: song.artist?.name ?? "",
    album: song.album?.name ?? undefined,
    durationMs: song.duration != null ? song.duration * 1000 : undefined,
    artwork: song.thumbnails?.at(-1)?.url,
  };
}

export class YouTubeMusicClient implements MusicProvider {
  readonly name = "youtube-music" as const;
  readonly capabilities: ProviderCapabilities = {
    remotePlaylists: false,
    remotePlayback: false,
    localPlayback: true,
  };

  constructor(private api?: YtmApi) {}

  private async ensureApi(): Promise<YtmApi> {
    if (this.api) return this.api;
    const { default: YTMusic } = await import("ytmusic-api");
    const api = new YTMusic();
    await api.initialize();
    this.api = api as unknown as YtmApi;
    return this.api;
  }

  async searchTrack(artist: string, title: string): Promise<Track | null> {
    const api = await this.ensureApi();
    const songs = await api.searchSongs(`${artist} ${title}`);
    const want = normalizeName(artist);
    const match =
      songs.find((s) => {
        const got = normalizeName(s.artist?.name ?? "");
        return got === want || got.includes(want) || want.includes(got);
      }) ?? songs[0];
    return match ? toTrack(match) : null;
  }

  async searchArtist(name: string): Promise<{ id: string; name: string } | null> {
    const api = await this.ensureApi();
    const artists = await api.searchArtists(name);
    const item = artists[0];
    return item?.artistId ? { id: item.artistId, name: item.name } : null;
  }

  async getArtistTopTracks(artistId: string, limit = 5): Promise<Track[]> {
    const api = await this.ensureApi();
    const songs = await api.getArtistSongs(artistId);
    return songs.slice(0, limit).map(toTrack);
  }

  /**
   * mpv opens page URLs itself via yt-dlp (--ytdl is on by default), so a
   * watch URL is directly playable — no manual stream extraction.
   */
  async resolvePlayableUrl(track: Track): Promise<string> {
    return `https://music.youtube.com/watch?v=${track.uri.replace(/^ytm:/, "")}`;
  }
}
