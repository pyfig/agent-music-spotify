# Design: fix-lyrics-stale-on-track-change

## Context

`useLyrics` (`src/hooks/useLyrics.ts`) holds `lyricsData` state and re-fetches in an effect keyed on `[lyricsMode, currentlyPlayingUri, currentTrackMeta]`. On track change the effect can hit two early returns that leave the previous track's `lyricsData` in place:

1. `meta.uri !== currentlyPlayingUri || !meta.artist || !meta.title` (line 48) — metadata for the new URI has not propagated yet (common on the mpv/YouTube Music backend where title/artist can lag the URI by a poll cycle or more). The effect returns without touching `lyricsData`.
2. Even on the happy path, the fetch branch (line 60) does not clear `lyricsData` before awaiting LRCLIB, so the old track's lyrics stay visible for the duration of the network call.

Meanwhile the interpolation effect keeps highlighting lines of the *old* synced lyrics against the *new* track's playback anchor — the user sees the previous song's lyrics "replay".

The hook never records which URI the held `lyricsData` was fetched for, so it cannot tell "stale" from "current".

## Goals / Non-Goals

**Goals:**
- Lyrics on screen always correspond to `currentlyPlayingUri`.
- Track change clears the panel to a loading state immediately; cache hits still render synchronously with no flicker.
- Regression test for the metadata-lag path.

**Non-Goals:**
- No changes to `LyricsCache`, LRCLIB client, retry behavior, or `LyricsScreen` rendering.
- No changes to the interpolation tick logic (it self-corrects once `lyricsData` is cleared/replaced).
- No prefetching of the next track's lyrics.

## Decisions

**Track ownership of `lyricsData` with a `loadedUriRef`.** Add `const loadedUriRef = useRef<string | null>(null)` recording which URI the current `lyricsData` belongs to. At the top of the fetch effect (before the metadata early-return), if `currentlyPlayingUri !== loadedUriRef.current`, call `setLyricsData(null)` and reset the ref. Set the ref when data is committed (cache hit or fetch resolution). The cancelled-fetch guard already prevents a stale fetch from committing after another track change.

*Alternative considered:* keying state as `{ uri, data }` and deriving display via `data.uri === currentlyPlayingUri`. Works, but forces every consumer (`app.tsx`, `LyricsScreen`) to change shape; the ref keeps the hook's public API identical.

*Alternative considered:* clearing unconditionally at effect start. Causes a `null` flash on every re-run (including cache hits and mode toggles) — violates the no-flicker goal.

**Loading state remains `lyricsData === null`.** The hook already uses `null` for "nothing yet"; `LyricsScreen` already renders a loading/empty presentation for it. No new state values.

## Risks / Trade-offs

- [Ref + state can desync if a future edit sets one without the other] → keep both mutations adjacent in a single helper path inside the effect; regression test locks the behavior.
- [Setting state during the effect's early-return path triggers one extra render on track change] → negligible; happens once per track transition.

## Open Questions

None.
