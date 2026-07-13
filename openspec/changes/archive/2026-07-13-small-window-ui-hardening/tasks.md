# Tasks: small-window-ui-hardening

## 1. Responsive small-window layout

- [x] 1.1 Extract a pure `layoutBudget(height, flags)` helper (rows consumed by input cluster, ConfirmActions, now-playing, status bar, padding) with unit tests for 12/17/24/40-row terminals
- [x] 1.2 Replace the `height - 15` constant in `src/ui/ResultsList.tsx` with the budget passed from App; keep `minHeight: 5` floor and the input-anchoring behavior
- [x] 1.3 Route degradation thresholds (`showLogo`, `slashMaxVisible`, vertical padding) through the same helper so all size logic lives in one place
- [x] 1.4 Verify/fix narrow-width behavior at 60–80 cols: StatusBar left/right clusters don't overlap, model label ellipsis holds, now-playing footer row truncates cleanly (StatusBar gets `width` prop → dynamic model budget; now-playing truncation budgets from `columnWidth` not terminal width)
- [x] 1.5 Visual check via run skill at 70×17, 80×24, 120×40: no void below input, list fills space, footer pinned; screenshot for the PR
  - Captures in `visual-check.md` (this dir). Two defects found & fixed: (1) the opentui scrollbox stretches to any height bound even without `flexGrow`, so a short list on a tall terminal opened an 11-row void between the last track and the input at 120×40 — ResultsList now sets an explicit height from `wrappedRows` content math capped by the budget; (2) ReasoningTranscript still measured the terminal itself with the legacy `height - 15` formula — it now takes `maxHeight` via props (design D2). Also verified live: now-playing row at 70×17 rebudgets the list correctly during real mpv playback; bonus fix: SIGHUP now also tears down mpv (terminal-window close orphaned the player).

## 2. Audio startup verification

- [x] 2.1 Add unit tests for `checkLocalPlaybackDeps` (mpv missing, yt-dlp missing for ytm, all present) using PATH stubbing or dep injection
- [x] 2.2 Add PlayerController tests with fake `startMpv`: socket appears → load command issued and playing state reported; socket never appears → bounded-timeout error naming the socket, no zombie handle
- [x] 2.3 Add auto-advance test: fake mpv emits `end-file` → next queued track loads; final track → clean stop, no error
- [x] 2.4 Write `scripts/audio-smoke.ts` (manual, real mpv): resolve a known track, start playback, confirm playing state via IPC within a bounded time, exit non-zero on failure; exclude from `bun test`
  - Defect found & fixed: `connectWithRetry` created the socket via `createConnection(path)`, but Bun emits the unix-socket ENOENT synchronously inside the connect call — the "error" event fired before any listener was attached, crashing the process instead of retrying. Handlers are now attached before `sock.connect(path)`.
- [x] 2.5 Run the smoke script on this machine; fix any defects it uncovers in the launch path
  - youtube-music: PASS (`✓ playing: position 205ms / 226421ms, volume 20%`). soundcloud: PASS with a SC-native upload (`✓ playing: position 225ms / 217000ms`). Major-label tracks (Daft Punk, Boards of Canada) 404 on the stream endpoint — SoundCloud serves those as Go+ 30s previews only (confirmed via yt-dlp returning a `cf-preview-media` URL); licensing restriction, not a launch-path defect.

## 3. Security audit and hardening

- [x] 3.1 Verify secret-file hygiene: tokens.json/config.json 0600 in 0700 dir, re-hardened on read; grep error/log paths for token leakage; record outcome
  - CHECKED, NO ISSUE. `hardenSecretFile` (0600) runs on every read and write of tokens.json/config.json; `ensureSecretDir` creates the config dir 0700; `tests/secret-perms.test.ts` passes. Grep of all `console.*`/thrown-error paths found no token or API-key material — auth errors only include Spotify's HTTP status/body, and the fallback-printed auth URL contains only public values (client_id, PKCE challenge).
- [x] 3.2 Verify subprocess argv safety (mpv, browser openers, claude-cli); add `https:`/loopback scheme guard in `openBrowser`
  - VERIFIED + GUARD ADDED. All subprocess launches (`mpv`, clipboard utils, `claude` CLI, browser openers) use `Bun.spawn` argv arrays — no shell interpolation anywhere; the one shell-interpreted string (PowerShell `Start-Process` on Windows/WSL) already escapes single quotes. `openBrowser` now rejects anything that isn't `https:` or loopback `http:` (127.0.0.1/localhost/[::1]) before spawning.
- [x] 3.3 Move the mpv IPC socket into a 0700 per-user directory on POSIX (keep Windows named pipe unchanged); test concurrent-instance isolation still holds
  - DONE. Socket now lives at `$TMPDIR/music-agent-<uid>/mpv-<pid>.sock`; the dir is mkdir'd 0700 and re-chmod'd on every use (chmod throws if another user owns the path — refuse rather than share). Windows named pipe unchanged. pid-scoped filename keeps concurrent instances isolated; covered by the new `socketPath` unit test and verified live (dir `drwx------` during real playback).
- [x] 3.4 Verify OAuth callback hardening (127.0.0.1 bind, state check, listener teardown after completion/timeout); record outcome
  - VERIFIED + ONE GAP FIXED. Bind is 127.0.0.1 with an OS-assigned ephemeral port; `state` is checked against the in-flight login (mismatches are ignored, not fatal); PKCE with no client secret anywhere. Gap: the listener had no timeout — it now tears down after 5 minutes with a clear error, and a `finally` block guarantees server+timer teardown on every exit path (including openBrowser/exchange failures).
- [x] 3.5 Run `bun audit` (or equivalent against the lockfile); fix or document every critical/high advisory
  - CLEAN. `bun audit` (bun 1.3.11, 2026-07-12): "No vulnerabilities found".
- [x] 3.6 Review `install.sh`: HTTPS-only fetch, pinned repo, release-tag checkout; document accepted risks (bun bootstrap)
  - CHECKED, NO ISSUE. Clone/fetch is HTTPS-only from the pinned `pyfig/agent-music-spotify` repo; both installer and the generated launcher check out the latest `v*` release tag (branch tip only as fallback when no tag exists); auto-update refuses to run over local changes and only touches managed clones. ACCEPTED RISK: bun bootstrap via `curl -fsSL https://bun.sh/install | bash` — ecosystem-standard installer, HTTPS, documented here per design D4.

## 4. Wrap-up

- [x] 4.1 Full `bun test` green, including new layout and playback tests
  - 287 pass / 0 fail across 24 files (bun 1.3.11).
- [x] 4.2 Update AGENTS.md / skill notes if the socket path or layout helper changes documented contracts
  - AGENTS.md: added `ui/layout.ts` to the source map. amusic-build-and-env: socket path row updated to the 0700 per-user dir + SIGHUP hook (old `vibedeck-mpv` path was already stale). amusic-architecture-contract: socket-path invariant and grep hint updated.
