import type { MusicProvider, ProviderCapabilities, Track } from "../types";

const API_BASE = "https://api-v2.soundcloud.com";

function normalizeName(s: string): string {
  return s.normalize("NFKD").toLowerCase().trim();
}

function pickByArtist(items: any[], artist: string): any | undefined {
  const want = normalizeName(artist);
  return items.find((item) => {
    const got = normalizeName(item?.user?.username ?? "");
    return got === want || got.includes(want) || want.includes(got);
  });
}

function toTrack(item: any): Track {
  return {
    uri: `sc:${item.id}`,
    title: item.title,
    artist: item.user?.username ?? "",
    durationMs: item.duration,
    artwork: item.artwork_url ?? undefined,
  };
}

export class SoundCloudClient implements MusicProvider {
  readonly name = "soundcloud" as const;
  readonly capabilities: ProviderCapabilities = {
    remotePlaylists: false,
    remotePlayback: false,
    localPlayback: true,
  };

  constructor(
    private clientId: string,
    private refreshClientId?: () => Promise<string>,
  ) {}

  private async request(path: string): Promise<any> {
    const sep = path.includes("?") ? "&" : "?";
    const url = () => `${API_BASE}${path}${sep}client_id=${this.clientId}`;
    let res = await fetch(url());
    if ((res.status === 401 || res.status === 403) && this.refreshClientId) {
      // Scraped client_ids rot; refresh once, then fail loudly.
      this.clientId = await this.refreshClientId();
      this.refreshClientId = undefined;
      res = await fetch(url());
    }
    if (!res.ok) {
      throw new Error(`soundcloud API ${path.split("?")[0]} failed: ${res.status}`);
    }
    return res.json();
  }

  async searchTrack(artist: string, title: string): Promise<Track | null> {
    const q = encodeURIComponent(`${artist} ${title}`);
    const data = await this.request(`/search/tracks?q=${q}&limit=10`);
    const items = (data.collection ?? []) as any[];
    const item = pickByArtist(items, artist) ?? items[0];
    return item ? toTrack(item) : null;
  }

  async searchArtist(name: string): Promise<{ id: string; name: string } | null> {
    const q = encodeURIComponent(name);
    const data = await this.request(`/search/users?q=${q}&limit=1`);
    const item = (data.collection ?? [])[0];
    return item ? { id: String(item.id), name: item.username } : null;
  }

  async getArtistTopTracks(artistId: string, limit = 5): Promise<Track[]> {
    const data = await this.request(`/users/${artistId}/toptracks?limit=${limit}`);
    return ((data.collection ?? []) as any[]).slice(0, limit).map(toTrack);
  }

  /**
   * Two-step resolve, the way api-v2 actually works: the track carries
   * media.transcodings[]; picking one and GETting its url (with client_id)
   * returns JSON whose `url` field is the playable stream.
   */
  async resolvePlayableUrl(track: Track): Promise<string> {
    const id = track.uri.replace(/^sc:/, "");
    const data = await this.request(`/tracks/${id}`);
    const transcodings = (data.media?.transcodings ?? []) as any[];
    const chosen =
      transcodings.find((t) => t.format?.protocol === "progressive") ??
      transcodings.find((t) => t.format?.protocol === "hls"); // mpv handles HLS fine
    if (!chosen?.url) {
      throw new Error(`soundcloud track ${id} has no playable transcoding`);
    }
    const sep = chosen.url.includes("?") ? "&" : "?";
    const res = await fetch(`${chosen.url}${sep}client_id=${this.clientId}`);
    if (!res.ok) {
      throw new Error(`soundcloud stream resolve failed: ${res.status}`);
    }
    const stream = (await res.json()) as { url?: string };
    if (!stream.url) throw new Error(`soundcloud stream resolve returned no url`);
    return stream.url;
  }
}
