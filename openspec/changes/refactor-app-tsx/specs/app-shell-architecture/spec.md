# app-shell-architecture

## ADDED Requirements

### Requirement: App component is wiring-only
`src/app.tsx` SHALL contain only top-level screen routing (loading / wizard / main / history / lyrics-fullscreen), hook composition, and prop wiring. It SHALL NOT contain business logic (playlist resolution, taste/history persistence, playback commands, auth flows) inline; that logic MUST live in custom hooks under `src/hooks/` or modules under `src/app/` and `src/core/`.

#### Scenario: App file stays small
- **WHEN** the refactor is complete
- **THEN** `src/app.tsx` is at most ~300 lines and defines no `async function` performing IO other than delegating to hooks/modules

#### Scenario: State slices owned by hooks
- **WHEN** a state slice concerns one domain (playback, generation, settings, auth, history)
- **THEN** its `useState`/`useRef`/`useEffect` declarations live in the corresponding hook, not in `App()`

### Requirement: Single active overlay
The app SHALL represent modal overlays (model picker, backend picker, effort picker, client-id prompt, system-prompt editor, forget confirm, connect confirm, clarify, results confirm) as one discriminated-union value with at most one overlay active at a time. Opening an overlay SHALL structurally replace any other; keyboard routing and render guards MUST derive from this single value.

#### Scenario: Overlay exclusivity is structural
- **WHEN** an overlay is opened while another is active
- **THEN** the previous overlay is no longer rendered and no longer receives keyboard input, without any per-pair boolean checks

#### Scenario: Prompt input focus follows overlay state
- **WHEN** any overlay is active
- **THEN** the main prompt input is unfocused; **WHEN** no overlay is active, it is focused

### Requirement: Slash commands dispatch through a table
Slash commands SHALL be defined in a single dispatch table module (`src/app/commands.ts`) mapping command name → handler. Handlers SHALL receive an explicit context object (state accessors + actions) so they are unit-testable without rendering the TUI. Unknown `/commands` MUST produce an error message, never reach the agent.

#### Scenario: Known command executes via table
- **WHEN** the user submits `/memory`
- **THEN** the dispatcher resolves the handler from the table and executes it; no `if (trimmed === ...)` chain exists in `app.tsx`

#### Scenario: Unknown command rejected
- **WHEN** the user submits `/nope`
- **THEN** an "unknown command" error is shown and no agent call is made

### Requirement: Remote playback goes through PlayerController
All playback initiated from the app shell SHALL go through the `player` PlayerController singleton. For the Spotify backend the shell MUST use `player.setRemote(...)`/`player.playRemote(...)`; it MUST NOT construct `SpotifyClient` for playback commands directly. Backend branching for playback SHALL live inside PlayerController, not in app-shell code.

#### Scenario: Spotify play routed via facade
- **WHEN** the user presses play on a track with the spotify backend active
- **THEN** the call path is app shell → `player.playRemote(track)` → SpotifyClient, with no direct SpotifyClient playback call in `src/app.tsx` or hooks

#### Scenario: Local play unchanged
- **WHEN** the user presses play with a local backend (soundcloud / youtube-music)
- **THEN** playback still goes through the same `player` singleton mpv path, byte-for-byte identical behavior

### Requirement: Refactor is behavior-preserving
The decomposition SHALL NOT change user-visible behavior: every slash command, keyboard shortcut, overlay flow, generation/clarify flow, and playback control behaves as before. The existing test suite MUST pass unchanged (except tests that assert file structure).

#### Scenario: Existing tests stay green
- **WHEN** `bun test` runs after each refactor phase
- **THEN** all pre-existing tests pass without modification to their assertions

#### Scenario: Keyboard routing preserved
- **WHEN** the user uses double-Esc cancel, arrow-key volume, Ctrl+U mute, or history-screen navigation
- **THEN** the behavior matches the pre-refactor app
