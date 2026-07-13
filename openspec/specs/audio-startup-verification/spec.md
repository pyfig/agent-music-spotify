## Purpose

Guarantee local playback starts verifiably: dependency preflight, bounded mpv IPC handshake, queue auto-advance, and a manual end-to-end audio smoke check.

## Requirements

### Requirement: Local playback dependency preflight
Before any local playback attempt, the app SHALL verify required binaries (mpv; yt-dlp additionally for youtube-music) and, when one is missing, SHALL surface an actionable install hint instead of a spawn error. This check SHALL run at startup for local backends and on every backend switch.

#### Scenario: mpv missing
- **WHEN** a local backend is active and mpv is not on PATH
- **THEN** the user sees an error naming mpv with an install command hint, and no playback is attempted

### Requirement: mpv startup handshake is verified and bounded
Starting local playback SHALL spawn a single idle mpv process, wait for its JSON-IPC socket to become connectable within a bounded timeout, and fail with a clear "mpv IPC socket did not appear" style error if it does not. This behavior SHALL be covered by automated tests using injectable player dependencies (no real mpv in unit tests).

#### Scenario: Socket appears in time
- **WHEN** play is requested and the (fake) mpv creates its IPC socket
- **THEN** the controller connects, issues the load command, and reports the track as playing

#### Scenario: Socket never appears
- **WHEN** play is requested and the IPC socket never becomes connectable
- **THEN** the controller fails within the timeout with an error that names the socket problem, and no zombie handle is retained

### Requirement: Queue auto-advance on track end
When mpv reports end-of-file for the current track, the controller SHALL automatically start the next queued track, and SHALL stop cleanly (no error) after the final track.

#### Scenario: Mid-queue advance
- **WHEN** track N of a queued local playlist ends normally
- **THEN** track N+1 begins playing without user input

### Requirement: End-to-end audio smoke check
The repo SHALL provide a scripted smoke check that, on a machine with real mpv installed, starts playback of a known-resolvable track and confirms audio output begins (mpv reaches playing state via IPC) within a bounded time. It SHALL be runnable manually and excluded from `bun test`.

#### Scenario: Smoke check passes on healthy machine
- **WHEN** the smoke check runs on a machine with mpv installed and network access
- **THEN** it reports success only after mpv confirms playback started, and exits non-zero otherwise
