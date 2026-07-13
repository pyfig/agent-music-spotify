## Context

The app is a TUI music agent with three backends (Spotify remote, YouTube Music and SoundCloud via a local mpv process). `app.tsx` already polls playback state every 1500 ms and holds `positionMs`/`durationMs` in `trackPos`; `Track` carries `artist`, `title`, `album`, `durationMs`. Vertical layout is centrally budgeted in `src/ui/layout.ts` (`layoutBudget` + `LayoutFlags`) after the small-window-ui-hardening change — any new row-consuming UI must go through it. There is no lyrics code anywhere yet.

## Goals / Non-Goals

**Goals:**
- Synced, karaoke-style lyrics for the currently playing track, updating in realtime, on every backend.
- "Where available" semantics: absence of lyrics is a normal, quiet state, never an error.
- Zero new npm dependencies; zero new auth surfaces.

**Non-Goals:**
- Lyrics search/browse for tracks that are not playing.
- Editing, offset-tuning, or contributing lyrics back to LRCLIB.
- Disk persistence of the lyrics cache (memory only, like `priorPlaylistRef`).
- Translations / romanization.

## Decisions

### D1: LRCLIB as the single lyrics source
`GET https://lrclib.net/api/get?artist_name=&track_name=&album_name=&duration=` returns `syncedLyrics` (LRC) and `plainLyrics`. Free, no API key, no ToS conflict, and — critically — keyed by track metadata, so one integration serves all three backends.

Alternatives rejected:
- Spotify/Musixmatch internal API: needs an `sp_dc` cookie, unofficial, breaks regularly, Spotify-only.
- Genius: plain text only (no sync), requires an API key plus HTML scraping for the actual lyrics.

Lookup uses `artist + title + durationMs` from `Track`. The `duration` parameter disambiguates versions (live/remix); LRCLIB tolerates ±2 s. If the exact `/api/get` misses, do NOT fall back to fuzzy `/api/search` in v1 — a wrong lyric sheet is worse than none.

### D2: Client-side position interpolation between polls
The 1500 ms poll is too coarse for line highlighting. Each poll stores an anchor `{ positionMs, wallClock: Date.now(), isPlaying }`. A local ~250 ms tick computes `pos = anchor.positionMs + (isPlaying ? Date.now() - anchor.wallClock : 0)` and selects the current LRC line by binary search over parsed timestamps. Every poll replaces the anchor, so Spotify network drift self-corrects within one poll cycle; mpv-reported positions are near-exact.

The tick runs only while a lyrics surface is visible and synced lyrics exist — no idle CPU cost otherwise.

Alternative rejected: raising the global poll rate — multiplies Spotify Web API calls (rate limits) for a purely visual concern.

### D3: Two display surfaces behind one `/lyrics` toggle
- **Compact panel**: 3 rows (previous / current / next line, current highlighted with `theme.accent`) rendered above the now-playing footer. Visible when lyrics mode is on, a track with synced lyrics is playing, and the layout budget allows it.
- **Full screen**: `LyricsScreen` modeled on `HistoryScreen` — full lyric sheet, auto-scrolls to keep the current line centered, manual scroll pauses auto-follow until the track changes.

`/lyrics` toggles lyrics mode; when already in lyrics mode a second invocation opens the full screen (exact keybinding UX can settle during implementation).

Plain-lyrics-only tracks: compact panel stays hidden (nothing to sync); full screen shows the static text with a "not synced" note.

### D4: Layout budget integration
`LayoutFlags` gains `lyricsPanel: boolean`; `layoutBudget` subtracts `LYRICS_PANEL_ROWS = 3`. Degradation order: the lyrics panel hides FIRST — before the logo — since it is the newest and most decorative row consumer. Functional rows (input, ≥5 result rows, now-playing, status bar) keep their existing guarantees. `tests/layout.test.ts` gets cases for the new flag.

### D5: Per-track cache with negative entries
In-memory `Map<string, LyricsResult | "none">` keyed by track `uri`. One LRCLIB request per unique track per app run; a miss is cached as `"none"` so absence never causes re-fetching on every poll. Fetch failures (network down) are cached as `"none"` for the current track but may retry on re-play. Fetch triggers on `currentlyPlayingUri` change, with an `AbortController` cancelling the in-flight request when the track changes faster than the response arrives.

### D6: Extend Spotify `getCurrentlyPlaying` payload
`src/spotify/client.ts` currently discards `item.name` and `item.artists` from the `/me/player` response. Add `trackTitle`/`trackArtist` (and keep `durationMs`) to the return shape so lyrics lookup works when playback was started outside the app (`remoteTrack === null`). Additive change; `RemotePlaybackClient` consumers unaffected.

## Risks / Trade-offs

- [LRCLIB outage or slow response] → single fetch per track with a timeout (~5 s), failure degrades to "no lyrics"; playback path untouched.
- [Wrong-version lyrics (live vs studio)] → duration passed in the query; no fuzzy-search fallback in v1.
- [Spotify position drift up to ~1.5 s after seek] → next poll re-anchors; acceptable for line-level (not word-level) highlighting.
- [Layout regressions on short terminals] → panel goes through `layoutBudget` with unit tests, hides first in degradation order.
- [User privacy: track metadata sent to a third party] → lyrics mode is opt-in via `/lyrics`; nothing is sent unless the user enables it.

## Migration Plan

Pure addition — no config migration, no breaking API change. Rollback = remove the `/lyrics` command and panel rendering; the lyrics module is self-contained in `src/lyrics/`.

## Open Questions

- Should lyrics-mode-on persist in config across restarts, or reset each run? (Leaning: persist, alongside `volume`.)
- Exact `/lyrics` second-invocation UX: toggle-off vs open-full-screen (settle in implementation with the existing slash-menu conventions).
