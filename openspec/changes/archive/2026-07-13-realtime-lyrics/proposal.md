## Why

The TUI shows what's playing but not what's being sung. Synced (karaoke-style) lyrics are a high-value companion to playback, and all the plumbing already exists: the app polls `positionMs`/`durationMs` every 1.5s for all three backends, and `Track` carries `artist`/`title`/`durationMs` — exactly the key needed to look lyrics up.

## What Changes

- New `src/lyrics/` module: LRCLIB client (`lrclib.net` — free, no auth, works for every music backend) + LRC format parser (`[mm:ss.xx] line`).
- Realtime line highlighting: interpolate playback position between 1.5s polls with a local ~250ms tick (`anchor.positionMs + (now - anchor.wallClock)` while playing); each poll re-anchors, so network drift self-corrects.
- `/lyrics` slash command toggles a full-screen scrollable lyrics view (like `HistoryScreen`); a compact 3-line panel (prev / **current** / next) renders above the now-playing footer while lyrics are enabled and the terminal is tall enough.
- Per-track in-memory cache including negative results ("no lyrics found" is remembered — LRCLIB is hit once per track, not per poll).
- Spotify `getCurrentlyPlaying` payload extended with `item.name` / `item.artists` (already present in the API response, currently discarded) so lyrics work for tracks started outside the app, when `remoteTrack` is null.
- Plain-lyrics fallback when LRCLIB has text but no sync timestamps (static scroll, no highlighting).
- Graceful absence: no lyrics → panel hidden / screen says "no lyrics for this track"; feature is "where available" by design.

## Capabilities

### New Capabilities
- `synced-lyrics`: fetching, caching, parsing, and time-synced display of lyrics for the currently playing track across all music backends.

### Modified Capabilities
- `responsive-tui-layout`: layout budget gains a lyrics-panel flag; degradation order must define when the lyrics panel collapses (before the logo — it's decorative-adjacent, functional rows survive longer).

## Impact

- **New code**: `src/lyrics/client.ts` (LRCLIB fetch + cache), `src/lyrics/lrc.ts` (parser + current-line binary search), `src/ui/LyricsScreen.tsx`, compact panel in `app.tsx`.
- **Modified**: `src/spotify/client.ts` (`getCurrentlyPlaying` returns track title/artist), `src/ui/layout.ts` (`LayoutFlags.lyricsPanel` + budget rows), `src/ui/SlashMenu.tsx` (`/lyrics`), `src/app.tsx` (poll anchor state, tick, screen routing).
- **Dependencies**: none added — LRCLIB is plain `fetch`.
- **Network**: one HTTPS GET to `lrclib.net` per unique track.
- **No breaking changes.**
