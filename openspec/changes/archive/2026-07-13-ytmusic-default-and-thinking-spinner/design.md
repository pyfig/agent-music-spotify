## Context

- `loadConfig()` resolves `musicBackend` via env > file > default; the hardcoded default is `"spotify"` (src/config.ts:136–139). Invalid values already fall through `asMusicBackend` to the default, so the change is a one-literal swap plus its blast radius.
- Spotify requires client ID + PKCE browser login before first playback; youtube-music needs only mpv + yt-dlp on PATH, already checked early by `checkLocalPlaybackDeps` (src/music/playback.ts) with install hints.
- First-run SetupWizard gates on `isConfigured` → `providerChosen` only (src/config.ts:286) — backend default does not affect wizard routing. Spotify auth/ClientIdPrompt paths are only entered when the active backend is spotify, so the default swap removes them from the first-run path for free.
- One braille `SPINNER` in src/ui/theme.ts is shared by StatusBar (right cluster, next to `progressLabel`, StatusBar.tsx:129) and ReasoningTranscript header (ReasoningTranscript.tsx:63). `spinnerFrame` counter lives in app.tsx and is passed down as a prop.
- StatusBar already receives `progress` and switches on `progress.phase` inside `progressLabel` — phase info is available exactly where the glyph renders. ReasoningTranscript does NOT receive phase.
- Synced lyrics broke at runtime (reproduced in the TUI 2026-07-13, Radiohead – Karma Police on youtube-music). Measured root cause: LRCLIB responds in 7–12 s from this network while `fetchFromLrclib` hard-aborts at 5 s; the catch converts the abort to `"none"` and `LyricsCache.fetch` caches it per URI — lyrics never appear and never retry. Two compounding defects: the playback poll recreates `currentTrackMeta` every 1.5 s, re-running the `useLyrics` fetch effect, and each re-run's `cache.fetch` aborts the previous in-flight request *for the same track* (perpetual abort chain once latency exceeds the poll period); and indeterminate failures (timeout/abort/network) are cached exactly like definitive 404s. Note: `/api/get` itself matched fine with real ytmusic metadata — the original exact-match-miss hypothesis was wrong.

## Goals / Non-Goals

**Goals:**
- Zero-credential first run: fresh install lands on youtube-music.
- Preserve env > file > default precedence exactly; no migration for existing users.
- Thinking phase visually distinct from resolving/creating in the StatusBar; reasoning transcript header uses the thinking animation.
- All spinner frames single terminal cell — no layout shift, no width-budget changes.

**Non-Goals:**
- No change to backend switching (`applyBackendChoice`), URI namespacing, or capability flags.
- No SetupWizard redesign; wizard still gates on provider choice only.
- No per-phase spinner for every phase — only thinking gets a dedicated set.
- Not touching DonutAnimation.

## Decisions

1. **Default literal swap in config.ts only.** Change the final `?? "spotify"` to `?? "youtube-music"`. Alternatives: (a) a first-run backend picker — rejected, adds a wizard step for something changeable later via slash menu; (b) auto-detect (spotify if tokens.json exists) — rejected, magic precedence that fights the documented env > file > default contract.
2. **`THINKING_SPINNER` exported from theme.ts next to `SPINNER`.** Frames: `["♪", "♫", "♬", "♩"]` — musical, on-brand, all BMP single-cell glyphs. Driven by the existing shared `spinnerFrame` counter (`THINKING_SPINNER[spinnerFrame % THINKING_SPINNER.length]`); no new timer, differing frame-set lengths are fine with modulo. Alternative: emoji frames — rejected, 2-cell width breaks the row budget; per-component timers — rejected, needless state.
3. **StatusBar selects frame set by `progress.phase === "thinking"`** (and `"clarifying"`, which is also LLM reasoning) right at the render site (line ~129). Everything else keeps braille. No prop changes.
4. **ReasoningTranscript header always uses `THINKING_SPINNER`.** The transcript IS the reasoning view; plumbing a phase prop through ResultsList just to flip its header glyph is not worth the coupling. Alternative rejected: pass `phase` through ResultsList → ReasoningTranscript.
5. **Docs/tests updated in the same change**: AGENTS.md notes the new default; config default test asserts the fallback; a StatusBar test asserts phase-based frame-set selection; a theme test asserts every thinking frame has length 1 (cell-width guard).
6. **Lyrics fetch hardening in `src/lyrics/client.ts`** (root cause is latency + caching, not matching):
   (a) timeout 5 s → 15 s, same budget philosophy as `SEARCH_TIMEOUT_MS`;
   (b) per-URI in-flight dedupe in `LyricsCache` — a re-fetch for the same track returns the pending promise instead of aborting it; `cancelInFlight` now only fires on a genuine track switch;
   (c) only definitive outcomes are cached (HTTP 200 result or 404 "none"); timeouts, aborts, and network errors return `null` (indeterminate) and stay uncached so the next poll-driven effect run retries;
   (d) keep `/api/get` primary and add `/api/search?artist_name=&track_name=` fallback on definitive 404 as insurance for duration/title variants — pick the synced candidate with duration closest to the playing track (±10 s window), else the first synced candidate, else plain, else "none".
   Alternative rejected: `/search`-only (loses the exact fast path); leaving the 5 s timeout and only adding search (measured latency alone breaks it).

## Risks / Trade-offs

- [Existing user with no config.json who always used implicit Spotify default silently switches backends on update] → release notes call out **BREAKING (behavioral)**; their tokens.json stays intact, one `/backend` slash-menu action restores Spotify.
- [mpv/yt-dlp missing on fresh install → first experience is an install hint, not music] → hint text already includes exact brew/apt commands; this is still faster than the Spotify client-ID + OAuth dance.
- [♪/♫ glyph width varies in exotic fonts/terminals] → frames are BMP East-Asian-width "narrow" chars, same class as the braille frames already shipped; length-1 test guards the string side.
- [ytmusic-api scrape flakiness makes the default backend feel broken] → known backend property, unchanged by this diff; error classifier already surfaces network failures loudly.
- [`/api/search` fallback attaches wrong-track lyrics to a fuzzy match] → duration-proximity guard (±10 s) filters most collisions; mismatch cost is cosmetic (wrong lyrics panel), never affects playback.

## Migration Plan

Single PR. No data migration; config precedence protects existing explicit configs. Rollback = revert the default literal. Release as minor version bump with the behavioral break noted.

## Open Questions

- None blocking. Frame set aesthetics (♪♫♬♩ vs pulse dots) trivially swappable at one theme.ts array.
