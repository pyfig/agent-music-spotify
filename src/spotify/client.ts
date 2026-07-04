const API_BASE = "https://api.spotify.com/v1";

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

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        "content-type": "application/json",
        ...init?.headers,
      },
    });
    if (!res.ok) {
      throw new Error(`spotify API ${path} failed: ${res.status} ${await res.text()}`);
    }
    return res;
  }

  async searchAlbum(artist: string, album: string): Promise<SpotifyAlbum | null> {
    const q = encodeURIComponent(`album:${album} artist:${artist}`);
    const res = await this.request(`/search?q=${q}&type=album&limit=1`);
    const data = (await res.json()) as any;
    const item = data.albums?.items?.[0];
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
    const q = encodeURIComponent(`track:${title} artist:${artist}`);
    const res = await this.request(`/search?q=${q}&type=track&limit=1`);
    const data = (await res.json()) as any;
    const item = data.tracks?.items?.[0];
    if (!item) return null;
    return {
      id: item.id,
      uri: item.uri,
      name: item.name,
      artist: item.artists?.[0]?.name ?? artist,
      url: item.external_urls?.spotify ?? "",
    };
  }

  async searchArtist(name: string): Promise<{ id: string; name: string } | null> {
    const q = encodeURIComponent(`artist:${name}`);
    const res = await this.request(`/search?q=${q}&type=artist&limit=1`);
    const data = (await res.json()) as any;
    const item = data.artists?.items?.[0];
    if (!item) return null;
    return { id: item.id, name: item.name };
  }

  async getCurrentUserId(): Promise<string> {
    const res = await this.request("/me");
    const data = (await res.json()) as any;
    return data.id;
  }

  async createPlaylist(name: string, description?: string): Promise<SpotifyPlaylist> {
    const userId = await this.getCurrentUserId();
    const res = await this.request(`/users/${userId}/playlists`, {
      method: "POST",
      body: JSON.stringify({ name, description, public: false }),
    });
    const data = (await res.json()) as any;
    return { id: data.id, uri: data.uri, url: data.external_urls?.spotify ?? "", name: data.name };
  }

  async addTracksToPlaylist(playlistId: string, trackUris: string[]): Promise<void> {
    for (let i = 0; i < trackUris.length; i += 100) {
      const batch = trackUris.slice(i, i + 100);
      await this.request(`/playlists/${playlistId}/tracks`, {
        method: "POST",
        body: JSON.stringify({ uris: batch }),
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
    const path = deviceId ? `/me/player/play?device_id=${deviceId}` : "/me/player/play";
    const isPlaylistOrAlbum = uri.includes(":playlist:") || uri.includes(":album:");
    await this.request(path, {
      method: "PUT",
      body: JSON.stringify(isPlaylistOrAlbum ? { context_uri: uri } : { uris: [uri] }),
    });
  }

  async saveAlbum(albumId: string): Promise<void> {
    await this.request(`/me/albums?ids=${albumId}`, { method: "PUT" });
  }
}
