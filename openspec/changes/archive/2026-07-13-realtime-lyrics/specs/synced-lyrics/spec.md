## ADDED Requirements

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
The system SHALL provide a `/lyrics` slash command that enables lyrics mode. While enabled with a synced-lyrics track playing, a compact panel SHALL show the previous, current (highlighted), and next lines; a full-screen lyrics view SHALL show the entire sheet auto-following the current line. Lyrics mode SHALL be off by default and nothing SHALL be sent to LRCLIB while it is off.

#### Scenario: Enabling lyrics during playback
- **WHEN** the user runs `/lyrics` while a track with synced lyrics is playing
- **THEN** the compact panel appears showing the current line highlighted

#### Scenario: Lyrics mode off means no network traffic
- **WHEN** lyrics mode has never been enabled in the session
- **THEN** no request is ever made to LRCLIB

#### Scenario: Plain-only lyrics
- **WHEN** LRCLIB returns only `plainLyrics` (no sync timestamps) for the playing track
- **THEN** the compact panel stays hidden and the full-screen view shows the static text marked as not synced

### Requirement: Spotify playback state includes track metadata for lyrics lookup
The Spotify `getCurrentlyPlaying` client method SHALL expose the playing item's title and artist from the `/me/player` response so lyrics lookup works for tracks started outside the app.

#### Scenario: Track started from another device
- **WHEN** playback was initiated in the Spotify app on another device and lyrics mode is enabled
- **THEN** the poll supplies enough metadata (title, artist, duration) to perform the LRCLIB lookup
