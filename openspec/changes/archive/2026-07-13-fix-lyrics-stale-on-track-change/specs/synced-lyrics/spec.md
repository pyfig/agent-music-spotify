# Delta: synced-lyrics — fix-lyrics-stale-on-track-change

## ADDED Requirements

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
