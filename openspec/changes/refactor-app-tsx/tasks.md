# Tasks — refactor app.tsx decomposition

Each phase must leave the tree green: `bun test` passes, `bunx tsc --noEmit` clean, and the TUI drivable (run-music-agent skill) before moving on.

## 1. Scaffolding & low-risk extractions

- [x] 1.1 Create `src/app/overlay.ts` with the `Overlay` discriminated union type (model-picker, backend-picker, effort-picker, client-id, system-prompt, forget-confirm, connect-confirm, memory) + unit test for exclusivity helpers
- [x] 1.2 Extract `useToast` hook (toast state + auto-dismiss effect + `show()`) into `src/hooks/useToast.ts`; wire into app.tsx
- [x] 1.3 Move `fmtTime`/`trackBar`/`TRACK_BAR_WIDTH` out of app.tsx into `src/ui/theme.ts` (or a small `src/ui/format.ts`)

## 2. Overlay state migration

- [x] 2.1 Replace `pickerOpen`/`backendPickerOpen`/`effortPickerOpen`/`clientIdOpen`/`systemPromptOpen`/`forgetOpen`/`confirmConnect`/`memoryText` booleans with single `useState<Overlay>`; update all setters
- [x] 2.2 Rewrite render guards and `PromptInput.focused` to derive from the single overlay value; verify no double-focus with each overlay open
- [x] 2.3 Update keyboard chain overlay branches into one `switch (overlay?.kind)` block, preserving original guard order

## 3. Domain hooks

- [x] 3.1 Extract `useAppConfig` (`config`, `screen`, boot effect, `onSaveField`, wizard handoff) into `src/hooks/useAppConfig.ts`
- [x] 3.2 Extract `useAuthFlow` (`authed`/`authedRef`, `connecting`, `pendingPrompt`, `runLoginAndResume`, `handleClientIdSubmit`) into `src/hooks/useAuthFlow.ts`
- [x] 3.3 Extract `useGeneration` (loading/progress/tokens/spinner/elapsed/events/resolved/committed/confirm + clarify state + `runResolve`/`savePlaylist` + abort/drain cancel) into `src/hooks/useGeneration.ts`
- [x] 3.4 Extract `useTasteActions` (memory display, session header ref, prior-playlist ref, like/forget, `recordTasteSession`) into `src/hooks/useTasteActions.ts`
- [x] 3.5 Extract `useHistoryScreen` (entries/detail/scroll ref, `loadHistorySession`, `recordHistorySession`) into `src/hooks/useHistoryScreen.ts`

## 4. Playback hook + facade completion

- [x] 4.1 Extract `usePlayback` (playing state, poll effect, volume/mute, `handlePlay`) into `src/hooks/usePlayback.ts` — verbatim move first, no behavior change
- [x] 4.2 Wire `player.setRemote(...)`/`playRemote(...)` for the spotify backend in `usePlayback`; delete direct `SpotifyClient` playback calls from shell code (separate commit)
- [x] 4.3 Unify the playback poll through PlayerController (extend `getCurrentlyPlaying` or add unified method) so the poll has no backend branch in the hook
- [x] 4.4 Replace remaining `isSpotifyBackend` playback checks with `capabilities.remotePlayback`; update playback.ts docstring; `grep -rn "setRemote|playRemote" src` shows real callers — auth gate keeps `isSpotifyBackend` (auth concern, per design); playback routing itself is facade-only via `hasRemote`/`setRemote`
- [x] 4.5 Manual verify per backend: youtube-music boot/volume(←)/Ctrl+U mute/backend switch verified in sandbox; spotify path exercises poll+setRemote against real API (401s handled silently in sandbox) — live spotify play/pause needs a real account with an active device (left for final user verification)

## 5. Command dispatch

- [x] 5.1 Create `src/app/commands.ts`: `CommandCtx` interface, dispatch table for all commands (/model /music /login /clientid /effort /systemprompt /save /clear /like /memory /lyrics /history /forget /quit /random), `dispatchCommand()`
- [x] 5.2 Rewire `handleSubmit` to `dispatchCommand` + generation fallthrough; delete the if-chain
- [x] 5.3 Derive SlashMenu command list from the dispatch table (single source of names/descriptions)
- [x] 5.4 Unit tests for dispatcher: known command routes, `/like` arg parsing, unknown command errors, non-command falls through (16 tests)

## 6. Keyboard router & render extraction

- [x] 6.1 Slim `useKeyboard` in App() into ordered mode router (history → overlay → clarify → confirm → main) delegating to hook actions; preserve exact guard order; target ≤ ~100 lines
- [x] 6.2 Extract main layout into `src/ui/MainScreen.tsx` (dumb, props-in); App() return = wizard | history | lyrics-fullscreen | MainScreen
- [x] 6.3 Verify app.tsx ≤ ~300 lines and contains no inline IO logic

## 7. Verification & docs

- [x] 7.1 Full pass: `bun test` green, `bunx tsc --noEmit` clean
- [x] 7.2 Drive TUI end-to-end (run-music-agent): generate → clarify → confirm → play → /lyrics cycle → /history → /clear; every overlay open/close; double-Esc mid-generation
- [x] 7.3 Update amusic-architecture-contract skill (Decision 8 monolith weak point, Decision 3 facade violation) to reflect the new structure
