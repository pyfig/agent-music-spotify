# Proposal: fix-lyrics-stale-on-track-change

## Why

When playback advances to a new track, the lyrics panel keeps showing (and scrolling through) the previous track's lyrics. The fetch effect in `useLyrics` returns early when the new track's metadata has not caught up yet (`meta.uri !== currentlyPlayingUri`, or artist/title still empty) and never clears the stale `lyricsData`, so the old song's lines are re-highlighted against the new track's playback anchor until — and only if — a new fetch completes.

## What Changes

- `useLyrics` clears displayed lyrics immediately when `currentlyPlayingUri` changes to a track whose lyrics are not the ones currently held, instead of leaving the previous track's lyrics on screen.
- While a new track's lyrics are being fetched (or its metadata is still propagating), the lyrics panel shows a loading state, never the previous track's content.
- Cached lyrics for the new track still render immediately with no flicker (cache-hit path unchanged in behavior).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `synced-lyrics`: New requirement — lyrics shown always belong to the currently playing track; on track change the display resets rather than carrying over the previous track's lyrics.

## Impact

- `src/hooks/useLyrics.ts` — fetch effect: track which URI the held `lyricsData` belongs to; reset state when the playing URI diverges.
- `src/hooks/useLyrics.test.*` (or new test) — regression coverage for the stale-lyrics-on-track-change path.
- No API, config, or dependency changes. `src/app.tsx` wiring and `LyricsScreen` untouched.
