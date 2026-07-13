## ADDED Requirements

### Requirement: Distinct spinner during the thinking phase
The UI SHALL render a dedicated thinking-spinner frame set — visually distinct from the braille `SPINNER` — whenever the agent progress phase is `thinking`. The frame set SHALL live in `src/ui/theme.ts` alongside `SPINNER` and be driven by the existing shared `spinnerFrame` counter.

#### Scenario: StatusBar during thinking
- **WHEN** generation is in the `thinking` phase
- **THEN** the StatusBar right cluster shows a thinking-spinner frame, not a braille frame

#### Scenario: StatusBar during resolving
- **WHEN** generation is in the `resolving` phase
- **THEN** the StatusBar right cluster shows the braille `SPINNER` frame as before

#### Scenario: ReasoningTranscript header
- **WHEN** the reasoning transcript is visible while the agent is generating
- **THEN** its header glyph animates with the thinking-spinner frame set

### Requirement: Thinking spinner must not break row layout
Every frame of the thinking spinner SHALL occupy the same printable cell width, and the StatusBar right-cluster width reservation MUST accommodate the widest frame so the row never hard-clips or shifts as frames advance.

#### Scenario: Frame advance keeps row stable
- **WHEN** the spinner advances through all of its frames on a narrow (40-column content) terminal
- **THEN** the StatusBar renders without clipping and the left cluster does not shift horizontally
