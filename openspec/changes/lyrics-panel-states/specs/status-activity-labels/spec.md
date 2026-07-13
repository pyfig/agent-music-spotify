## ADDED Requirements

### Requirement: Status bar names the specific activity in progress

The status bar SHALL never display a bare generic activity label such as `generating…`. While work is in progress, the displayed label SHALL name the concrete activity: playlist generation SHALL be labeled as generating a playlist, and phase-specific progress labels (thinking verbs, `tool: <name>`, `resolving [bar] n/m`, `creating playlist`, `adding tracks`) SHALL continue to be shown during their respective phases.

#### Scenario: Loading branch shows a concrete label
- **WHEN** the agent is generating and the status bar renders its loading label outside the phase-progress cluster
- **THEN** the label reads "generating playlist…" (or an equally specific activity name), not "generating…"

#### Scenario: Phase labels are preserved
- **WHEN** generation is in the resolving phase
- **THEN** the status bar shows the resolving progress bar with counts, unchanged by this change

### Requirement: Lyrics fetch activity is reported by the lyrics panel, not the status bar

Lyrics loading SHALL be communicated exclusively by the lyrics panel's loading state. The status bar MUST NOT add or change labels in response to a background lyrics fetch.

#### Scenario: Lyrics fetch during idle status bar
- **WHEN** a lyrics lookup is in flight while no playlist generation is running
- **THEN** the status bar remains in its idle presentation and the lyrics panel shows the loading message
