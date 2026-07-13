## Why

New users currently default to the Spotify backend, which demands a client ID + PKCE browser login before anything plays; YouTube Music works out of the box (mpv + yt-dlp, no account), so it is the better first-run default. Separately, the thinking phase reuses the same braille spinner as every other loading state, giving the user no visual cue that the LLM is reasoning (vs. resolving tracks) — a distinct thinking animation makes the agent's phase legible at a glance.

## What Changes

- **BREAKING (behavioral)**: default `musicBackend` changes from `"spotify"` to `"youtube-music"` when neither `MUSIC_BACKEND` env nor `config.json` sets one. Existing users with a saved backend are unaffected (env > file > default precedence unchanged).
- First-run experience no longer routes into the Spotify ClientIdPrompt/PKCE flow by default; instead it may surface the mpv/yt-dlp install hint from `checkLocalPlaybackDeps` if those binaries are missing.
- New dedicated thinking spinner: a distinct frame set shown while the agent phase is `thinking`, in the StatusBar right cluster and the ReasoningTranscript header. The existing braille `SPINNER` remains for non-thinking loading states (e.g. resolving).
- Fix synced lyrics (broken at runtime): raise the LRCLIB timeout 5 s → 15 s (measured latency 7–12 s), dedupe in-flight requests per track so the 1.5 s playback poll no longer aborts its own fetch, stop caching timeouts/aborts as permanent "no lyrics" (only definitive 200/404 outcomes are cached), and add an `/api/search` fallback on definitive 404 (closest-duration synced candidate) as insurance for duration/title variants.

## Capabilities

### New Capabilities

- `default-music-backend`: which music backend the app selects when the user has not configured one, and how precedence (env > file > default) interacts with that default.
- `thinking-spinner`: distinct spinner animation for the LLM thinking phase, rendered consistently in the StatusBar and the reasoning transcript header.

### Modified Capabilities

- `synced-lyrics` (openspec/specs/synced-lyrics/spec.md): LRCLIB lookup gains a fuzzy `/api/search` fallback so lyrics actually resolve with youtube-music/soundcloud metadata; per-track miss caching unchanged.

## Impact

- `src/config.ts` — default fallback in the `musicBackend` `??` chain (line ~139).
- `src/ui/theme.ts` — new `THINKING_SPINNER` frame set exported next to `SPINNER`.
- `src/ui/StatusBar.tsx` — choose spinner by `progress.phase`; right-cluster width reservation must fit the widest new frame.
- `src/ui/ReasoningTranscript.tsx` — header glyph uses the thinking spinner.
- `src/app.tsx` — no state changes expected; `spinnerFrame` timer already drives frames. Verify SetupWizard/first-run gating (`providerChosen`/`isConfigured`) still behaves with the new default.
- `src/lyrics/client.ts` — `/api/search` fallback inside `fetchFromLrclib`; candidate selection by duration proximity.
- Tests: config default test, spinner selection tests, LRCLIB fallback cases in `tests/lrclib-client.test.ts`; existing snapshot tests may need regeneration.
- Docs: AGENTS.md module notes if they name the default backend.
