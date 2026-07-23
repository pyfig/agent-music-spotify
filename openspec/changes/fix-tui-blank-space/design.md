## Context

`src/ui/MainScreen.tsx` renders the main region in a column flex container. Two spacer boxes exist purely to keep the lyrics panel + status bar footer pinned to the bottom of the terminal:

- Line 300 (default/list path): `<box style={{ flexGrow: 1 }} />` after `inputCluster`.
- Line 305 (fullscreen-lyrics path): `<box style={{ flexGrow: 1 }} />`.

Both were added (per their own comment) after `ResultsList` switched from a fixed reserved-row height to content-based sizing (`src/ui/ResultsList.tsx:103`). Because `ResultsList` now collapses to actual content height, these spacers absorb *all* leftover terminal height to keep the footer bottom-anchored. On a tall terminal with a short result list, that absorbed space is a large visible blank band sitting between the input cluster and the lyrics panel/status bar — which directly violates the existing `responsive-tui-layout` requirement that remaining space "SHALL collapse rather than render as a void between the input and the footer."

## Goals / Non-Goals

**Goals:**
- Eliminate the unbounded blank band between the input cluster and the footer (lyrics panel + now-playing row + status bar) on tall terminals with short/empty result lists.
- Preserve existing behavior on small/medium terminals and terminals with long lists (spec's other scenarios must keep passing).

**Non-Goals:**
- Not changing `ResultsList`'s content-based sizing logic (`maxHeight`/`resultsMaxHeight` budget math) — that behavior is correct and desired.
- Not changing the lyrics panel's fixed `LYRICS_PANEL_ROWS` height or the status bar's `height: 1` sizing.
- Not introducing new scrolling or pagination behavior.

## Decisions

**Decision: Remove the `flexGrow: 1` spacer boxes; let the footer sit directly below content instead of forcing bottom-anchoring.**

Rationale: the spacer's bottom-anchoring behavior is exactly what produces the void the spec forbids. Once `ResultsList` is content-sized rather than terminal-filling, there is no correct amount of "leftover space" to insert mid-layout — any amount greater than zero is the bug. Dropping the spacer makes the column flow naturally: results → confirm actions → input → lyrics panel → now-playing → toast → status bar, sized to content. On a tall terminal, any unused rows fall *below* the status bar (ordinary terminal whitespace outside the interactive region), not between input and footer — which satisfies the spec's "no void between the input and the footer" requirement directly.

Alternatives considered:
- **Cap the spacer's growth** (e.g., `maxHeight` on the spacer box) to bound the gap instead of removing it. Rejected: still produces a visible, unexplained gap of arbitrary size: violates the spirit of the "no void" requirement and adds a magic constant with no principled value.
- **Make `ResultsList` flexGrow to fill available space** (revert to filling behavior) instead of content-sizing. Rejected: this is the behavior `ResultsList` intentionally moved away from (per the existing spec's "results list fills available vertical space" requirement using actual remaining space, and per the code comment referencing that change); reverting would reintroduce a different regression.
- **Center the whole main region vertically** instead of top-anchoring. Rejected: bigger visual change than needed, not requested, and inconsistent with the "large terminal unaffected" scenario which expects the input cluster directly below the list (top-anchored flow).

## Risks / Trade-offs

- **[Risk] Footer no longer visually pinned to the terminal's bottom edge on tall terminals with short lists** → Mitigation: this is the intended/spec-required trade-off; the footer now sits directly below content, which reads as compact rather than floating with a dead zone above it. Matches the "Large terminal unaffected" scenario's expectation of content-adjacent layout.
- **[Risk] Removing both spacers (compact and fullscreen-lyrics paths) could affect the fullscreen-lyrics view's own internal layout** → Mitigation: fullscreen-lyrics renders its own box above this block; verify visually (via `run-music-agent` skill) that fullscreen lyrics still renders correctly without the trailing spacer.
- **[Risk] Some terminal heights may have previously relied on the spacer to prevent the status bar from rendering off-screen** → Mitigation: status bar height/visibility is already governed by `layoutBudget()` in `src/ui/layout.ts`, independent of the spacer; confirm no coupling exists before removal.

## Migration Plan

Straightforward code change, no data/config migration. Verify manually across terminal sizes (short/tall, long/short list, fullscreen lyrics on/off) using the `run-music-agent` skill before considering the fix complete. No rollback concerns beyond reverting the diff.

## Open Questions

None.
