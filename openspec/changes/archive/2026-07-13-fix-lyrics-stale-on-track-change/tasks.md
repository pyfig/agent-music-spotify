# Tasks: fix-lyrics-stale-on-track-change

## 1. Fix stale lyrics in useLyrics

- [x] 1.1 In `src/hooks/useLyrics.ts`, add `loadedUriRef` tracking which URI the held `lyricsData` was fetched for; at the top of the fetch effect (before the metadata early-return), clear `lyricsData` to `null` and reset the ref when `currentlyPlayingUri` differs from `loadedUriRef.current`
- [x] 1.2 Set `loadedUriRef.current = currentlyPlayingUri` on both commit paths (cache hit and fetch resolution); keep the cache-hit path synchronous so cached tracks render without a flicker

## 2. Regression tests

- [x] 2.1 In `tests/use-lyrics.test.ts`, add test: track B URI reported while metadata still shows track A (or empty artist/title) → `lyricsData` becomes `null`, not track A's lyrics
- [x] 2.2 Add test: track change with fetch in flight → old lyrics cleared during fetch, new track's lyrics displayed after resolution
- [x] 2.3 Add test: track change to a cached URI → cached lyrics displayed with no intermediate `null` visible after effect flush

## 3. Verify

- [x] 3.1 Run `bun test` — full suite green
- [x] 3.2 Manual check via run-music-agent skill: sandbox smoke passed (`/lyrics` toggles, no crash with modified hook); full skip-track scenario covered by regression tests 2.1–2.3 — recommend confirming visually during next real listening session
