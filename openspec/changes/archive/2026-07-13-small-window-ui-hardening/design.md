# Design: small-window-ui-hardening

## Context

Three loosely coupled workstreams under one change:

1. **Small-window layout.** `ResultsList.tsx:57` computes `maxHeight = Math.max(5, height - 15)` — a hardcoded budget assuming logo + ConfirmActions + input + status are all present. At 17 rows this yields 5, so the list shows ~4 tracks while flex layout leaves a multi-row void between the input cluster and the bottom-pinned footer. `app.tsx` already has partial degradation (`showLogo` at `height >= 12`, `slashMaxVisible` tiers) but the reserved-row constant defeats it.
2. **Audio startup.** `PlayerController` (`src/music/playback.ts`) is a singleton facade over one idle mpv driven by JSON-IPC on a pid-scoped socket, with `PlayerDeps.startMpv` injectable for tests. `checkLocalPlaybackDeps` preflights mpv/yt-dlp. Existing tests don't cover the spawn→socket-wait→load→auto-advance chain end to end.
3. **Security.** Strong baseline already exists: PKCE with no client secret, `state` verified, listener bound to 127.0.0.1, `hardenSecretFile` chmods tokens/config to 0600, subprocesses use `Bun.spawn` argv arrays, PowerShell URL path escapes quotes. Remaining unknowns: mpv IPC socket permissions on multi-user machines, dependency advisories, `install.sh` posture, and whether any error path can leak token material.

Constraints (from architecture contract): UI components stay dumb; all local playback goes through the `player` singleton; don't change `SCOPES` or the port-8888 contract; `bun test` is the only automated gate (no typecheck script, no CI).

## Goals / Non-Goals

**Goals:**
- Usable, void-free layout at 70×17 and sane behavior down to ~12 rows / ~60 cols.
- Deterministic unit coverage of the audio launch path plus one manual real-mpv smoke script.
- Verified security baseline with confirmed findings fixed and non-findings documented.

**Non-Goals:**
- Refactoring the app.tsx monolith or building a provider registry.
- Finishing the PlayerController remote facade (`setRemote`/`playRemote` dead code) — out of scope unless an audio defect forces it.
- New UI features, theme changes, or supporting terminals narrower than 40 columns.
- Penetration testing of external services (Spotify, SoundCloud, YouTube).

## Decisions

### D1 — Measure remaining space instead of reserving rows

Replace the `height - 15` constant with a budget computed from what is actually rendered: App passes ResultsList the rows consumed below it (input cluster height, ConfirmActions when awaiting confirm, now-playing row when playing, status bar, padding). Extract the computation into a pure helper (e.g. `layoutBudget(height, flags)` in `src/ui/theme.ts` or a new `src/ui/layout.ts`) so it is unit-testable without a renderer.

*Alternative considered:* pure flexbox (drop maxHeight entirely, let the scrollbox flex). Rejected: the comment at ResultsList.tsx:54–57 shows maxHeight exists to keep the input cluster anchored directly under the list; naive flex reintroduces the input-jumps-around problem.

### D2 — Degradation stays declarative in App

Keep the existing pattern (`showLogo`, `slashMaxVisible`) and extend it with the same helper: thresholds live in one place, components receive booleans/numbers via props. No component reads terminal dimensions except through props or the shared helper — reduces the scattered `useTerminalDimensions` calls that currently disagree (app.tsx vs ResultsList).

### D3 — Audio tests via injectable deps; smoke test as a script

Unit tests inject a fake `startMpv` returning a scripted `MpvHandle` (socket appears / never appears / emits `end-file`) — same seam `PlayerDeps` already exposes, so no production changes needed to test. The real-mpv smoke check is a standalone `scripts/audio-smoke.ts` (run with `bun scripts/audio-smoke.ts`), not a `bun test` file, because it needs mpv + network and must never gate the suite.

*Alternative considered:* mocking at the socket layer with a real mpv binary in tests. Rejected: nondeterministic in sandboxed/CI-less environments; the skill contract forbids launching the app from automated sessions.

### D4 — Security work is audit-then-fix, scoped by the spec

The `security-baseline` spec enumerates the checks (secret perms, argv safety, OAuth callback, IPC socket scoping, dependency/install hygiene). Implementation = run each check against the code, fix confirmed gaps, and record "checked, no issue" outcomes in the tasks file rather than inventing fixes for non-problems. Known likely fixes going in: put the mpv socket in a 0700 per-user directory (current `tmpdir()` path is world-traversable on shared machines) and add an `https:`/loopback scheme guard in `openBrowser` (defense in depth; URL is currently always accounts.spotify.com).

### D5 — One change, three capabilities

Kept as a single change because the user requested them together and each is small; specs stay separate so archive produces three clean capability specs. Tasks are grouped per workstream and independently completable.

## Risks / Trade-offs

- [opentui flex quirks: computed heights may interact badly with `scrollbox`] → keep `minHeight: 5` floor; verify visually at 70×17, 80×24, 120×40 via the run skill before completion.
- [Layout helper drifts from actual rendered heights (e.g. new overlay added later)] → helper takes explicit flags; unit tests document the row math; comment in App points to the helper as the single budget source.
- [Fake-mpv tests pass while real mpv breaks] → that gap is exactly what `scripts/audio-smoke.ts` covers; document it as a manual pre-release step.
- [`bun audit` may flag transitive advisories with no upstream fix] → spec allows documented acceptance per advisory instead of forced downgrades.
- [Socket-dir permission change could break Windows named-pipe path] → gate the chmod/dir logic to non-win32; pipe namespace is already per-user on Windows.

## Migration Plan

No data or config migration. Layout changes are render-only; socket path change only affects fresh mpv spawns (old pid-scoped sockets are abandoned naturally on exit). Rollback = revert the commit.

## Open Questions

- Does the now-playing footer row (app.tsx ~1579) need its own narrow-width truncation rule, or does existing width math already cover 60 cols? Verify during implementation.
- Is `install.sh`'s bun bootstrap (`curl https://bun.sh/install | bash`) in scope for hardening, or accepted as the ecosystem-standard bootstrap? Default: document as accepted risk.
