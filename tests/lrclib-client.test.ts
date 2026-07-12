import { afterEach, describe, expect, test } from "bun:test";
import { LyricsCache } from "../src/lyrics/client";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** fetchFn that 404s /get and /search alike — a definitive LRCLIB miss. */
const missEverywhere = async () => jsonResponse(null, 404);

describe("LyricsCache.fetch (LRCLIB integration)", () => {
  test("returns synced + plain when both present", async () => {
    const cache = new LyricsCache();
    const fetchFn = async () => jsonResponse({ syncedLyrics: "[00:01.00]Hello\n[00:02.00]World", plainLyrics: "Hello\nWorld" });
    const result = await cache.fetch("spotify:track:abc", "Artist", "Song", 60000, fetchFn);
    if (result === "none" || result === null) throw new Error("expected result");
    expect(result.synced).toHaveLength(2);
    expect(result.synced![0]!.text).toBe("Hello");
    expect(result.synced![0]!.timeMs).toBe(1000);
    expect(result.plain).toBe("Hello\nWorld");
  });

  test("returns synced only when plain is null", async () => {
    const cache = new LyricsCache();
    const fetchFn = async () => jsonResponse({ syncedLyrics: "[00:01.00]Line", plainLyrics: null });
    const result = await cache.fetch("spotify:track:def", "Artist", "Song", undefined, fetchFn);
    if (result === "none" || result === null) throw new Error("expected result");
    expect(result.synced).toHaveLength(1);
    expect(result.plain).toBeUndefined();
  });

  test("returns plain only when synced is null", async () => {
    const cache = new LyricsCache();
    const fetchFn = async () => jsonResponse({ syncedLyrics: null, plainLyrics: "Just text" });
    const result = await cache.fetch("spotify:track:ghi", "Artist", "Song", undefined, fetchFn);
    if (result === "none" || result === null) throw new Error("expected result");
    expect(result.synced).toBeUndefined();
    expect(result.plain).toBe("Just text");
  });

  test("returns 'none' when both /get and /search miss", async () => {
    const cache = new LyricsCache();
    const result = await cache.fetch("spotify:track:404", "Artist", "Song", undefined, missEverywhere);
    expect(result).toBe("none");
  });

  test("returns null (uncached) on non-ok status", async () => {
    let fetchCount = 0;
    const cache = new LyricsCache();
    const fetchFn = async () => { fetchCount++; return jsonResponse(null, 500); };
    const result = await cache.fetch("spotify:track:500", "Artist", "Song", undefined, fetchFn);
    expect(result).toBeNull();
    // Not cached — a retry fetches again.
    await cache.fetch("spotify:track:500", "Artist", "Song", undefined, fetchFn);
    expect(fetchCount).toBe(2);
    expect(cache.getCached("spotify:track:500")).toBeUndefined();
  });

  test("returns null (uncached) on network error", async () => {
    let fetchCount = 0;
    const cache = new LyricsCache();
    const fetchFn = async () => { fetchCount++; throw new Error("network down"); };
    const result = await cache.fetch("spotify:track:err", "Artist", "Song", undefined, fetchFn);
    expect(result).toBeNull();
    await cache.fetch("spotify:track:err", "Artist", "Song", undefined, fetchFn);
    expect(fetchCount).toBe(2);
  });

  test("includes duration param on the /get request", async () => {
    const urls: string[] = [];
    const cache = new LyricsCache();
    const fetchFn = async (input: any) => { urls.push(String(input)); return jsonResponse(null, 404); };
    await cache.fetch("spotify:track:url", "Artist", "Song", 183000, fetchFn);
    expect(urls[0]).toContain("/get?");
    expect(urls[0]).toContain("duration=183");
  });

  test("URL-encodes artist and title", async () => {
    const urls: string[] = [];
    const cache = new LyricsCache();
    const fetchFn = async (input: any) => { urls.push(String(input)); return jsonResponse(null, 404); };
    await cache.fetch("spotify:track:enc", "Artist & Band", "Song/Remix", 10000, fetchFn);
    expect(urls[0]).toContain("artist_name=Artist+%26+Band");
    expect(urls[0]).toContain("track_name=Song%2FRemix");
  });

  test("timeout aborts and returns null without caching", async () => {
    let fetchCount = 0;
    const cache = new LyricsCache();
    const fetchFn = async (_input: any, init?: any) => {
      fetchCount++;
      await new Promise((_, reject) => {
        if (init?.signal) {
          init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }
      });
      throw new Error("should not reach");
    };
    const result = await cache.fetch("spotify:track:slow", "Artist", "Song", undefined, fetchFn, 50);
    expect(result).toBeNull();
    expect(cache.getCached("spotify:track:slow")).toBeUndefined();
    // Retry is possible after a timeout.
    await cache.fetch("spotify:track:slow", "Artist", "Song", undefined, fetchFn, 50);
    expect(fetchCount).toBe(2);
  });
});

describe("LRCLIB /api/search fallback", () => {
  /** fetchFn where /get 404s and /search returns the given items. */
  function getMissSearchHit(items: unknown[]) {
    const urls: string[] = [];
    const fetchFn = async (input: any) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/get?")) return jsonResponse(null, 404);
      return jsonResponse(items);
    };
    return { fetchFn, urls };
  }

  test("get hit never calls search", async () => {
    const urls: string[] = [];
    const cache = new LyricsCache();
    const fetchFn = async (input: any) => { urls.push(String(input)); return jsonResponse({ syncedLyrics: "[00:01.00]Hit" }); };
    const result = await cache.fetch("ytm:hit", "Artist", "Song", 200000, fetchFn);
    if (result === "none" || result === null) throw new Error("expected result");
    expect(result.synced![0]!.text).toBe("Hit");
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("/get?");
  });

  test("get 404 falls back to search and returns synced lyrics", async () => {
    const { fetchFn, urls } = getMissSearchHit([
      { syncedLyrics: "[00:01.00]FromSearch", plainLyrics: "FromSearch", duration: 261 },
    ]);
    const cache = new LyricsCache();
    const result = await cache.fetch("ytm:fallback", "Radiohead", "Karma Police", 261000, fetchFn);
    if (result === "none" || result === null) throw new Error("expected result");
    expect(result.synced![0]!.text).toBe("FromSearch");
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("/search?");
    expect(urls[1]).not.toContain("duration=");
  });

  test("search picks the synced candidate closest in duration within ±10s", async () => {
    const { fetchFn } = getMissSearchHit([
      { syncedLyrics: "[00:01.00]TooFar", duration: 300 },
      { syncedLyrics: "[00:01.00]Close", duration: 263 },
      { syncedLyrics: "[00:01.00]Closest", duration: 262 },
    ]);
    const cache = new LyricsCache();
    const result = await cache.fetch("ytm:closest", "Artist", "Song", 261000, fetchFn);
    if (result === "none" || result === null) throw new Error("expected result");
    expect(result.synced![0]!.text).toBe("Closest");
  });

  test("no candidate within the window falls back to first synced", async () => {
    const { fetchFn } = getMissSearchHit([
      { plainLyrics: "plain only", duration: 261 },
      { syncedLyrics: "[00:01.00]FirstSynced", duration: 500 },
    ]);
    const cache = new LyricsCache();
    const result = await cache.fetch("ytm:window", "Artist", "Song", 261000, fetchFn);
    if (result === "none" || result === null) throw new Error("expected result");
    expect(result.synced![0]!.text).toBe("FirstSynced");
  });

  test("plain-only search results are returned when nothing synced exists", async () => {
    const { fetchFn } = getMissSearchHit([{ plainLyrics: "words", duration: 261 }]);
    const cache = new LyricsCache();
    const result = await cache.fetch("ytm:plain", "Artist", "Song", 261000, fetchFn);
    if (result === "none" || result === null) throw new Error("expected result");
    expect(result.plain).toBe("words");
    expect(result.synced).toBeUndefined();
  });

  test("empty search results mean a definitive 'none' (cached)", async () => {
    const { fetchFn, urls } = getMissSearchHit([]);
    const cache = new LyricsCache();
    const result = await cache.fetch("ytm:empty", "Artist", "Song", 261000, fetchFn);
    expect(result).toBe("none");
    expect(cache.getCached("ytm:empty")).toBe("none");
    await cache.fetch("ytm:empty", "Artist", "Song", 261000, fetchFn);
    expect(urls).toHaveLength(2);
  });

  test("search 5xx is indeterminate — null, uncached", async () => {
    const fetchFn = async (input: any) =>
      String(input).includes("/get?") ? jsonResponse(null, 404) : jsonResponse(null, 500);
    const cache = new LyricsCache();
    const result = await cache.fetch("ytm:search500", "Artist", "Song", 261000, fetchFn);
    expect(result).toBeNull();
    expect(cache.getCached("ytm:search500")).toBeUndefined();
  });
});

describe("LyricsCache caching behavior", () => {
  test("returns cached result on second fetch for same URI", async () => {
    let fetchCount = 0;
    const cache = new LyricsCache();
    const fetchFn = async () => { fetchCount++; return jsonResponse({ syncedLyrics: "[00:01.00]A" }); };
    const r1 = await cache.fetch("spotify:track:same", "Artist", "Song", undefined, fetchFn);
    const r2 = await cache.fetch("spotify:track:same", "Artist", "Song", undefined, fetchFn);
    expect(fetchCount).toBe(1);
    if (r1 === "none" || r1 === null || r2 === "none" || r2 === null) throw new Error("expected result");
    expect(r1.synced![0]!.text).toBe("A");
    expect(r2).toBe(r1);
  });

  test("caches negative results ('none')", async () => {
    let getCount = 0;
    const cache = new LyricsCache();
    const fetchFn = async (input: any) => {
      if (String(input).includes("/get?")) getCount++;
      return jsonResponse(null, 404);
    };
    const r1 = await cache.fetch("spotify:track:none", "Artist", "Song", undefined, fetchFn);
    const r2 = await cache.fetch("spotify:track:none", "Artist", "Song", undefined, fetchFn);
    expect(getCount).toBe(1);
    expect(r1).toBe("none");
    expect(r2).toBe("none");
  });

  test("cache miss for different URIs fetches each", async () => {
    let getCount = 0;
    const cache = new LyricsCache();
    const fetchFn = async (input: any) => {
      if (String(input).includes("/get?")) getCount++;
      return jsonResponse(null, 404);
    };
    await cache.fetch("spotify:track:a", "Artist", "Song", undefined, fetchFn);
    await cache.fetch("spotify:track:b", "Artist", "Song", undefined, fetchFn);
    expect(getCount).toBe(2);
  });

  test("getCached returns cached value without fetching", async () => {
    const cache = new LyricsCache();
    const fetchFn = async () => jsonResponse({ syncedLyrics: "[00:01.00]Cached" });
    await cache.fetch("spotify:track:gc", "Artist", "Song", undefined, fetchFn);
    const cached = cache.getCached("spotify:track:gc");
    if (cached === "none" || cached === undefined) throw new Error("expected result");
    expect(cached.synced![0]!.text).toBe("Cached");
    expect(cache.getCached("spotify:track:unknown")).toBeUndefined();
  });

  test("concurrent fetches for the same URI share one request", async () => {
    let fetchCount = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const cache = new LyricsCache();
    const fetchFn = async () => {
      fetchCount++;
      await gate;
      return jsonResponse({ syncedLyrics: "[00:01.00]Shared" });
    };
    const p1 = cache.fetch("ytm:concurrent", "Artist", "Song", undefined, fetchFn);
    const p2 = cache.fetch("ytm:concurrent", "Artist", "Song", undefined, fetchFn);
    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(fetchCount).toBe(1);
    if (r1 === "none" || r1 === null) throw new Error("expected result");
    expect(r1).toBe(r2 as typeof r1);
    // The poll-driven effect re-runs must join the in-flight request, never
    // abort it — that abort chain was the original synced-lyrics bug.
  });

  test("fetching a different URI aborts the previous in-flight request", async () => {
    const cache = new LyricsCache();
    let aborted = false;
    const hangingFetch = async (_input: any, init?: any) => {
      await new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => { aborted = true; reject(new DOMException("Aborted", "AbortError")); });
      });
      throw new Error("should not reach");
    };
    const p1 = cache.fetch("ytm:old", "Artist", "OldSong", undefined, hangingFetch);
    const fastFetch = async () => jsonResponse({ syncedLyrics: "[00:01.00]New" });
    const p2 = cache.fetch("ytm:new", "Artist", "NewSong", undefined, fastFetch);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(aborted).toBe(true);
    expect(r1).toBeNull();
    expect(cache.getCached("ytm:old")).toBeUndefined();
    if (r2 === "none" || r2 === null) throw new Error("expected result");
    expect(r2.synced![0]!.text).toBe("New");
  });

  test("cancelInFlight aborts pending request; result is null, uncached", async () => {
    const cache = new LyricsCache();
    let aborted = false;
    const fetchFn = async (_input: any, init?: any) => {
      await new Promise((_, reject) => {
        if (init?.signal) {
          init.signal.addEventListener("abort", () => { aborted = true; reject(new DOMException("Aborted", "AbortError")); });
        }
      });
      throw new Error("should not reach");
    };
    const promise = cache.fetch("spotify:track:cancel", "Artist", "Song", undefined, fetchFn);
    cache.cancelInFlight();
    const result = await promise;
    expect(result).toBeNull();
    expect(aborted).toBe(true);
    expect(cache.getCached("spotify:track:cancel")).toBeUndefined();
  });

  test("clear empties cache and cancels in-flight", async () => {
    const cache = new LyricsCache();
    const fetchFn = async () => jsonResponse({ syncedLyrics: "[00:01.00]X" });
    await cache.fetch("spotify:track:clr", "Artist", "Song", undefined, fetchFn);
    cache.clear();
    expect(cache.getCached("spotify:track:clr")).toBeUndefined();
  });
});
