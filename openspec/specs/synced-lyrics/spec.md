## Purpose

Fetch, cache, parse, and display synced (LRC) lyrics for the currently playing track from LRCLIB, across all music backends. No new dependencies or auth surfaces.

## Requirements

### Requirement: Lyrics are fetched from LRCLIB for the currently playing track

When lyrics mode is enabled and the currently playing track changes, the system SHALL request lyrics from LRCLIB (`/api/get`) using the track's artist, title, and duration, on every music backend (Spotify, YouTube Music, SoundCloud). The system MUST NOT add any authentication surface or npm dependency for this.

#### Scenario: Track with synced lyrics
- **WHEN** a track plays whose artist/title/duration matches an LRCLIB entry with `syncedLyrics`
- **THEN** the parsed synced lyrics become available to the display surfaces within one fetch round-trip

#### Scenario: Track without lyrics
- **WHEN** a track plays that has no LRCLIB entry
- **THEN** the system records "no lyrics" for that track without surfacing an error, and playback UI is unaffected

#### Scenario: LRCLIB unreachable
- **WHEN** the LRCLIB request fails or exceeds its timeout
- **THEN** the track is treated as having no lyrics and playback continues undisturbed

### Requirement: Lyrics responses are cached per track including negative results

The system SHALL cache lyrics lookups in memory keyed by track URI, including misses, so that LRCLIB is queried at most once per unique track per app run and never on every poll cycle.

#### Scenario: Same track polled repeatedly
- **WHEN** the playback poll reports the same track URI for many consecutive cycles
- **THEN** exactly one LRCLIB request is made for that track

#### Scenario: Track changes before the fetch completes
- **WHEN** the playing track changes while a lyrics request is still in flight
- **THEN** the stale request is aborted and its result is never displayed for the new track

### Requirement: Current lyric line tracks playback position in realtime

While synced lyrics are displayed and playback is active, the system SHALL determine the current line by interpolating the playback position between polls (last polled position plus wall-clock elapsed time), re-anchoring on every poll, with a display update interval of at most 500 ms.

#### Scenario: Line advances between polls
- **WHEN** the next LRC timestamp falls between two 1.5 s playback polls
- **THEN** the highlighted line advances at the interpolated moment, not at the next poll

#### Scenario: Paused playback freezes the line
- **WHEN** playback is paused
- **THEN** the current line stops advancing until playback resumes

#### Scenario: Seek re-synchronizes
- **WHEN** the user seeks or the reported position jumps
- **THEN** the highlighted line matches the new position after the next poll re-anchors

### Requirement: Lyrics display is toggled by a /lyrics slash command

The system SHALL provide a `/lyrics` slash command that enables lyrics mode. While enabled with a synced-lyrics track playing, a compact panel SHALL show the previous, current (highlighted), and next lines; a full-screen lyrics view SHALL show the lyric sheet with the current line highlighted. Lyric lines SHALL be horizontally centered on both surfaces. Lyrics mode SHALL be off by default and nothing SHALL be sent to LRCLIB while it is off.

#### Scenario: Enabling lyrics during playback
- **WHEN** the user runs `/lyrics` while a track with synced lyrics is playing
- **THEN** the compact panel appears showing the current line highlighted and horizontally centered

#### Scenario: Lyrics mode off means no network traffic
- **WHEN** lyrics mode has never been enabled in the session
- **THEN** no request is ever made to LRCLIB

#### Scenario: Plain-only lyrics
- **WHEN** LRCLIB returns only `plainLyrics` (no sync timestamps) for the playing track
- **THEN** the compact panel stays hidden and the full-screen view shows the static text marked as not synced, horizontally centered

### Requirement: Full-screen lyrics use a karaoke scroll pinned to the viewport

The full-screen lyrics view SHALL fit within the available terminal height, showing a window of lyric lines whose size derives from the centralized layout budget. The current line SHALL stay vertically pinned to the middle of that window, the window advancing exactly one line per lyric-line change, except near the start and end of the sheet where the window clamps to the sheet's bounds.

#### Scenario: Mid-song line advance scrolls, not jumps
- **WHEN** the current synced line advances while lines remain both above and below the visible window
- **THEN** the window shifts by exactly one line and the highlighted line stays on the same terminal row

#### Scenario: Sheet start and end clamp the window
- **WHEN** the current line is within the first or last half-window of the sheet
- **THEN** the window clamps to the sheet boundary and the highlighted line moves within the window instead of the sheet scrolling past its edges

#### Scenario: Long song never overflows the terminal
- **WHEN** a track's lyric sheet has more lines than the available terminal height
- **THEN** the full-screen view renders only the budgeted window and nothing paints past the bottom edge of the terminal

#### Scenario: Full-screen view replaces the main stack
- **WHEN** the full-screen lyrics view is open
- **THEN** the results list and prompt input are not rendered beneath it, and the player footer and status bar remain visible

### Requirement: Displayed lyrics always belong to the currently playing track

The system SHALL only display lyrics that were fetched for the currently playing track URI. When the playing track changes, previously displayed lyrics MUST be cleared immediately — before the new track's metadata arrives and before its lyrics fetch completes — and MUST NOT be re-highlighted or scrolled against the new track's playback position.

#### Scenario: Track advances to the next song
- **WHEN** playback moves from track A to track B while lyrics mode is on
- **THEN** track A's lyrics disappear from the panel on the next poll that reports track B's URI, and the panel shows a loading state until track B's lyrics resolve

#### Scenario: New track metadata lags behind the URI change
- **WHEN** the poll reports track B's URI but track B's artist/title metadata is not yet available
- **THEN** the panel shows a loading state, not track A's lyrics

#### Scenario: New track has cached lyrics
- **WHEN** playback changes to a track whose lyrics are already in the in-memory cache
- **THEN** that track's cached lyrics are displayed immediately without an intermediate flash of the previous track's lyrics

### Requirement: Spotify playback state includes track metadata for lyrics lookup

The Spotify `getCurrentlyPlaying` client method SHALL expose the playing item's title and artist from the `/me/player` response so lyrics lookup works for tracks started outside the app.

#### Scenario: Track started from another device
- **WHEN** playback was initiated in the Spotify app on another device and lyrics mode is enabled
- **THEN** the poll supplies enough metadata (title, artist, duration) to perform the LRCLIB lookup
