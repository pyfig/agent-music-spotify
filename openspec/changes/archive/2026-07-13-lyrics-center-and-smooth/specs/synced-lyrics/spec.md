## MODIFIED Requirements

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

## ADDED Requirements

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
