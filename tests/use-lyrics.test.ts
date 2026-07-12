import { describe, expect, test, beforeEach, afterEach, jest } from "bun:test";
import { useRef } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { useLyrics, type TrackMeta, type LyricsAnchor } from "../src/hooks/useLyrics";
import type { LyricsResult } from "../src/lyrics/client";

const SAMPLE_LYRICS: LyricsResult = {
  synced: [
    { timeMs: 0, text: "First line" },
    { timeMs: 5000, text: "Second line" },
  ],
  plain: "First line\nSecond line",
};

function useTestHook(
  lyricsMode: boolean,
  currentlyPlayingUri: string | null,
  currentTrackMeta: TrackMeta,
) {
  const anchorRef = useRef<LyricsAnchor | null>(null);
  return useLyrics(lyricsMode, currentlyPlayingUri, currentTrackMeta, anchorRef);
}

describe("useLyrics", () => {
  let fetchCalls: { artist: string; title: string; durationMs?: number }[] = [];
  let fetchMock: typeof fetch;

  beforeEach(() => {
    fetchCalls = [];
    fetchMock = globalThis.fetch = jest.fn(async (_input, _init) => {
      return new Response(
        JSON.stringify({
          syncedLyrics: "[00:00.00] First line\n[00:05.00] Second line",
          plainLyrics: "First line\nSecond line",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = fetchMock;
  });

  test("fetches lyrics immediately when metadata matches URI", async () => {
    const meta: TrackMeta = { uri: "spotify:track:1", artist: "Artist", title: "Title", durationMs: 1000 };
    const { result } = renderHook(({ lyricsMode, uri, meta }) =>
      useTestHook(lyricsMode, uri, meta),
      {
        initialProps: {
          lyricsMode: true,
          uri: "spotify:track:1" as string | null,
          meta,
        },
      },
    );

    await waitFor(() => expect(result.current.lyricsData).toEqual(SAMPLE_LYRICS));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("retries fetch when metadata arrives after URI", async () => {
    const staleMeta: TrackMeta = { uri: null, artist: "", title: "", durationMs: 0 };
    const goodMeta: TrackMeta = { uri: "spotify:track:1", artist: "Artist", title: "Title", durationMs: 1000 };

    const { result, rerender } = renderHook(
      ({ lyricsMode, uri, meta }) => useTestHook(lyricsMode, uri, meta),
      {
        initialProps: {
          lyricsMode: true,
          uri: "spotify:track:1" as string | null,
          meta: staleMeta,
        },
      },
    );

    // No fetch yet — metadata doesn't match the URI.
    expect(result.current.lyricsData).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(0);

    // Metadata arrives on a later render.
    rerender({ lyricsMode: true, uri: "spotify:track:1", meta: goodMeta });

    await waitFor(() => expect(result.current.lyricsData).toEqual(SAMPLE_LYRICS));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("uses cache on subsequent renders and does not refetch", async () => {
    const meta: TrackMeta = { uri: "spotify:track:1", artist: "Artist", title: "Title", durationMs: 1000 };
    const { result, rerender } = renderHook(
      ({ lyricsMode, uri, meta }) => useTestHook(lyricsMode, uri, meta),
      {
        initialProps: {
          lyricsMode: true,
          uri: "spotify:track:1" as string | null,
          meta,
        },
      },
    );

    await waitFor(() => expect(result.current.lyricsData).toEqual(SAMPLE_LYRICS));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Re-render with same URI — should hit cache.
    rerender({ lyricsMode: true, uri: "spotify:track:1", meta });

    expect(result.current.lyricsData).toEqual(SAMPLE_LYRICS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("cancels in-flight fetch when URI changes", async () => {
    const meta1: TrackMeta = { uri: "spotify:track:1", artist: "Artist", title: "Title", durationMs: 1000 };
    const meta2: TrackMeta = { uri: "spotify:track:2", artist: "Artist", title: "Other", durationMs: 1000 };

    const { rerender } = renderHook(
      ({ lyricsMode, uri, meta }) => useTestHook(lyricsMode, uri, meta),
      {
        initialProps: {
          lyricsMode: true,
          uri: "spotify:track:1" as string | null,
          meta: meta1,
        },
      },
    );

    // Change URI before the first fetch resolves.
    rerender({ lyricsMode: true, uri: "spotify:track:2", meta: meta2 });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  test("does not fetch when lyricsMode is off", async () => {
    const meta: TrackMeta = { uri: "spotify:track:1", artist: "Artist", title: "Title", durationMs: 1000 };
    const { result } = renderHook(({ lyricsMode, uri, meta }) =>
      useTestHook(lyricsMode, uri, meta),
      {
        initialProps: {
          lyricsMode: false,
          uri: "spotify:track:1" as string | null,
          meta,
        },
      },
    );

    expect(result.current.lyricsData).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  test("does not fetch when no track is playing", async () => {
    const meta: TrackMeta = { uri: null, artist: "", title: "", durationMs: 0 };
    const { result } = renderHook(({ lyricsMode, uri, meta }) =>
      useTestHook(lyricsMode, uri, meta),
      {
        initialProps: {
          lyricsMode: true,
          uri: null as string | null,
          meta,
        },
      },
    );

    expect(result.current.lyricsData).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});
