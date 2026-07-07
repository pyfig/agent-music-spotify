---
description: amusic/vibedeck — Bun + @opentui/react terminal app that turns a mood into a Spotify playlist via an AI agent. Repo-specific rules for OpenCode sessions.
---

# amusic / vibedeck

Bun + [@opentui/react](https://github.com/anomalyco/opentui) TUI: an AI agent picks tracks, a music backend (Spotify / SoundCloud / YouTube Music) resolves and plays them.

## Toolchain: Bun only

No Node, npm, pnpm, yarn, vite, express, jest, vitest, better-sqlite3, dotenv. Bun auto-loads `.env`.

- Run app: `bun run dev` (= `bun run src/index.tsx`)
- Tests: `bun test` (single file: `bun test tests/auth.test.ts`; pattern: `bun test -t "scope mismatch"`)
- Inspect internals without the TUI: `bun -e 'import { loadConfig } from "./src/config"; console.log(await loadConfig())'`
- File IO: prefer `Bun.file` / `Bun.write` over `node:fs`.

## Naming — four names, one project, do not "fix" one into another

| Name | What |
|---|---|
| `amusic` | installed user-facing command (`install.sh` links `~/.local/bin/amusic`) |
| `vibedeck` | npm package name + `bin` name (`package.json`) |
| `spotify-harness-tui` | local dir name + config dir `~/.config/spotify-harness-tui/` (hardcoded in `src/config.ts`) |
| `agent-music-spotify` | GitHub repo (`pyfig/agent-music-spotify`) |

The `~/.config/spotify-harness-tui/` path is app behavior — renaming it is a breaking change for every user's `tokens.json` + `config.json`.

## Never launch the TUI in an agent terminal (non-negotiable)

Do not run `bun run dev`, `bun src/index.tsx`, `./install.sh`, or `bun e2e_check.ts` directly. The app is full-screen @opentui/react: it seizes the TTY and never returns. On launch, `app.tsx` checks auth in a mount effect — with a stale `tokens.json` (expired / scope mismatch) `getAccessToken()` falls through to the full PKCE flow and **opens the user's real browser with no confirmation**. `install.sh` and `e2e_check.ts` hit the same path and touch the real network.

Always drive the app through the tmux driver with a sandboxed `HOME`:

```bash
.claude/skills/run-vibedeck/driver.sh start        # sandboxed launch, prints screen
.claude/skills/run-vibedeck/driver.sh cap          # capture current screen
.claude/skills/run-vibedeck/driver.sh type "/"     # type literal text
.claude/skills/run-vibedeck/driver.sh keys Down    # tmux send-keys: Enter, Down, Tab, Escape, C-p, C-c
.claude/skills/run-vibedeck/driver.sh stop
```

One key per `keys` call — `keys Down Down Enter` loses the Downs (state doesn't settle). Sandbox mode pre-seeds fake tokens whose `scopes` match `SCOPES` and uses `/tmp/vibedeck-sandbox` as `HOME`; real Spotify calls 401 there (expected). `start --real` uses your real `HOME` and will open the browser if not logged in — only with user intent.

## No CI — every gate is local and manual

There is no `.github/` directory; nothing runs on push. `bun test` is the only automated gate. Before committing:

- [ ] `bun test` → all pass
- [ ] `bunx tsc --noEmit` → clean (the agent axis now has structured `AgentResult` return types; legacy `Promise<string>` callers must `.text`)
- [ ] Secrets sweep on the diff → `git diff | grep -inE 'sk-[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]{20,}|[0-9a-f]{32}' || echo clean` (lockfile hashes are the known false positive)
- [ ] TUI-visible change → verified via `driver.sh cap`, not eyeballed from code
- [ ] `auth.ts` touched → explicit callout in commit body; SCOPES touched → SCOPES checklist below
- [ ] `agent/types.ts` touched → back-compat sweep: every `provider.generate(...)` caller must destructure `.text` (legacy `await provider.generate(...)` no longer returns a string)

## No secrets in the repo

`DEFAULT_CLIENT_ID` in `src/config.ts` is **deliberately** the placeholder `"change this id on https://developer.spotify.com/dashboard"`. Do not replace it with a real 32-hex Spotify client ID in a commit — real IDs come from `SPOTIFY_CLIENT_ID` env or the user's `config.json`. Provider keys (`OPENAI_API_KEY`, `OPENAI_SUBS_TOKEN`, `OPENCODE_*_API_KEY`, `SOUNDCLOUD_CLIENT_ID`) default to `""` and providers throw at generate time if unset — keep that, never hardcode a "test key".

## Three-place doc-sync rule

Every env var / config key lives in exactly three places, updated **in the same commit**:

1. `src/config.ts` (env → file-config → default fallback)
2. `AGENTS.md` (Project environment variables below)
3. `README.md` (Config section)

Audit: `grep -c FOO src/config.ts AGENTS.md README.md` — all three should be ≥ 1.

## SCOPES changes — double blast radius

`SCOPES` (top of `src/spotify/auth.ts`) feeds `scopesSatisfy()`. Cached tokens whose scopes don't cover current `SCOPES` are **deleted**, forcing a full browser re-login for every user. Changing `SCOPES` also **breaks the driver fixtures** — update the tokens heredoc in `.claude/skills/run-vibedeck/driver.sh` in the same commit. Checklist: justify new scope in commit body → `bun test` (scope-mismatch cases in `tests/auth.test.ts`) → update driver.sh heredoc → `driver.sh start` once, confirm status bar shows `spotify ✓`.

`src/spotify/auth.ts` has the most incident history of any file (WSL browser launch via `powershell.exe`, port-8888 zombie-killer heuristic, scope-mismatch invalidation). Don't "simplify" the platform ladder in `openBrowser()`.

## Architecture

Two plugin axes; everything funnels through two interfaces:

```
src/
  index.tsx                 entry: opentui renderer + kill mpv on exit/SIGINT/SIGTERM
  app.tsx                   THE App component — all state + orchestration (sole place wiring concretes)
  config.ts                 config load/save; precedence env > file > default
  agent/
    types.ts                AgentProvider + AgentResult + GenerateOptions + ToolSpec (the whole LLM axis contract)
    parse.ts                JSON extraction/validation + withRetry
    prompts.ts              all system/user prompts (generate, generate-agent, clarify, random pool)
    tools.ts                MUSIC_AGENT_TOOLS + family-specific tool-schema transforms + dispatchTool
    loop.ts                 agent loop driver: generate → dispatch tools → multi-turn tool results → finalize_playlist
    providers/              claude-cli, ollama, opencode, openai (all return AgentResult; HTTP/ollama carry tools + reasoning)
  music/
    types.ts                Track, MusicProvider, ProviderCapabilities, MusicBackend
    factory.ts              createMusicProvider(config) — the only backend switch
    playback.ts             PlayerController facade + mpv JSON-IPC + singleton `player`
    soundcloud/             auth.ts (client_id scraping), client.ts
    ytmusic/                client.ts (wraps ytmusic-api)
  spotify/
    auth.ts                 PKCE flow, token cache, scope check, port-8888 listener
    client.ts               Spotify Web API: search/playlists/playback, 429 handling
  core/
    generate-playlist.ts    agent-loop entry + legacy worker-pool URI resolve + named-artists merge
    taste.ts                markdown taste memory + LLM rotation + tasteForClarify artist-name channel
  ui/                       dumb presentational components only — no IO, no business logic
                            DonutAnimation + ReasoningPane render reasoning tail beside the spinning donut
tests/                      bun test; provider-contract.test.ts covers all backends,
                            agent-loop.test.ts covers finalize_playlist/clarify tool/maxIterations,
                            agent-tools.test.ts covers tool-spec family transforms + dispatchTool
```

Layering: `core/` depends only on `agent/types.ts` + `music/types.ts`, never on concretes, React, or `ui/`. `ui/` components receive props + callbacks only. `app.tsx` is the sole place that wires concretes together.

## Local backends — external binaries, not npm packages

SoundCloud and YouTube Music play through `mpv` (JSON IPC over a socket `playback.ts` creates); YouTube Music also needs `yt-dlp`. Both are checked at startup. Spotify plays via Spotify Connect (remote, needs the Spotify app open on some device). Switch backend at runtime with **Ctrl+B** or `MUSIC_BACKEND` env / `musicBackend` config.

## Deeper context (load when relevant)

These `.claude/skills/` skills hold the load-bearing detail — they're gitignored and local to this checkout:

- `amusic-architecture-contract` — invariants, why-X decisions
- `amusic-change-control` — full change classes, gates, the table that maps diff scope → required tests
- `amusic-debugging-playbook` / `amusic-failure-archaeology` — symptom → cause triage
- `amusic-build-and-env` — install paths, binary deps, self-updating CLI wrapper
- `run-vibedeck` — driver flows, verified user paths, gotchas
- `music-apis-reference` — external API endpoints/quirks

## Project environment variables

- `MUSIC_BACKEND` — `spotify` (default) | `soundcloud` | `youtube-music`.
- `SPOTIFY_CLIENT_ID` — Spotify app client ID (32 hex); invalid value silently ignored, falls back to built-in `DEFAULT_CLIENT_ID`.
- `SOUNDCLOUD_CLIENT_ID` — api-v2 client_id; optional — auto-scraped from soundcloud.com and cached in config when unset.
- `YTMUSIC_COOKIE` — reserved for future YouTube Music library access; search + playback are anonymous.
- `DEFAULT_PROVIDER` — `claude-cli` (default) | `ollama` | `opencode-go` | `opencode-zen` | `openai`. Selectable at runtime via `/model` or **Ctrl+P**.
- `OLLAMA_URL` / `OLLAMA_MODEL` — local Ollama daemon URL + model (defaults `http://127.0.0.1:11434` / `llama3`). Not sandboxed — a real daemon shows its real models even with a fake `HOME`.
- `CLAUDE_MODEL` / `CLAUDE_EFFORT` / `CLAUDE_SYSTEM_PROMPT` — Claude CLI model alias, reasoning effort, optional system prompt override (auth delegated to the installed `claude` CLI binary).
- `OPENCODE_ZEN_API_KEY` / `OPENCODE_ZEN_BASE_URL` / `OPENCODE_ZEN_MODEL` — bearer token + base URL + model for the opencode Zen tier (default base `https://opencode.ai/zen/v1`, default model `claude-sonnet-5`).
- `OPENCODE_GO_API_KEY` / `OPENCODE_GO_BASE_URL` / `OPENCODE_GO_MODEL` — separate paid tier with its own key (default base `https://opencode.ai/zen/go/v1`, default model `glm-5.2`).
- `OPENAI_AUTH_MODE` — `api` (default) | `subs`. Auto-picks `subs` if only `OPENAI_SUBS_TOKEN` is set.
- `OPENAI_API_KEY` — platform key (`sk-…`) for `api` mode.
- `OPENAI_SUBS_TOKEN` — ChatGPT subscription bearer for `subs` mode.
- `OPENAI_BASE_URL` — chat completions base (default `https://api.openai.com/v1`).
- `OPENAI_MODEL` — model id (default `gpt-5`).
- `VOLUME` — playback volume 0-100 (default 70); persisted in `config.json` after adjustment via ←/→.

`saveConfig()` mirrors edits into `process.env` (so a TUI `/settings` edit wins over a startup-time env var for the current session) then re-reads config — pasted values get whitespace/quotes/`Bearer ` prefix stripped, except `customSystemPrompt` and `volume`.