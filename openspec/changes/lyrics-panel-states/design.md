## Context

Lyrics mode (`/lyrics`) exists but has no visible identity of its own. The compact panel (`src/ui/LyricsPanel.tsx`) renders only when `showCompactLyrics` is true in `src/app/render.ts` — which requires synced lyrics to already be loaded, a track playing, and no busy state. In every other situation the panel is simply absent, so "lyrics off", "loading", "no lyrics", and "fetch failed" all look identical. `LyricsCache` (`src/lyrics/client.ts`) collapses fetch failures into `"none"`, so the error case is unrecoverable at the UI layer. Separately, `StatusBar.tsx:157` shows a generic `· generating…` in the non-progress loading branch, and results-list track rows wrap onto continuation lines that visually read like lyric text.

## Goals / Non-Goals

**Goals:**
- Persistent, visually separated lyrics panel whenever lyrics mode is on.
- Explicit textual state for: waiting for playback, loading, found, no synced lyrics, failed to load.
- Distinguish fetch failure from "no lyrics found" in the data layer.
- Replace `generating…` with action-specific labels.
- One-line ellipsis truncation for track titles so they can't be mistaken for lyrics.

**Non-Goals:**
- No changes to LRCLIB fetching, caching keys, or the full-screen lyrics view's karaoke scroll.
- No new dependencies, no persistence of lyrics across runs.
- No retry/backoff logic for failed fetches (a failed track stays failed for the run, same as today's cached miss).

## Decisions

1. **Panel state is derived in `render.ts`, not stored.** A `lyricsPanelState` discriminated value (`"waiting" | "loading" | "synced" | "none" | "error"`) is computed from existing inputs: `lyricsMode`, `nowPlaying`/`currentlyPlayingUri`, and `lyricsData`. No new React state or effects — the states are already implicit in these variables; we only name them. Alternative (state machine in `useLyrics`) rejected: duplicates information and adds sync bugs.

2. **Surface the existing failure sentinel as an `"error"` display state.** `LyricsCache.fetch` already distinguishes a definitive miss (`"none"`, cached) from an indeterminate failure (`null`, deliberately NOT cached so later effect runs retry). No client change needed. `useLyrics` maps a resolved `null` to `lyricsData = "error"` (type widens to `LyricsResult | "none" | "error" | null`) so the panel can say "failed to load" while the retry-on-next-poll behavior is preserved. Alternative (cache errors) rejected: would turn a transient network blip into a permanent miss for the run, regressing the client's deliberate retry design.

3. **Panel keeps its fixed `LYRICS_PANEL_ROWS` height in every state.** Non-`synced` states render a single centered muted message in the middle row (e.g. `♪ Loading lyrics…`, `♪ No synchronized lyrics for this track`, `♪ Lyrics unavailable (fetch failed)`, `♪ Waiting for playback…`). Fixed height means no layout jumps between states. The panel gains a top separator (a muted horizontal rule or bordered box top edge) to divide it from the results list.

4. **Visibility flips from "has synced lyrics" to "lyrics mode on".** `showCompactLyrics`/`layoutBudget.lyricsPanel` become driven by `lyricsMode && !busy` (still hidden while the full-screen view or generation overlays own the screen, and still first to drop on short terminals per the layout degradation order). Lyrics disabled ⇒ no panel at all (unchanged).

5. **Status label.** The `loading`-branch `· generating…` becomes `· generating playlist…`; the in-progress branch already uses `progressLabel` phase verbs (thinking verbs, `tool: <name>`, `resolving [bar]`, `creating playlist`, `adding tracks`) — those stay. Lyrics loading is communicated by the panel itself, not the status bar, to avoid two surfaces mutating for one background fetch.

6. **Track titles truncate, never wrap.** `ResultsList` row text gets single-line ellipsis truncation against the known content `width` (it already receives `width` for wrap math — reuse it for a truncation helper). This also simplifies the list-height estimate (each row = 1 line). Alternative (keep wrap, add heavier separator) rejected: wrap is the root cause of the "title looks like lyrics" ambiguity and complicates height math.

## Risks / Trade-offs

- [Error state may flip back to loading on retry] → Acceptable; retries are silent (panel shows the error message until a retry resolves) and at most one request is in flight per track.
- [Persistent panel costs 3–4 rows whenever lyrics mode is on, even with no lyrics] → That is the point of the change; degradation order still drops the panel first on short terminals, so functional rows are safe.
- [Truncation hides the tail of long titles] → The selected row can be shown in full elsewhere later if needed; out of scope. Truncation is standard TUI practice and removes the ambiguity.
- [Distinguishing 404 vs network failure depends on LRCLIB client shape] → If the client can't tell, default ambiguous failures to `"error"` (worst case we say "unavailable" when it was truly missing — safer than the reverse claim).

## Migration Plan

Single PR, no data migration. Update `openspec/specs` deltas on archive. Existing tests referencing `"none"` for failures update to `"error"`.

## Open Questions

- None blocking. Exact message strings and separator glyph to be settled during implementation against the theme palette.
