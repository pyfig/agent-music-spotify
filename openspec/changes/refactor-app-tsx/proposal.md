# Refactor app.tsx — decompose the monolith

## Why

`src/app.tsx` is a 1721-line monolith: one component owning ~50 `useState` hooks, a ~250-line `useKeyboard` if-chain, a ~200-line `handleSubmit` slash-command dispatcher, and all orchestration (auth, playback, generation, taste, history, lyrics). The architecture contract (amusic-architecture-contract, Decision 8) names it the codebase's top weak point: every new mode/overlay must touch at least three scattered lists (keyboard chain, overlay boolean algebra, render guards), and missing one produces double-focus bugs. The file has grown ~50% since the contract was written (1177 → 1721 lines) and each feature (lyrics, history, effort picker) made it worse.

## What Changes

- Decompose `App()` into focused custom hooks under `src/hooks/` (playback, generation/clarify, settings/pickers, auth, history, taste actions), each owning its own state slice. Behavior-preserving — no user-visible change.
- Replace the N independent overlay booleans (`pickerOpen`, `backendPickerOpen`, `effortPickerOpen`, `clientIdOpen`, `systemPromptOpen`, `forgetOpen`, confirm/clarify flags) with a single `overlay` discriminated union, making modal exclusivity structural instead of hand-enforced.
- Extract slash-command handling from `handleSubmit` into a dispatch table module (`src/app/commands.ts`) with per-command handlers, unit-testable without React.
- Extract the main-screen render tree into `src/ui/MainScreen.tsx` (still dumb, props-in/callbacks-out); `app.tsx` shrinks to wiring + top-level routing (loading/wizard/main).
- While moving playback logic: route remote (Spotify) playback through the existing `PlayerController.setRemote`/`playRemote` facade, deleting the direct `SpotifyClient` playback branches in app code — closes the documented facade violation (Decision 3) instead of copying it into a new module.
- Keep `core/` UI-free and `ui/` dumb; no changes to `agent/`, `music/`, `spotify/` public interfaces.
- All existing tests stay green; new unit tests for the command dispatcher and overlay reducer.

## Capabilities

### New Capabilities
- `app-shell-architecture`: structural requirements for the TUI app shell — module boundaries (hooks own state slices, app.tsx only wires), single-overlay exclusivity model, slash-command dispatch table, remote playback routed through the PlayerController facade.

### Modified Capabilities

None — `audio-startup-verification`, `default-music-backend`, `responsive-tui-layout`, `security-baseline`, `synced-lyrics`, `thinking-spinner` keep their requirements unchanged; this refactor must not alter their observable behavior.

## Impact

- **Rewritten/split:** `src/app.tsx` (shrinks to ≲300 lines of wiring).
- **New files:** `src/hooks/usePlayback.ts`, `src/hooks/useGeneration.ts`, `src/hooks/useSettings.ts`, `src/hooks/useAuth.ts`, `src/hooks/useHistoryScreen.ts`, `src/app/commands.ts`, `src/app/overlay.ts`, `src/ui/MainScreen.tsx`.
- **Touched:** `src/music/playback.ts` docstring (facade violation closed); no interface changes elsewhere.
- **Tests:** existing suite must pass unchanged; new tests for command dispatch and overlay state.
- **Risk:** regression in keyboard routing / modal focus — mitigated by moving state in small, individually verifiable steps and driving the TUI (run-music-agent skill) after each phase.
