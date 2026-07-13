## Why

Lyrics display shipped functional but rough: both the compact panel and the full-screen view render lines left-aligned against the terminal edge (screenshot feedback: "необходимо сделать lyrics по центру"), and a line advance is an abrupt content jump — the full-screen view repaints a window anchored to `currentLine - 3` and overflows the terminal height on long songs, so the current line wanders and the sheet visibly teleports. The user asked for centered lyrics and a smoother (karaoke-style) animation.

## What Changes

- Lyric text is horizontally centered in both surfaces: the compact 3-line panel and the full-screen lyrics view.
- Full-screen view becomes a karaoke scroll: the current line stays pinned to the vertical center of the lyrics box and the sheet scrolls around it, one line per advance, instead of the window jumping.
- Full-screen view is bounded to the available terminal height (no more rendering past the bottom edge on long songs); the visible window is derived from the layout budget.
- Compact panel keeps its 3-row prev/current/next shape (current already the middle row — the karaoke pin) and gains horizontal centering only.
- No changes to fetching, caching, parsing, or the `/lyrics` toggle cycle.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `synced-lyrics`: the display requirement changes — lyric lines SHALL be horizontally centered on both surfaces; the full-screen view SHALL keep the current line vertically centered (karaoke scroll) and SHALL fit within the available terminal height.

## Impact

- `src/ui/LyricsScreen.tsx` — centered line rendering; viewport-sized window with the current line pinned to the middle; needs a height (and width if pad-centering) prop.
- `src/app.tsx` — compact panel line rendering centered; pass the layout-budget height to `LyricsScreen`.
- `src/ui/layout.ts` — expose a lyrics full-screen viewport height from `layoutBudget` (or reuse an existing budget number).
- Tests: window/pinning math (pure helper), centering render assertions; existing lyrics tests unaffected.
