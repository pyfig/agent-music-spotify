# Design: Equalizer Thinking Spinner + Rotating Music Verbs

## Context

The thinking/clarifying phases render a static label via `progressLabel()` in `src/ui/StatusBar.tsx` (`thinking n=123` or `thinking …`) next to an animated glyph from `THINKING_SPINNER` in `src/ui/theme.ts` (`♪ ♫ ♬ ♩`). One 80 ms timer in `app.tsx` drives `spinnerFrame` (0–9) and `elapsed` (whole seconds) while `loading` is true. The `ReasoningTranscript` header consumes the same `THINKING_SPINNER` constant. The existing `thinking-spinner` spec forbids layout shift as frames advance; `tests/thinking-spinner.test.ts` asserts single-cell BMP frames and phase→frame-set selection.

## Goals / Non-Goals

**Goals:**
- One uniform spinner animation (braille `SPINNER`) across all phases — revert the PR-#16 dedicated thinking frames.
- Rotating music-themed verbs so long thinking stretches visibly progress.
- Zero new timers, state, or props beyond what already reaches StatusBar.

**Non-Goals:**
- No changes to non-reasoning phase labels (`tool`, `resolving`, `creating`, `adding`, `done`).
- No change to the `ReasoningTranscript` header label (`music-agent`) or its code.
- No token-count display anywhere (removed for thinking, not relocated).
- No randomness — rotation is deterministic.

## Decisions

### D1: Unified braille spinner — `THINKING_SPINNER` deleted
All phases, including `thinking`/`clarifying`, animate with the shared braille `SPINNER`; `THINKING_SPINNER` and the `spinnerGlyph` phase switch are removed (revert to pre-PR-#16 behavior). The rotating verbs now carry the "this is reasoning" signal, so a second animation style is redundant. The `ReasoningTranscript` header switches to `SPINNER` too.
*Alternatives considered:* equalizer pulse (`▁ ▂ ▃ ▅ ▇ ▅ ▃ ▂`) — implemented first, then rejected by user in favor of the older unified look; extended note cycle (`♩ ♪ ♫ ♬ ♯ ♮ ♭`) — rejected: less animated feel.

### D2: Verb index derived from `elapsed`, not a new counter
`THINKING_VERBS[Math.floor(elapsed / 3) % THINKING_VERBS.length]` — a new verb every 3 s. `elapsed` already updates on the same shared timer and already flows into `StatusBar` as a prop, so rotation costs no new state, timers, or re-renders. Sequential order keeps it deterministic and trivially testable.
*Alternative considered:* frame-count-based rotation — rejected: `spinnerFrame` wraps at 10 (0.8 s), no total-tick counter exists, and adding one is new state for no benefit.

### D3: Verb replaces the whole thinking label
`progressLabel()` gains an `elapsed` parameter and returns just the verb for `thinking` and `clarifying`; the `n=<tokenCount>` suffix is dropped. Both phases are LLM reasoning and share the verb pool, mirroring how they already share the thinking frame set (`spinnerGlyph`).
*Alternative considered:* keep `n=` suffix — rejected by user; also adds width churn.

### D4: 14-character verb cap, no padding
Verbs are lowercase with a trailing `…` to match existing label style, each ≤ 14 printable characters. The right cluster is right-justified (`flexGrow` + `justify-content: flex-end`), so length changes grow leftward into space the left cluster already cedes while loading; a ≤ 14-char spread every 3 s is acceptable jitter. Pad-to-equal-width was rejected as visually ugly (trailing gaps before `·`).

Verb pool (8 entries, one full cycle = 24 s):
`digging crates…`→ 15 chars — trim to `crate digging…` (14). Final pool:
`crate digging…`, `tuning…`, `riffing…`, `mixing…`, `cueing up…`, `sampling…`, `vibing…`, `reading notes…`.

### D5: Tests extend the existing suite
`tests/thinking-spinner.test.ts` drops the `THINKING_SPINNER`/`spinnerGlyph` phase-selection assertions (both symbols are deleted) and keeps a single-cell check on `SPINNER`. New assertions: every verb ≤ 14 chars and ends with `…`; verb selection for a given `elapsed` is `floor(elapsed/3) % len`; `thinking`/`clarifying` labels contain no `n=`; non-reasoning phase labels unchanged. Requires exporting `thinkingVerb` and `progressLabel` from `StatusBar.tsx` (export-for-tests pattern).

## Risks / Trade-offs

- [Right-cluster width jitters up to ~7 chars between verbs] → 3 s cadence makes it a discrete hop, not a strobe; cap keeps worst case small; layout spec scenario (40-column render) still verified by tests.
- [Losing the phase-distinct glyph means thinking vs resolving reads only from the label] → the verbs are unmistakably reasoning-flavored while resolve/create keep progress bars and counts; net distinction unchanged.
- [Verb cycle repeats every 24 s and may feel loopy on very long generations] → acceptable; pool can grow later without structural change.

## Migration Plan

Pure UI constant/label change — no data, config, or API migration. Rollback = revert commit.

## Open Questions

None.
