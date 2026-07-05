const API_BASE = "https://api.spotify.com/v1";

function normalizeName(s: string): string {
  return s.normalize("NFKD").toLowerCase().trim();
}

function pickByArtist(items: any[], artist: string): any | undefined {
  const want = normalizeName(artist);
  return items.find((item) =>
    (item.artists ?? []).some((a: any) => {
      const got = normalizeName(a?.name ?? "");
      return got === want || got.includes(want) || want.includes(got);
    }),
  );
}

export interface SpotifyAlbum {
  id: string;
  uri: string;
  name: string;
  artist: string;
  year?: number;
  url: string;
}

export interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  artist: string;
  url: string;
}

export interface SpotifyPlaylist {
  id: string;
  uri: string;
  url: string;
  name: string;
}

export interface SpotifyDevice {
  id: string;
  name: string;
  isActive: boolean;
}

export class SpotifyClient {
  constructor(private accessToken: string) {}

  // Shared across concurrent requests: when one request gets a 429, all
  // in-flight requests wait until this timestamp before retrying/starting.
  private rateLimitedUntil = 0;

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const MAX_RETRIES = 5;
    const MAX_429_WAIT_MS = 30_000;
    let attempt = 0;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (;;) {
      const pause = this.rateLimitedUntil - Date.now();
      if (pause > 0) await sleep(pause);
      const res = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          "content-type": "application/json",
          ...init?.headers,
        },
      });
      if (res.status === 429 && attempt < MAX_RETRIES) {
        // honor Retry-After if present (seconds), else exponential backoff
        const retryAfterHeader = Number(res.headers.get("retry-after"));
        const backoff = Math.min(1000 * 2 ** attempt, 16_000);
        const waitMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
          ? Math.max(retryAfterHeader * 1000, backoff)
          : backoff;
        // Quota-exceeded 429s can carry Retry-After of many minutes/hours —
        // waiting that out looks like an infinite hang. Fail fast instead.
        if (waitMs > MAX_429_WAIT_MS) {
          throw new Error(
            `spotify API rate limited (429): asked to wait ${Math.ceil(waitMs / 1000)}s — try again later`,
          );
        }
        this.rateLimitedUntil = Math.max(this.rateLimitedUntil, Date.now() + waitMs);
        attempt++;
        continue;
      }
      if (!res.ok) {
        const body = await res.text();
        const hint =
          res.status === 403
            ? " — 403: app likely in Development Mode; add your Spotify account under Developer Dashboard → app → User Management, or set SPOTIFY_CLIENT_ID to your own app"
            : "";
        throw new Error(`spotify API ${path.split("?")[0]} failed: ${res.status} ${body}${hint}`);
      }
      return res;
    }
  }

  async searchAlbum(artist: string, album: string): Promise<SpotifyAlbum | null> {
    const strict = encodeURIComponent(`album:${album} artist:${artist}`);
    const res = await this.request(`/search?q=${strict}&type=album&limit=5`);
    const data = (await res.json()) as any;
    let item = pickByArtist(data.albums?.items ?? [], artist);
    if (!item) {
      // Field filters are brittle for non-Latin (e.g. Cyrillic) names; retry with a plain query.
      const loose = encodeURIComponent(`${artist} ${album}`);
      const looseRes = await this.request(`/search?q=${loose}&type=album&limit=5`);
      const looseData = (await looseRes.json()) as any;
      item = pickByArtist(looseData.albums?.items ?? [], artist) ?? looseData.albums?.items?.[0];
    }
    if (!item) return null;
    return {
      id: item.id,
      uri: item.uri,
      name: item.name,
      artist: item.artists?.[0]?.name ?? artist,
      year: item.release_date ? Number.parseInt(item.release_date.slice(0, 4), 10) : undefined,
      url: item.external_urls?.spotify ?? "",
    };
  }

  async searchTrack(artist: string, title: string): Promise<SpotifyTrack | null> {
    const strict = await this.searchTrackQuery(`track:${title} artist:${artist}`);
    let item = pickByArtist(strict, artist);
    if (!item) {
      // Field filters are brittle for non-Latin (e.g. Cyrillic) names; retry with a plain query.
      const loose = await this.searchTrackQuery(`${artist} ${title}`);
      item = pickByArtist(loose, artist) ?? loose[0];
    }
    if (!item) {
      // Last-tier fallback: title only (handles slightly-off artist names, feat. clauses, remixes).
      const byTitle = await this.searchTrackQuery(`track:${title}`);
      item = byTitle[0];
    }
    if (!item) return null;
    return {
      id: item.id,
      uri: item.uri,
      name: item.name,
      artist: item.artists?.[0]?.name ?? artist,
      url: item.external_urls?.spotify ?? "",
    };
  }

  private async searchTrackQuery(query: string): Promise<any[]> {
    const res = await this.request(`/search?q=${encodeURIComponent(query)}&type=track&limit=5`);
    const data = (await res.json()) as any;
    return data.tracks?.items ?? [];
  }

  async searchArtist(name: string): Promise<{ id: string; name: string } | null> {
    const strict = encodeURIComponent(`artist:${name}`);
    const res = await this.request(`/search?q=${strict}&type=artist&limit=1`);
    const data = (await res.json()) as any;
    let item = data.artists?.items?.[0];
    if (!item) {
      // Field filters are brittle for non-Latin (e.g. Cyrillic) names; retry with a plain query.
      const loose = encodeURIComponent(name);
      const looseRes = await this.request(`/search?q=${loose}&type=artist&limit=1`);
      const looseData = (await looseRes.json()) as any;
      item = looseData.artists?.items?.[0];
    }
    if (!item) return null;
    return { id: item.id, name: item.name };
  }

  async getCurrentUserId(): Promise<string> {
    const res = await this.request("/me");
    const data = (await res.json()) as any;
    return data.id;
  }

  async createPlaylist(name: string, description?: string): Promise<SpotifyPlaylist> {
    const res = await this.request(`/me/playlists`, {
      method: "POST",
      body: JSON.stringify({ name, description, public: false }),
    });
    const data = (await res.json()) as any;
    return { id: data.id, uri: data.uri, url: data.external_urls?.spotify ?? "", name: data.name };
  }

  async addTracksToPlaylist(playlistId: string, trackUris: string[]): Promise<void> {
    // Newer Spotify apps must use /playlists/{id}/items; the legacy /tracks
    // endpoint returns 403 Forbidden for them. Fall back for older apps.
    for (let i = 0; i < trackUris.length; i += 100) {
      const batch = trackUris.slice(i, i + 100);
      await this.request(`/playlists/${playlistId}/items`, {
        method: "POST",
        body: JSON.stringify({ uris: batch }),
      }).catch(async (e) => {
        if (e instanceof Error && /\b40[34]\b/.test(e.message)) {
          return this.request(`/playlists/${playlistId}/tracks`, {
            method: "POST",
            body: JSON.stringify({ uris: batch }),
          });
        }
        throw e;
      });
    }
  }

  async getDevices(): Promise<SpotifyDevice[]> {
    const res = await this.request("/me/player/devices");
    const data = (await res.json()) as any;
    return (data.devices ?? []).map((d: any) => ({
      id: d.id,
      name: d.name,
      isActive: d.is_active,
    }));
  }

  async play(uri: string, deviceId?: string): Promise<void> {
    // Spotify Web API returns 404 when there's no active device. Check first
    // and auto-select an available device, or surface a helpful error.
    const devices = await this.getDevices();
    if (devices.length === 0) {
      throw new Error("No Spotify devices found. Open Spotify app on any device first.");
    }
    const activeDevice = devices.find((d) => d.isActive);
    const targetDeviceId = deviceId ?? activeDevice?.id ?? devices[0]?.id;
    const path = `/me/player/play?device_id=${targetDeviceId}`;
    const isPlaylistOrAlbum = uri.includes(":playlist:") || uri.includes(":album:");
    await this.request(path, {
      method: "PUT",
      body: JSON.stringify(isPlaylistOrAlbum ? { context_uri: uri } : { uris: [uri] }),
    });
  }

  async getCurrentlyPlaying(): Promise<{ uri: string | null; isPlaying: boolean } | null> {
    const res = await fetch(`${API_BASE}/me/player`, {
      headers: { authorization: `Bearer ${this.accessToken}` },
    });
    if (res.status === 204) return null;
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    return {
      uri: data?.item?.uri ?? data?.context?.uri ?? null,
      isPlaying: data?.is_playing ?? false,
    };
  }

  async saveAlbum(albumId: string): Promise<void> {
    await this.request(`/me/albums?ids=${albumId}`, { method: "PUT" });
  }
}
