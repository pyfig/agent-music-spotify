## ADDED Requirements

### Requirement: Rotating music-themed thinking verbs
While the agent progress phase is `thinking` or `clarifying`, the StatusBar SHALL render a music-themed verb label (e.g., `crate digging…`, `tuning…`, `mixing…`) selected from a fixed `THINKING_VERBS` list in `src/ui/theme.ts`. The verb SHALL rotate deterministically every 3 elapsed seconds, computed as `floor(elapsed / 3) % THINKING_VERBS.length` from the existing elapsed-seconds counter — no additional timers or state. The verb REPLACES the previous static label entirely: the token count (`n=<count>`) MUST NOT be displayed. Every verb MUST be at most 14 printable characters and end with `…`. Labels for all other phases (`tool`, `resolving`, `creating`, `adding`, `done`) SHALL be unchanged.

#### Scenario: Verb rotates on 3-second cadence
- **WHEN** the phase is `thinking` and elapsed time crosses from 2 s to 3 s
- **THEN** the StatusBar label advances from `THINKING_VERBS[0]` to `THINKING_VERBS[1]`

#### Scenario: Token count no longer shown
- **WHEN** the phase is `thinking` and tokens have streamed (tokenCount > 0)
- **THEN** the StatusBar label is the current verb with no `n=` suffix

#### Scenario: Clarifying shares the verb pool
- **WHEN** the phase is `clarifying`
- **THEN** the StatusBar label is the same elapsed-selected verb as for `thinking`

#### Scenario: Non-reasoning phases unaffected
- **WHEN** the phase is `resolving`, `tool`, `creating`, or `adding`
- **THEN** the StatusBar label matches its pre-change format (progress bar, tool name, etc.)

#### Scenario: Verb length bounded
- **WHEN** any entry of `THINKING_VERBS` is measured
- **THEN** it is at most 14 printable characters and ends with `…`

### Requirement: Unified braille spinner across all phases
The StatusBar and the ReasoningTranscript header SHALL animate with the shared braille `SPINNER` frame set from `src/ui/theme.ts` for every progress phase, including `thinking` and `clarifying`. No phase-specific frame set SHALL exist.

#### Scenario: Thinking phase uses braille frames
- **WHEN** generation is in the `thinking` or `clarifying` phase
- **THEN** the StatusBar right cluster shows a braille `SPINNER` frame

#### Scenario: ReasoningTranscript header
- **WHEN** the reasoning transcript is visible while the agent is generating
- **THEN** its header glyph animates with the braille `SPINNER` frame set

## REMOVED Requirements

### Requirement: Distinct spinner during the thinking phase
**Reason**: The dedicated musical-note frame set added a second animation style without informational gain; the rotating music verbs now differentiate the reasoning phases, so the glyph reverts to the unified braille `SPINNER` (pre-PR-#16 behavior).
**Migration**: Delete `THINKING_SPINNER` from `src/ui/theme.ts` and the `spinnerGlyph` phase switch in `src/ui/StatusBar.tsx`; render `SPINNER[frame % SPINNER.length]` for all phases.

### Requirement: Thinking spinner must not break row layout
**Reason**: Scoped to the dedicated thinking frame set, which no longer exists. The braille `SPINNER` frames are all single-cell, and the verb-length cap in "Rotating music-themed thinking verbs" bounds label-width jitter.
**Migration**: None — covered by the ADDED requirements above.
