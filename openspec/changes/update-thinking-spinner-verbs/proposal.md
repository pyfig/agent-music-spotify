# Update Thinking Spinner: Unified Braille Glyphs + Rotating Music Verbs

## Why

The thinking-phase status label is static (`thinking n=123` / `thinking …`) for the entire reasoning stretch, which can run tens of seconds — the UI reads as stalled even though the agent is working. Rotating music-themed verbs make long thinking phases feel alive. The dedicated musical-note glyph set introduced in PR #16, meanwhile, added a second animation style for no informational gain — reverting to the single braille spinner (pre-#16 behavior) keeps the motion language uniform now that the verbs carry the "reasoning" signal.

## What Changes

- **Remove `THINKING_SPINNER`** (`♪ ♫ ♬ ♩`) entirely: all progress phases — including `thinking` and `clarifying` — animate with the shared braille `SPINNER`, as before PR #16. The `spinnerGlyph` phase switch is deleted.
- Add a `THINKING_VERBS` list of music-themed labels (e.g., `crate digging…`, `tuning…`, `riffing…`, `mixing…`) that rotates on a slow cadence (every 3 s, derived from the existing `elapsed` counter — no new timers or state).
- The rotating verb **replaces** the current thinking label entirely, including the `n=<tokenCount>` suffix; the now-dead `tokenCount` plumbing is removed end-to-end.
- Verbs apply to both reasoning phases: `thinking` and `clarifying`. All other phases (`tool`, `resolving`, `creating`, `adding`, `done`) keep their existing labels.
- Every verb is capped at 14 printable characters so the right-cluster width jitter stays small.
- The `ReasoningTranscript` header glyph switches to the braille `SPINNER`; its `music-agent` label is unchanged.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `thinking-spinner`: (1) **REMOVED** — the dedicated thinking-phase frame set; thinking/clarifying now share the braille `SPINNER` with every other phase; (2) **ADDED** — the thinking/clarifying status label rotates through music-themed verbs on a slow cadence and no longer shows the token count.

## Impact

- `src/ui/theme.ts` — delete `THINKING_SPINNER`; add `THINKING_VERBS`.
- `src/ui/StatusBar.tsx` — delete `spinnerGlyph`; `progressLabel` gains `elapsed` to pick the verb; `tokenCount` prop removed.
- `src/app.tsx` — `tokenCount` state, `onToken` callback, and prop removed.
- `src/ui/ReasoningTranscript.tsx` — header glyph uses `SPINNER`.
- `tests/thinking-spinner.test.ts` — glyph phase-selection tests deleted; verb-rotation tests added (cadence math, 14-char cap, phase scoping).
- No API, config, or dependency changes.
