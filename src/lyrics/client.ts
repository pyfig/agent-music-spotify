import { parseLrc, type LrcLine } from "./lrc";

export interface LyricsResult {
  synced?: LrcLine[];
  plain?: string;
}

type FetchFn = (input: any, init?: RequestInit) => Promise<Response>;

const LRCLIB_BASE = "https://lrclib.net/api";
// LRCLIB can take 7–12s to answer from some networks; a 5s budget turned every
// lookup into a cached permanent miss. Same generosity as SEARCH_TIMEOUT_MS.
const FETCH_TIMEOUT_MS = 15_000;
// /api/search fallback: accept a candidate only if its duration is this close
// to the playing track (else the first synced candidate wins regardless).
const SEARCH_DURATION_WINDOW_S = 10;

interface LrclibResponse {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
}

interface LrclibSearchItem extends LrclibResponse {
  duration?: number | null;
}

function toResult(data: LrclibResponse): LyricsResult | "none" {
  const synced = data.syncedLyrics?.trim();
  const plain = data.plainLyrics?.trim();
  if (!synced && !plain) return "none";
  return {
    synced: synced ? parseLrc(synced) : undefined,
    plain: plain ?? undefined,
  };
}

/**
 * Definitive-404 fallback: /api/get requires an exact artist+title+duration
 * match; /api/search tolerates duration/title variants (YouTube streams).
 * Prefers the synced candidate closest in duration to the playing track.
 */
async function searchLrclib(
  artist: string,
  title: string,
  durationMs: number | undefined,
  signal: AbortSignal,
  fetchFn: FetchFn,
): Promise<LyricsResult | "none" | null> {
  const params = new URLSearchParams({ artist_name: artist, track_name: title });
  const res = await fetchFn(`${LRCLIB_BASE}/search?${params}`, { signal });
  if (res.status === 404) return "none";
  if (!res.ok) return null;
  const items = (await res.json()) as LrclibSearchItem[];
  if (!Array.isArray(items) || items.length === 0) return "none";

  const wantSec = typeof durationMs === "number" && durationMs > 0 ? durationMs / 1000 : null;
  const synced = items.filter((it) => it.syncedLyrics?.trim());
  let pick: LrclibSearchItem | undefined;
  if (wantSec !== null) {
    pick = synced
      .filter((it) => typeof it.duration === "number" && Math.abs(it.duration - wantSec) <= SEARCH_DURATION_WINDOW_S)
      .sort((a, b) => Math.abs(a.duration! - wantSec) - Math.abs(b.duration! - wantSec))[0];
  }
  pick ??= synced[0] ?? items.find((it) => it.plainLyrics?.trim());
  return pick ? toResult(pick) : "none";
}

/**
 * Returns the lyrics, "none" for a definitive miss (LRCLIB has no entry), or
 * null when the outcome is indeterminate (timeout/abort/network/5xx) — null
 * must NOT be cached so a later attempt can retry.
 */
async function fetchFromLrclib(
  artist: string,
  title: string,
  durationMs?: number,
  signal?: AbortSignal,
  fetchFn: FetchFn = globalThis.fetch,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<LyricsResult | "none" | null> {
  const params = new URLSearchParams({
    artist_name: artist,
    track_name: title,
  });
  if (typeof durationMs === "number" && durationMs > 0) {
    params.set("duration", String(Math.round(durationMs / 1000)));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const combinedSignal = signal
    ? combineAbortSignals(signal, controller.signal)
    : controller.signal;

  try {
    const res = await fetchFn(`${LRCLIB_BASE}/get?${params}`, {
      signal: combinedSignal,
    });
    if (res.status === 404) {
      return await searchLrclib(artist, title, durationMs, combinedSignal, fetchFn);
    }
    if (!res.ok) return null;
    const data = (await res.json()) as LrclibResponse;
    return toResult(data);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      return controller.signal;
    }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

export class LyricsCache {
  private cache = new Map<string, LyricsResult | "none">();
  private inflight = new Map<string, Promise<LyricsResult | "none" | null>>();
  private abortController: AbortController | null = null;

  getCached(uri: string): LyricsResult | "none" | undefined {
    return this.cache.get(uri);
  }

  cancelInFlight(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Resolves to lyrics, "none" (definitive miss, cached), or null
   * (indeterminate — timeout/abort/network — deliberately NOT cached so the
   * caller's next attempt retries). A second fetch for the same URI while one
   * is in flight joins it; only a different-URI fetch aborts the previous one.
   * The playback poll re-runs the lyrics effect every 1.5s, so without the
   * join, any request slower than the poll period would abort itself forever.
   */
  fetch(
    uri: string,
    artist: string,
    title: string,
    durationMs?: number,
    fetchFn?: FetchFn,
    timeoutMs?: number,
  ): Promise<LyricsResult | "none" | null> {
    const cached = this.cache.get(uri);
    if (cached !== undefined) return Promise.resolve(cached);

    const pending = this.inflight.get(uri);
    if (pending) return pending;

    this.cancelInFlight();
    const controller = new AbortController();
    this.abortController = controller;

    const promise = fetchFromLrclib(artist, title, durationMs, controller.signal, fetchFn, timeoutMs)
      .then((result) => {
        if (result !== null) this.cache.set(uri, result);
        return result;
      })
      .finally(() => {
        this.inflight.delete(uri);
        if (this.abortController === controller) this.abortController = null;
      });
    this.inflight.set(uri, promise);
    return promise;
  }

  clear(): void {
    this.cancelInFlight();
    this.inflight.clear();
    this.cache.clear();
  }
}

export type { LrcLine };
