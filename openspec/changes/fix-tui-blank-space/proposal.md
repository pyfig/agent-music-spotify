## Why

On tall terminals with a short result list, a large blank band appears between the input cluster and the lyrics/status-bar footer. This violates the existing `responsive-tui-layout` spec requirement that "remaining space SHALL collapse rather than render as a void between the input and the footer" — the current implementation regressed against that requirement.

## What Changes

- Remove/replace the unconditional `flexGrow: 1` spacer boxes in `src/ui/MainScreen.tsx` (compact-lyrics path line ~300 and fullscreen-lyrics path line ~305) that absorb all leftover terminal height as blank space.
- Ensure bottom-anchoring of the lyrics panel + status bar is achieved without introducing a visible void when `ResultsList` collapses to its content-sized height on tall terminals.
- No new flex spacer should grow unbounded; any remaining slack should either stay collapsed (list-anchored layout) or be distributed in a way that doesn't read as a dead empty region.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
(none — this is a bug fix restoring compliance with the existing `responsive-tui-layout` capability; no requirement text changes)

## Impact

- `src/ui/MainScreen.tsx` — layout composition, spacer removal/adjustment.
- `src/ui/ResultsList.tsx` — content-based sizing behavior (verify interaction, no logic change expected).
- `src/ui/layout.ts`, `src/app/render.ts` — `layoutBudget()` inputs/outputs, verify no changes needed.
- Visual only; no data, API, or persistence impact.
