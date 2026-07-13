## 1. Lyrics module (src/lyrics/)

- [x] 1.1 `src/lyrics/lrc.ts`: LRC parser (`[mm:ss.xx] line` → `{ timeMs, text }[]`, tolerant of repeated timestamps and metadata tags) + `currentLineIndex(lines, positionMs)` binary search; unit tests in `tests/lrc.test.ts`
- [x] 1.2 `src/lyrics/client.ts`: LRCLIB `/api/get` fetch by artist/title/duration with ~5 s timeout, `AbortController` support, result type `{ synced?: LrcLine[]; plain?: string } | "none"`; unit tests with injected fetch
- [x] 1.3 In-memory per-URI cache with negative entries and in-flight request cancellation on track change

## 2. Spotify metadata

- [x] 2.1 Extend `SpotifyClient.getCurrentlyPlaying` (`src/spotify/client.ts`) to return `trackTitle`/`trackArtist` from `item.name`/`item.artists`; keep `RemotePlaybackClient` compatibility

## 3. Layout budget

- [x] 3.1 Add `lyricsPanel` flag to `LayoutFlags`, `LYRICS_PANEL_ROWS = 3` to `layoutBudget`, degradation: lyrics panel hides before logo (`src/ui/layout.ts`)
- [x] 3.2 Extend `tests/layout.test.ts`: panel consumes rows when flagged, hides first on short terminals, functional-row guarantees hold at height ≥ 12

## 4. App wiring (realtime sync)

- [x] 4.1 Poll anchor state in `app.tsx`: store `{ positionMs, wallClock, isPlaying }` on every poll; ~250 ms tick computes interpolated position only while lyrics visible and synced lyrics exist
- [x] 4.2 Lyrics fetch on `currentlyPlayingUri` change (only when lyrics mode on), sourcing metadata from local `Track` or extended Spotify payload
- [x] 4.3 `/lyrics` slash command in `src/ui/SlashMenu.tsx` + lyrics-mode state; decide and implement second-invocation UX (toggle-off vs full screen)

## 5. Display surfaces

- [x] 5.1 Compact 3-row panel above now-playing footer: prev / current (accent-highlighted) / next line; hidden when no synced lyrics or budget disallows
- [x] 5.2 `src/ui/LyricsScreen.tsx` full-screen view modeled on `HistoryScreen`: full sheet, auto-follow current line centered, manual scroll pauses auto-follow until track change; plain-only lyrics render static with "not synced" note

## 6. Verification

- [x] 6.1 `bun test` green (332 pass); `tsc --noEmit` clean; manual check on backends
