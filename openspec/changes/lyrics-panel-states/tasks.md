## 1. Data layer — distinguish fetch failure from no lyrics

- [x] 1.1 Confirmed `src/lyrics/client.ts` already distinguishes definitive miss (`"none"`, cached) from indeterminate failure (`null`, deliberately uncached so it retries) — no client change; design/spec updated to preserve retry semantics
- [x] 1.2 Widen `useLyrics` state type in `src/hooks/useLyrics.ts` to `LyricsResult | "none" | "error" | null`; a resolved `null` maps to `"error"`
- [x] 1.3 Unit tests: 500 → `"error"` (uncached, retried and replaced on success), 404 → `"none"`

## 2. Derived panel state

- [x] 2.1 In `src/app/render.ts`, add a derived `lyricsPanelState: "waiting" | "loading" | "synced" | "none" | "error"` computed from `lyricsMode`, currently-playing URI, and `lyricsData` (null + playing = loading; no playback = waiting)
- [x] 2.2 Change panel visibility: `showCompactLyrics` / `layoutBudget.lyricsPanel` driven by `lyricsMode && !busy && !lyricsFullScreen`, not by presence of synced lyrics
- [x] 2.3 Unit tests for the state mapping (each input combination → expected state; lyrics off → no panel)

## 3. LyricsPanel rendering

- [x] 3.1 Extend `src/ui/LyricsPanel.tsx` to accept the panel state and render a centered muted message row for `waiting` / `loading` / `none` / `error`, keeping height at `LYRICS_PANEL_ROWS` in every state
- [x] 3.2 Add a visual separator (muted rule or box top border) between the results list and the panel
- [x] 3.3 Wire new props through `src/ui/MainScreen.tsx`; layout budget gains `lyricsPanelVisible` so a space-dropped panel is actually unmounted; degradation tests extended

## 4. Status bar label

- [x] 4.1 Replace `· generating…` in `src/ui/StatusBar.tsx` loading branch with `· generating playlist…`; confirmed no other surface renders a bare "generating" (grep: only comments)
- [x] 4.2 Confirmed by inspection: StatusBar props derive only from generation/playback/config — `lyricsData` is never passed to it; `progressLabel` untouched

## 5. Track title truncation

- [x] 5.1 Add a single-line ellipsis truncation helper (`truncatedRowParts`) and apply it to track rows in `src/ui/ResultsList.tsx` using the passed `width`
- [x] 5.2 Simplify wrapped-row height estimation in `ResultsList` (each track row = 1 line); `wrappedRows` stays exported in layout.ts for its own tests
- [x] 5.3 Test: overlong artist — title renders as one row ending in ellipsis at 60 and 80 columns (`tests/results-truncation.test.ts`)

## 6. Verification

- [x] 6.1 `bun test` green (406 pass); `bunx tsc --noEmit` clean
- [x] 6.2 Drove the TUI in sandbox: `/lyrics` with nothing playing → persistent panel with `── ♪ lyrics ──` separator + "♪ waiting for playback…"; toggling off removes the panel. Loading/none/error/synced transitions and truncation covered by unit tests (sandbox has no real playback to exercise them live)
- [x] 6.3 Validate change: `openspec validate lyrics-panel-states` → valid
