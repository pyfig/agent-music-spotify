import { afterEach, describe, expect, test } from "bun:test";
import type { MusicProvider } from "../src/music/types";
import { SpotifyClient } from "../src/spotify/client";
import { SoundCloudClient } from "../src/music/soundcloud/client";
import { YouTubeMusicClient, type YtmApi } from "../src/music/ytmusic/client";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(handler: (url: string) => unknown) {
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    const body = handler(url);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

const emptySearch = {
  tracks: { items: [] },
  artists: { items: [] },
  albums: { items: [] },
};

const spotifyTrackItem = {
  id: "t1",
  uri: "spotify:track:t1",
  name: "Song",
  duration_ms: 123000,
  artists: [{ name: "Artist" }],
  album: { name: "Album", images: [{ url: "http://img" }] },
  external_urls: { spotify: "https://open.spotify.com/track/t1" },
};

interface ProviderCase {
  name: string;
  make: () => MusicProvider;
  // For fetch-based providers; api-injection providers pass empty handlers.
  mockFound: (url: string) => unknown;
  mockNotFound: (url: string) => unknown;
  makeNotFound?: () => MusicProvider;
}

const ytmSong = {
  type: "SONG",
  videoId: "abc123",
  name: "Song",
  artist: { artistId: "a1", name: "Artist" },
  album: { albumId: "al1", name: "Album" },
  duration: 123,
  thumbnails: [{ url: "http://img", width: 60, height: 60 }],
};

function fakeYtmApi(songs: any[]): YtmApi {
  return {
    searchSongs: async () => songs,
    searchArtists: async () => [],
    getArtistSongs: async () => songs,
  };
}

const soundcloudTrackItem = {
  id: 12345,
  title: "Song",
  duration: 123000,
  artwork_url: "http://img",
  user: { username: "Artist" },
};

const cases: ProviderCase[] = [
  {
    name: "spotify",
    make: () => new SpotifyClient("test-token"),
    mockFound: (url) =>
      url.includes("/search") ? { tracks: { items: [spotifyTrackItem] } } : emptySearch,
    mockNotFound: () => emptySearch,
  },
  {
    name: "soundcloud",
    make: () => new SoundCloudClient("test-client-id"),
    mockFound: (url) =>
      url.includes("/search/tracks") ? { collection: [soundcloudTrackItem] } : { collection: [] },
    mockNotFound: () => ({ collection: [] }),
  },
  {
    name: "youtube-music",
    make: () => new YouTubeMusicClient(fakeYtmApi([ytmSong])),
    makeNotFound: () => new YouTubeMusicClient(fakeYtmApi([])),
    mockFound: () => ({}),
    mockNotFound: () => ({}),
  },
];

describe.each(cases)("provider contract: $name", ({ make, mockFound, mockNotFound, makeNotFound }) => {
  test("searchTrack returns Track with non-empty uri/title/artist", async () => {
    mockFetch(mockFound);
    const provider = make();
    const track = await provider.searchTrack("Artist", "Song");
    expect(track).not.toBeNull();
    expect(track!.uri.length).toBeGreaterThan(0);
    expect(track!.title.length).toBeGreaterThan(0);
    expect(track!.artist.length).toBeGreaterThan(0);
  });

  test("searchTrack returns null (not throw) when nothing found", async () => {
    mockFetch(mockNotFound);
    const provider = makeNotFound ? makeNotFound() : make();
    const track = await provider.searchTrack("Nobody", "Nothing");
    expect(track).toBeNull();
  });

  test("capabilities agree with defined methods", () => {
    const provider = make();
    const caps = provider.capabilities;
    expect(typeof provider.createPlaylist === "function").toBe(caps.remotePlaylists);
    expect(typeof provider.addTracksToPlaylist === "function").toBe(caps.remotePlaylists);
    expect(typeof provider.resolvePlayableUrl === "function").toBe(caps.localPlayback);
  });
});
