import { test, expect } from "bun:test";
import { withTimeout } from "../src/core/generate-playlist";

// Regression: a backend searchTrack that never settles (e.g. ytmusic-api with
// no timeout of its own) used to stall the worker pool forever — resolving
// progress froze one short of total (25/26). withTimeout bounds each search.

test("rejects a hung promise after the budget", async () => {
  const hung = new Promise<never>(() => {}); // never settles
  const start = Date.now();
  let err: unknown;
  try {
    await withTimeout(hung, 30, "track");
  } catch (e) {
    err = e;
  }
  expect((err as Error)?.message).toMatch(/timed out/);
  expect(Date.now() - start).toBeLessThan(500);
});

test("passes through a promise that settles in time", async () => {
  const v = await withTimeout(Promise.resolve("ok"), 100, "track");
  expect(v).toBe("ok");
});

test("timeout message is not classified as a network error", () => {
  // Mirror of the classifier in resolvePlaylist's worker. A timeout must fall
  // through to `null` (track unresolved), not rethrow and fail the playlist.
  const NETWORK = /\b(401|403|429)\b|\b5\d\d\b|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed/i;
  const msg = "track search timed out after 15000ms";
  expect(NETWORK.test(msg)).toBe(false);
});
