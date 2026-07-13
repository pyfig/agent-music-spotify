## 1. Layout budget & window math

- [x] 1.1 Add `karaokeWindow(total, current, visible): { start, end }` pure helper (src/ui/layout.ts): `start = clamp(current - floor((visible - 1) / 2), 0, max(0, total - visible))`; handles `current === -1` (no line yet → window from 0) and `total <= visible` (whole sheet)
- [x] 1.2 Add `lyricsScreenRows` to `LayoutBudget`: `height − paddingTop − STATUS_ROWS − (nowPlaying ? NOW_PLAYING_ROWS : 0) − 3` (2 border + 1 progress row), floored at 3
- [x] 1.3 Unit tests (tests/layout.test.ts): pin at middle mid-song; clamp at start; clamp at end; `total <= visible`; `current === -1`; `lyricsScreenRows` numbers at heights 30 / 15 / 10

## 2. Full-screen karaoke view

- [x] 2.1 LyricsScreen: accept `maxLines` prop; slice `karaokeWindow(lines.length, currentLine, maxLines)` instead of `slice(start)`-to-end; same window bound for the plain-lyrics branch
- [x] 2.2 LyricsScreen: center lines — `alignItems: "center"` on the column, drop `paddingLeft/paddingRight`; if opentui ignores it on `<text>`, wrap rows in `justifyContent: "center"` row boxes (design decision 1 fallback)
- [x] 2.3 app.tsx: pass `maxLines={budget.lyricsScreenRows}`; add `!lyricsFullScreen` to the main-block condition (line ~1609) so full-screen replaces ResultsList/input; player footer + StatusBar stay
- [x] 2.4 Component tests: window render capped at `maxLines`; current line at vertical middle mid-song; centered output (follow existing UI test patterns in tests/)

## 3. Compact panel centering

- [x] 3.1 app.tsx compact panel (~line 1650): `alignItems: "center"` on the column box, drop `paddingLeft/paddingRight`; placeholder `—` rows keep height at `LYRICS_PANEL_ROWS`
- [x] 3.2 Test: compact panel lines centered (assert rendered row padding or container style, matching existing panel test approach)

## 4. Verify & ship

- [x] 4.1 `bun test` — full suite green
- [ ] 4.2 Drive the TUI (run-music-agent skill): play a synced track, `/lyrics` → compact panel centered; `/lyrics` again → full-screen: current line pinned mid-viewport, advances scroll one row, no overflow past the bottom, no ResultsList/input bleeding through; Esc returns to the normal screen intact; check a narrow (~50 col) window
- [ ] 4.3 Commit, PR
