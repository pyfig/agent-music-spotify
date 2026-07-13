# Proposal: small-window-ui-hardening

## Why

At small terminal sizes (e.g. 70×17) the TUI wastes most of the screen: the results list is capped at `max(5, height - 15)` rows, so a 24-track playlist shows ~4 tracks above a large empty void, while the input, now-playing row, and status bar cluster awkwardly. Separately, local audio startup (mpv spawn → IPC socket → playback) has no automated verification, and the codebase has never had a focused security pass despite handling OAuth tokens, spawning subprocesses, and being installed via `curl | bash`.

## What Changes

- **Responsive small-window layout**: rework the vertical space budget so the results list fills available height instead of reserving a fixed 15 rows; degrade gracefully below ~20 rows (logo already drops at <12; extend the same discipline to spacing, slash menu, and status/now-playing rows). Tighten narrow-width behavior (status bar clusters, title truncation) so nothing clips mid-word or overflows at ~60–80 columns.
- **Audio startup verification**: add automated tests around the audio launch path — `checkLocalPlaybackDeps`, mpv spawn/IPC socket handshake (via injectable `PlayerDeps` fakes), queue auto-advance, and the remote (Spotify) play path branch — plus a scripted end-to-end smoke check that confirms real mpv playback starts on this machine. Fix any defects the verification uncovers.
- **Security audit + hardening**: systematic pass over the attack surface — token/config file permissions, subprocess argument construction (mpv, browsers, claude-cli), OAuth callback listener, mpv IPC socket exposure, dependency vulnerabilities (`bun audit`), and `install.sh` supply-chain posture. Fix confirmed findings; document accepted risks.

No breaking changes.

## Capabilities

### New Capabilities

- `responsive-tui-layout`: how the TUI must behave across terminal sizes — vertical space allocation, minimum usable size, degradation order (what hides first), and narrow-width truncation rules.
- `audio-startup-verification`: verified behavior of the local audio launch path — dependency preflight, mpv spawn and IPC readiness, failure messaging, and the remote-playback branch.
- `security-baseline`: security requirements the app must satisfy — secret file permissions, subprocess argument safety, OAuth callback hardening, IPC socket scoping, and dependency hygiene.

### Modified Capabilities

None — no existing specs in `openspec/specs/`.

## Impact

- **Code**: `src/ui/ResultsList.tsx` (height budget), `src/app.tsx` (layout section ~1320–1620, `columnWidth`, `showLogo`, spacing), `src/ui/StatusBar.tsx` (narrow-width behavior); `src/music/playback.ts` and `tests/` for audio verification; targeted fixes anywhere the security audit confirms an issue (candidates: `install.sh`, `src/music/playback.ts` socket handling, dependency bumps).
- **Tests**: new `tests/` files for layout height math (extracted pure helpers), audio startup, and any security fix regressions. `bun test` remains the gate.
- **Dependencies**: possible version bumps from `bun audit`; no new runtime deps expected.
- **Constraints**: all playback flows stay behind the `player` singleton; UI components stay dumb (props/callbacks only); no change to `SCOPES` or the port-8888 callback contract.
