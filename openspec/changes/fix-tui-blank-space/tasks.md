## 1. Layout fix

- [x] 1.1 Remove the `<box style={{ flexGrow: 1 }} />` spacer at `src/ui/MainScreen.tsx:300` (default/list path).
- [x] 1.2 Remove the `<box style={{ flexGrow: 1 }} />` spacer at `src/ui/MainScreen.tsx:305` (fullscreen-lyrics path).
- [x] 1.3 Confirm no other code relies on these spacer boxes existing (e.g. layout measurement, snapshot tests, or `layoutBudget()` assumptions in `src/ui/layout.ts` / `src/app/render.ts`).

## 2. Verification

- [x] 2.1 Using the `run-music-agent` skill, drove the TUI on a 120×50 terminal. Pre-interaction centered state: footer sits directly below input, no gap. Post-error (0 results) state: input cluster is immediately followed by the status bar with no gap — confirms the removed spacer's bottom-anchoring gap is gone. (Note: a separate, pre-existing `flexGrow:1` centered placeholder inside `ResultsList` for the zero-results case, `src/ui/ResultsList.tsx:84`, is unrelated to this fix and out of scope — it's not the bottom-anchoring spacer this change targeted, and it doesn't appear in the reported bug's screenshot which showed a populated list.)
- [x] 2.2 Verified structurally: the removed spacer wrapped unconditionally around the whole `!p.centered` block regardless of list population, so its removal applies identically whether the list is short or long. Sandbox has no live Spotify/agent auth to produce a real populated list for a pixel-level capture; `ResultsList`'s own content-based sizing (`src/ui/ResultsList.tsx:103`, untouched by this change) is what governs long-list flex behavior.
- [x] 2.3 Verified 70×17 renders correctly with no overflow and no gap (pre-interaction state); a live 24-track capture wasn't reachable in the sandboxed driver (no real playlist generation available), so this relies on `ResultsList`'s existing content-sizing logic being unchanged by this diff.
- [x] 2.4 Verified structurally: `LyricsScreen` (src/ui/MainScreen.tsx:220) receives an explicit `maxLines={p.budget.lyricsScreenRows}` bound independent of the removed trailing spacer, so removing the spacer doesn't affect its sizing — it only removes the leftover-space absorption after it.
- [x] 2.5 `bunx tsc --noEmit` clean. `bun test`: 406 pass, 0 fail.

## 3. Spec alignment

- [x] 3.1 Verified via 2.1: no blank band between input and footer in the reachable short/empty-list case; long/short populated-list scenarios verified structurally per 2.2/2.3 rather than pixel capture (sandbox limitation, not a code gap).
