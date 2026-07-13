# Design — refactor app.tsx decomposition

## Context

`src/app.tsx` is 1721 lines: ~50 `useState` hooks, 5+ effects (toast, spinner/elapsed timer, boot, playback poll), a ~250-line `useKeyboard` if-chain, ~20 async handlers, a ~200-line `handleSubmit` slash-command chain, and a ~240-line render tree. The architecture contract (Decision 8) documents the failure mode: every overlay/mode addition must synchronize the keyboard chain, the overlay boolean algebra, and the render guards by hand.

Constraints from the architecture contract that this design must respect:

- `core/` stays UI-free (interfaces + callbacks only); `ui/` stays dumb (props in, callbacks out).
- `player` PlayerController is a singleton; never construct a second one.
- `isSpotifyBackend` is negatively defined — do not copy that pattern into new modules; branch on capability flags or move the branch into PlayerController.
- Decision 3 violation: `setRemote`/`playRemote` exist but have zero callers; app.tsx constructs `SpotifyClient` directly in `handlePlay` and the polling effect. The contract says: finish the facade or update the docstring — never add a third path. Moving playback code is the moment to finish it.

## Goals / Non-Goals

**Goals:**
- app.tsx ≤ ~300 lines: screen routing + hook composition + prop wiring.
- One overlay value; modal exclusivity structural.
- Slash commands in a testable dispatch table.
- Close the PlayerController facade violation for playback commands and polling.
- Zero user-visible behavior change; existing tests pass unchanged.

**Non-Goals:**
- No provider registry (the "provider shotgun surgery" weak point is a separate change).
- No changes to `agent/`, `music/types.ts`, `spotify/auth.ts`, resolve pipeline, prompts, config schema.
- No new features, no UI redesign, no fixing the `TASTE_DIR` cwd issue.
- No state-management library (no zustand/jotai) — plain hooks, same React model.

## Decisions

### D1: Decompose by domain into custom hooks, not by React pattern

Split along state-ownership lines already visible in the code:

| Hook | Owns | Extracted from |
|---|---|---|
| `useAppConfig` | `config`, `screen`, boot effect, `onSaveField`, wizard handoff | boot `useEffect`, `onSaveField` |
| `useAuthFlow` | `authed`/`authedRef`, `connecting`, `confirmConnect`, `pendingPrompt`, `runLoginAndResume`, `handleClientIdSubmit` | app.tsx:630–691 |
| `usePlayback` | `currentlyPlayingUri`, `isPlaying`, `trackPos`, `volume`, `mutedVolume`, poll effect, `applyVolume`/`adjustVolume`/`toggleMute`, `handlePlay` | poll effect (app.tsx:247–305), volume fns, `handlePlay` (1321+) |
| `useGeneration` | `loading`, `progress`, `tokenCount`, `startTime`, `elapsed`, `spinnerFrame`, `events`, `resolved`, `committedPlaylist`, `awaitingConfirm`, clarify state (questions/step/answers/custom), `abortRef`, `clarifyResolverRef`, `runResolve`, `savePlaylist`, cancel/drain logic | app.tsx:824–1111, spinner effect |
| `useTasteActions` | `memoryText`, session header ref, prior-playlist ref, like/memory/forget actions, `recordTasteSession` | taste blocks in handleSubmit + 935–962 |
| `useHistoryScreen` | `historyEntries`, `historyDetail`, scroll ref, `loadHistorySession`, `recordHistorySession` | 963–1063 + history keyboard block |
| `useToast` | `toast`, `show()` | toast effect |

Hooks return `{ state..., actions... }` objects; `App()` composes them and passes slices down. Cross-hook needs (e.g. generation needs `authedRef`, playback needs `resolved`) are passed as explicit arguments to the hook — dependencies stay visible at the composition site.

*Alternative considered:* single `useReducer` mega-store. Rejected: recreates the monolith as one reducer; hooks keep domains separately testable and diffs reviewable.

*Alternative considered:* React Context per domain. Rejected: only one consumer tree, no prop-drilling pain that justifies it; explicit props are easier to trace in a TUI app.

### D2: Overlay discriminated union in `src/app/overlay.ts`

```ts
export type Overlay =
  | { kind: "model-picker" }
  | { kind: "backend-picker" }
  | { kind: "effort-picker" }
  | { kind: "client-id"; text: string; error?: string }
  | { kind: "system-prompt"; text: string }
  | { kind: "forget-confirm" }
  | { kind: "connect-confirm" }
  | { kind: "memory"; text: string }
  | null;
```

One `useState<Overlay>` in `App()` (or a tiny `useOverlay` hook). Opening replaces; `Esc` semantics per-kind handled in one `switch`. Clarify and results-confirm stay inside `useGeneration` (they are pipeline states, not chrome overlays), but render guards derive from `overlay === null && ...` uniformly. `PromptInput.focused` = `overlay === null && !clarifyActive && !awaitingConfirm && screen === "main"` — computed once, passed down.

*Alternative considered:* keep booleans, add an invariant assertion. Rejected: assertion catches the bug at runtime; the union makes it unrepresentable.

### D3: Slash-command dispatch table in `src/app/commands.ts`

```ts
export interface CommandCtx { /* narrow accessors + actions from hooks */ }
export type CommandHandler = (ctx: CommandCtx, arg: string) => Promise<void>;
export const commands: Record<string, CommandHandler> = { "/model": ..., "/like": ..., ... };
export function dispatchCommand(input: string, ctx: CommandCtx): Promise<boolean>;
```

`dispatchCommand` returns `false` for non-command input (falls through to generation), shows "unknown command" for unmatched `/x`. Commands taking arguments (`/like <comment>`) parse the arg themselves. `CommandCtx` is an interface, so tests inject fakes — no React rendering needed. `SlashMenu`'s command list derives from the same table (single source for names + descriptions), eliminating the drift risk between menu and handler chain.

### D4: Finish the PlayerController facade for playback commands

Move remote branches out of the shell:

- `handlePlay` (in `usePlayback`): call `player.setRemote(spotifyClient)` when backend is spotify (client built from `getAccessToken` at call time, as today), then `player.playRemote(track)` / pause/resume via facade methods. Local path unchanged (`player.play*` mpv path).
- Polling effect: add `player.getCurrentlyPlayingUnified()` (or extend existing `getCurrentlyPlaying`) so the poll in `usePlayback` calls one method; PlayerController internally asks mpv or the remote client. Token refresh per poll stays — pass a token-provider callback into `setRemote` rather than a static client if expiry mid-session is a concern (decide at implementation; today's code builds a fresh client per poll).
- Update the playback.ts docstring only after the last direct `SpotifyClient` playback call is gone; `grep -rn "setRemote\|playRemote" src` must show real callers.

Backend branching moves from `isSpotifyBackend` string-negation checks to capability flags (`music.capabilities.remotePlayback`) where the shell still needs to know (auth gating for generation stays — that is auth, not playback).

*Alternative considered:* leave facade violation as-is, just move code. Rejected by contract: "do not add a third ad-hoc path"; copying the violation into `usePlayback` cements it.

### D5: Keyboard routing stays in one place, delegating to hooks

Keep a single `useKeyboard` in `App()` (opentui gives one global key stream; splitting it across hooks re-creates ordering ambiguity). The handler becomes a thin router: ordered `switch` over app mode (history screen → overlay kind → clarify → confirm → main), each branch delegating to an action from the owning hook. Target ≤ ~100 lines. ModelPicker keeps owning its internal keys (existing behavior).

### D6: Render extraction

`src/ui/MainScreen.tsx` takes the assembled props (lines, progress, playback bar, lyric panel state, overlay element) and renders the main layout. Stays dumb. `App()`'s return becomes: wizard | history | lyrics-fullscreen | `<MainScreen ...>`.

## Risks / Trade-offs

- [Keyboard/focus regression — subtle ordering in the if-chain] → phase-by-phase extraction (one hook per commit), `bun test` after each, drive TUI via run-music-agent skill after each phase; keyboard router keeps the same guard order as the original chain.
- [Facade completion changes playback call path, not just location] → it is the one deliberately behavior-adjacent piece; verify per-backend manually (spotify play/pause/volume, ytm play) and keep the change in its own commit for easy revert.
- [Hook interdependencies turn into prop-drilling soup] → allow hooks to take other hooks' returned objects as params; if a cycle appears, merge those two hooks rather than adding refs/events.
- [Stale-closure bugs when moving effects] → keep existing `ref` mirrors (`authedRef`, `clarifyResolverRef`) with their owning hooks; do not "clean up" refs during the move.
- [Big diff hard to review] → tasks ordered so each step compiles + passes tests independently; no step both moves and rewrites logic.

## Migration Plan

Pure refactor, no data/config migration. Rollback = revert commits (each phase is standalone). No deploy considerations (local CLI).

## Open Questions

- `setRemote` receives a client instance vs a token-provider callback (token expiry mid-session) — decide when touching `usePlayback`; default to today's build-per-call semantics to stay behavior-preserving.
- Whether `memoryText` display becomes an overlay kind (`memory`) or stays inline text — default: overlay kind, since it already behaves modally.
