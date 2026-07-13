## 1. Default backend → youtube-music

- [x] 1.1 Change the `musicBackend` fallback in `loadConfig()` from `"spotify"` to `"youtube-music"` (src/config.ts:139)
- [x] 1.2 Add/extend config test: no env + no file → `"youtube-music"`; invalid file value → `"youtube-music"`; file `"spotify"` still wins; env `MUSIC_BACKEND=soundcloud` beats file (use HOME-sandboxed config dir like existing config tests)
- [x] 1.3 Verify first-run path: with unconfigured backend, startup runs `checkLocalPlaybackDeps("youtube-music")` and no Spotify auth/ClientIdPrompt fires (inspect app.tsx startup effect; add assertion only if a seam already exists)
- [x] 1.4 Update AGENTS.md / config docs wherever the default backend is named

## 2. Thinking spinner

- [x] 2.1 Add `THINKING_SPINNER` frame array (`["♪", "♫", "♬", "♩"]`) to src/ui/theme.ts next to `SPINNER`, with comment on single-cell width constraint
- [x] 2.2 StatusBar: pick frame set by phase — `thinking`/`clarifying` → `THINKING_SPINNER`, everything else → `SPINNER` (render site at StatusBar.tsx:129); extract tiny `spinnerGlyph(phase, frame)` helper if it keeps JSX readable
- [x] 2.3 ReasoningTranscript header glyph (ReasoningTranscript.tsx:63): switch to `THINKING_SPINNER`
- [x] 2.4 Tests: every `THINKING_SPINNER` frame has `.length === 1`; StatusBar shows thinking frame during `thinking` phase and braille frame during `resolving` (follow existing StatusBar/ui test patterns)

## 3. Verify & ship

- [x] 3.1 `bun test` — full suite green, regenerate any stale snapshots
- [x] 3.2 Drive the TUI (run-music-agent skill): fresh HOME sandbox lands on youtube-music without Spotify login; thinking phase shows note spinner, resolving shows braille; `/lyrics` on a ytmusic track shows synced lines; narrow terminal row stays stable (verified 2026-07-13: sandbox → youtube-music ✓, ♬ thinking spinner ✓, compact + fullscreen synced lyrics on Karma Police ✓; braille-during-resolving + narrow-row covered by unit tests)
- [x] 3.3 Commit, PR, note behavioral break (default backend) in PR body

## 4. Synced lyrics fix (youtube-music)

- [x] 4.1 Reproduce: enable `/lyrics` on a ytmusic track with a known LRCLIB entry — reproduced in TUI (Karma Police, panel never appeared); root cause measured: LRCLIB latency 7–12 s vs 5 s timeout, abort cached as "none" (`/api/get` itself matches fine)
- [x] 4.2 Harden `src/lyrics/client.ts`: timeout 15 s; per-URI in-flight dedupe (poll re-runs return the pending promise instead of aborting it); cache only definitive 200/404 outcomes — timeout/abort/network return uncached `null`; `/api/search` fallback on definitive 404 (synced candidate closest in duration ±10 s, else first synced, else plain, else "none")
- [x] 4.3 Tests in tests/lrclib-client.test.ts: timeout/abort NOT cached (retry refetches); concurrent same-URI fetches share one request; get-hit skips search; get-404 + search-hit returns synced; both miss → "none" cached once per URI; track-switch abort still works
