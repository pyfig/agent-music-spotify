## ADDED Requirements

### Requirement: Lyrics panel communicates its state explicitly

While lyrics mode is enabled, the compact lyrics panel SHALL always be rendered (subject only to the layout degradation order and full-screen overlays) and SHALL display an explicit textual state whenever synced lines are not being shown: waiting for playback, loading lyrics, no synchronized lyrics available, or failed to load lyrics. The panel SHALL keep a constant height across all states and SHALL be visually separated from the results list so lyric text and track rows cannot be confused.

#### Scenario: Lyrics mode on with nothing playing
- **WHEN** lyrics mode is enabled and no track is playing
- **THEN** the panel is visible and shows a "waiting for playback" message

#### Scenario: Lookup in progress
- **WHEN** a track is playing, lyrics mode is on, and the LRCLIB lookup for that track has not yet resolved (including while track metadata is still arriving)
- **THEN** the panel shows a "loading lyrics" message

#### Scenario: Track has no synchronized lyrics
- **WHEN** the lookup resolves with no synced lyrics for the playing track
- **THEN** the panel shows a "no synchronized lyrics available" message instead of disappearing

#### Scenario: Lookup failed
- **WHEN** the lookup for the playing track failed (network error, timeout, or non-404 HTTP error)
- **THEN** the panel shows a "failed to load lyrics" message, distinct from the no-lyrics message

#### Scenario: Lyrics disabled
- **WHEN** lyrics mode is off
- **THEN** no lyrics panel is rendered at all

#### Scenario: Panel height is stable across states
- **WHEN** the panel transitions between loading, found, and no-lyrics states
- **THEN** the panel occupies the same number of rows in every state and surrounding layout does not shift

## MODIFIED Requirements

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
- **THEN** the outcome is reported to the display surfaces as "lyrics fetch failed" — distinct from "no lyrics" — the failure is not cached (a later attempt may retry), and playback continues undisturbed

### Requirement: Lyrics display is toggled by a /lyrics slash command

The system SHALL provide a `/lyrics` slash command that enables lyrics mode. While enabled, a compact panel SHALL be persistently rendered showing either the previous, current (highlighted), and next synced lines, or an explicit state message when synced lines are unavailable; a full-screen lyrics view SHALL show the lyric sheet with the current line highlighted. Lyric lines SHALL be horizontally centered on both surfaces. Lyrics mode SHALL be off by default and nothing SHALL be sent to LRCLIB while it is off.

#### Scenario: Enabling lyrics during playback
- **WHEN** the user runs `/lyrics` while a track with synced lyrics is playing
- **THEN** the compact panel appears showing the current line highlighted and horizontally centered

#### Scenario: Enabling lyrics with nothing playing
- **WHEN** the user runs `/lyrics` while nothing is playing
- **THEN** the compact panel appears immediately with its waiting-for-playback message, confirming lyrics mode is on

#### Scenario: Lyrics mode off means no network traffic
- **WHEN** lyrics mode has never been enabled in the session
- **THEN** no request is ever made to LRCLIB

#### Scenario: Plain-only lyrics
- **WHEN** LRCLIB returns only `plainLyrics` (no sync timestamps) for the playing track
- **THEN** the compact panel shows its no-synchronized-lyrics message and the full-screen view shows the static text marked as not synced, horizontally centered
