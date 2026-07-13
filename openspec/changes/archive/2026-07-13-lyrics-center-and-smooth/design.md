## Context

- Compact panel (src/app.tsx:1649–1666): a `LYRICS_PANEL_ROWS`-high column box rendering prev/current/next `<text>` children — left-aligned, `paddingLeft: 1`.
- Full-screen view (src/ui/LyricsScreen.tsx): column box with `start = max(0, currentLine - 3)` then `lines.slice(start)` to the end — left-aligned, no height bound, so long songs overflow the terminal and the current line's on-screen position wanders between row 0 and row 3 before drifting off.
- The full-screen overlay is NOT exclusive: the main UI block (src/app.tsx:1609) does not check `lyricsFullScreen`, so ResultsList/input render beneath the lyrics box and push layout unpredictably (observed live 2026-07-13 — fullscreen content spilled past the pane bottom).
- All height budgeting lives in `layoutBudget` (src/ui/layout.ts); components receive plain numbers via props and never read the terminal size themselves (invariant from small-window-ui-hardening).
- User feedback (screenshot): lyrics must be horizontally centered and the animation smoother; clarified as karaoke scroll — current line pinned, sheet moves.

## Goals / Non-Goals

**Goals:**
- Lyric lines horizontally centered on both surfaces.
- Full-screen: current line vertically pinned to the middle of the lyrics viewport; window shifts exactly one row per line advance (that shift IS the smoothness — no teleporting window).
- Full-screen view fits the terminal: visible line count derived from `layoutBudget`, never rendering past the bottom edge.
- Full-screen view is exclusive — main stack (ResultsList/input) hidden while it is up.

**Non-Goals:**
- No color-fade/crossfade easing (user chose scroll over fade).
- No changes to lyrics fetching, caching, LRC parsing, interpolation tick (250 ms stays), or the `/lyrics` cycle.
- No compact-panel shape change (stays 3 rows prev/current/next — its middle row is already the karaoke pin).
- Not touching plain-lyrics (unsynced) rendering beyond centering.

## Decisions

1. **Centering via container alignment, not per-line padding.** Set `alignItems: "center"` on the lyric-lines column (compact panel box and LyricsScreen inner column) so each `<text>` child centers itself; drop the asymmetric `paddingLeft`. Alternative rejected: manual space-padding each string against a width prop — duplicates layout math the flex engine already does and breaks on wrapped lines. Fallback if opentui's `alignItems` misbehaves on `<text>`: wrap each line in a `flexDirection: "row", justifyContent: "center"` box (same visual, one extra node per row).
2. **Pure window helper `karaokeWindow(total, current, visible): { start, end }`** in src/ui/layout.ts (or LyricsScreen module): `start = clamp(current - floor((visible - 1) / 2), 0, max(0, total - visible))`. Pins the current line to the vertical middle except near the sheet's edges (top clamp: first lines don't pad; bottom clamp: last lines fill the viewport). Pure and unit-testable — the pinning math is the behavior the user feels.
3. **Viewport height from `layoutBudget`.** Add `lyricsScreenRows` to `LayoutBudget`: rows available to lyric lines in full-screen = `height − paddingTop − STATUS_ROWS − (nowPlaying ? NOW_PLAYING_ROWS : 0) − 2 (box border) − 1 (progress row)`, floored at 3. App passes it as a `maxLines` prop; LyricsScreen slices `karaokeWindow(lines.length, currentLine, maxLines)`. Alternative rejected: LyricsScreen reading terminal size itself — violates the centralized-budget invariant.
4. **Exclusive full-screen render.** Add `!lyricsFullScreen` to the main-block condition (src/app.tsx:1609) so the lyrics box replaces ResultsList/input instead of stacking above them. Esc (already wired at src/app.tsx:439) and `/lyrics` remain the exits. Player footer + StatusBar stay visible under the lyrics box (they anchor the bottom and carry the position the lyrics sync to).
5. **Compact panel change is centering only.** Replace `paddingLeft/paddingRight: 1` with `alignItems: "center"`; the `—` placeholder rows keep the panel height stable at `LYRICS_PANEL_ROWS`.

## Risks / Trade-offs

- [opentui `alignItems: "center"` might not apply to bare `<text>` children] → decision 1's fallback (per-row `justifyContent: "center"` box) is a mechanical swap, verified in the TUI driver during 3.x tasks.
- [Lines wider than the viewport wrap and visually break the "one row per line" window math] → accept: window is computed in logical lines; wrap is rare at 100 cols and merely makes the window one row shorter visually. Not worth truncation.
- [Hiding the main stack in full-screen changes what Esc returns to] → no state is unmounted—`resolved`/input state live in App; re-render restores the exact previous screen.
- [Small terminals: `lyricsScreenRows` floor of 3] → matches the compact panel's information content; degradation consistent with the responsive-tui-layout spec.

## Migration Plan

Single PR on top of the lyrics feature branch. No data/config migration. Rollback = revert.

## Open Questions

- None.
