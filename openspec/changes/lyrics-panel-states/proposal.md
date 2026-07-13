## Why

With `/lyrics` enabled, the compact lyrics panel only renders when synced lyrics already exist (`showCompactLyrics` in `src/app/render.ts`), so users cannot tell whether lyrics mode is on, whether a lookup is in progress, or why no text appears (loading vs. no synced lyrics vs. fetch failure — the client currently collapses failure into `"none"`). Wrapped long track titles in the results list visually read as lyric lines, and the status bar's generic `generating…` label (StatusBar.tsx:157) hides what the app is actually doing.

## What Changes

- The compact Lyrics panel becomes a **persistent block** whenever lyrics mode is on: fixed position, visually separated from the results list, always present regardless of lyrics availability.
- The panel renders an explicit message for each state: waiting for playback, loading lyrics, lyrics found (current lines), no synced lyrics available, failed to load lyrics. Lyrics disabled = panel absent (unchanged default).
- `LyricsCache`/`useLyrics` distinguish **fetch failure** from **no lyrics found** (today both become `"none"`), so the UI can say why text is missing.
- The generic `generating…` status-bar label is replaced with action-specific labels (e.g. "Generating playlist…", already-specific phase labels from `progressLabel` are reused/extended); no surface shows a bare `generating…`.
- Track rows in the results list truncate long titles with an ellipsis on one line instead of wrapping, so a wrapped title can never be mistaken for a lyric line. **BREAKING** for the existing "track rows wrap with hanging indent" layout scenario.

## Capabilities

### New Capabilities

- `status-activity-labels`: The status bar always names the specific activity in progress (loading lyrics, generating playlist, resolving tracks, …) instead of a generic "generating…" label.

### Modified Capabilities

- `synced-lyrics`: Lyrics display gains a persistent panel with explicit per-state messaging (waiting / loading / found / none / error) and error results are distinguished from "no lyrics" results.
- `responsive-tui-layout`: Track rows change from wrap-with-hanging-indent to single-line ellipsis truncation, and the lyrics panel gets a reserved, visually separated region in the layout budget.

## Impact

- `src/ui/LyricsPanel.tsx` — new state-message rendering + visual separator.
- `src/app/render.ts` — `showCompactLyrics` logic replaced with lyrics-mode-driven persistent visibility + derived panel state.
- `src/hooks/useLyrics.ts`, `src/lyrics/client.ts` — result type extended to carry `error` distinct from `none`.
- `src/ui/ResultsList.tsx` — title truncation.
- `src/ui/StatusBar.tsx` — `generating…` label replaced.
- `src/ui/layout.ts` / `MainScreen.tsx` — layout budget accounts for the always-present panel while lyrics mode is on.
- Tests: existing useLyrics/render/layout tests updated; new state-mapping tests.
