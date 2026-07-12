# amusic

Terminal UI (Bun + [@opentui/react](https://github.com/anomalyco/opentui)) that turns a mood or request into a Spotify playlist: an AI agent picks the tracks, the real Spotify Web API resolves and plays them — all without leaving the terminal.

<img width="1672" height="1031" alt="amusic TUI: playlist generation with reasoning transcript" src="https://github.com/user-attachments/assets/6595e6c6-a010-409e-bd6a-cd9b2e8f82f8" />

- **Mood → playlist:** type `late night driving synthwave`, answer one clarifying question, get a real playlist on your Spotify account.
- **Agentic track picking:** the model drives a multi-turn tool loop (`searchTrack`, `searchArtist`, `getArtistTopTracks`, `clarify`, `finalize_playlist`) against the live music catalog instead of hallucinating track names.
- **Three music backends:** Spotify (remote playlists + Spotify Connect playback), SoundCloud and YouTube Music (local playback via mpv). Switch with **Ctrl+B**.
- **Six agent providers:** Claude CLI, Ollama, OpenAI, OpenRouter, opencode Zen/Go. Cycle with **Ctrl+P**, configure in-app with `/model`.
- **Taste memory & history:** `/like`d tracks and past sessions bias future playlists; `/history` replays any earlier session against the current backend.
- **Zero-setup Spotify auth:** built-in client ID + PKCE flow, browser consent on first run, tokens cached and auto-refreshed.

**Contents:** [Install](#install) · [Spotify setup](#spotify-setup) · [Usage](#usage) · [Backends](#multiple-backends) · [History](#session-history) · [Taste memory](#taste-memory) · [Agent loop](#agent-loop) · [Config](#config) · [Run from source](#run-from-source)

## Install

One-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/pyfig/agent-music-spotify/main/install.sh | bash
amusic
```

Or from a checkout:

```bash
git clone https://github.com/pyfig/agent-music-spotify.git && cd agent-music-spotify
./install.sh
amusic
```

The installer ensures Bun is present, installs dependencies, and links an `amusic` command into `~/.local/bin`. The curl variant keeps the repo in `~/.local/share/amusic` pinned to the latest release tag and auto-updates to newer tags (checked at most once a day; skipped if you have local changes or are offline).

## Spotify setup

Spotify connects automatically on first run: a built-in client ID + PKCE flow opens your browser for consent — nothing to type. Tokens are cached and auto-refreshed at `~/.config/spotify-harness-tui/tokens.json`.

The built-in client ID is shared and its API quota can run out (you'll see a `429` error). Use your own Spotify app instead — run `/clientid` inside the TUI, it walks you through creating the app and saves the ID. Manual alternatives: set `SPOTIFY_CLIENT_ID` or put `spotifyClientId` in `~/.config/spotify-harness-tui/config.json` (redirect URI must be `http://127.0.0.1/callback` — loopback without a port; the app binds an ephemeral port at login time per Spotify's loopback-redirect rules; no client secret needed).

## Usage

1. Type a mood or theme (`late night driving synthwave`), **Enter**.
2. Answer the clarifying questions (or pick an option).
3. Get the track list, then choose in **what next?**:
   - **Add** — create the playlist on Spotify;
   - **Just listen** — keep the list, play tracks with **Enter**, no playlist created (save later with `/save`);
   - **Continue generation** — regenerate;
   - **Cancel** — discard.

### Keys & commands

- `/` opens the command dropdown — arrows navigate, **Tab** completes, **Enter** runs:
  - `/model` — switch AI provider/model (and edit provider keys, models, base URLs)
  - `/music` — switch music backend (Spotify / SoundCloud / YouTube Music)
  - `/random` — let the model pick a genre
  - `/save` — save the current track list as a playlist
  - `/history` — browse past sessions: reasoning transcript + load tracks for playback
  - `/clear` — clear session (results + context + playback)
  - `/clientid` — set your own Spotify app client ID
  - `/login` — reconnect Spotify
  - `/effort` — set Claude reasoning effort (low · medium · high · none)
  - `/systemprompt` — set a custom system prompt for Claude
  - `/like [comment]` — remember the current track in taste memory
  - `/memory` — show saved taste memory
  - `/forget` — clear taste memory
  - `/quit` — exit

  Unknown `/commands` show an error instead of being sent to the agent.
- Arrows — move selection in results (or scroll the reasoning transcript while the agent is still thinking); **Enter** on empty input — play the selected track (Spotify backend needs an open Spotify app on any device; other backends play locally via mpv). The now-playing row shows `0:15 ━━━━━ 3:34` with `←/→` adjusting volume and `Ctrl+U` toggling mute.
- **Ctrl+P** — cycle agent provider. **Ctrl+B** — switch music backend. **←/→** — volume. **Ctrl+U** — mute. **Esc Esc** — cancel generation. **Ctrl+C** — quit.

## Multiple backends

Switch with **Ctrl+B** or `MUSIC_BACKEND` env / `musicBackend` config key.

| | Spotify | SoundCloud | YouTube Music |
|---|---|---|---|
| Track search | ✓ | ✓ | ✓ |
| Artist top tracks | ✓ | ✓ | ✓ |
| Remote playlists | ✓ | — | — |
| Playback | Spotify Connect (remote) | local via mpv | local via mpv |
| Requirements | Spotify app client ID + OAuth | `mpv` (client_id auto-scraped, or `SOUNDCLOUD_CLIENT_ID`) | `mpv` + `yt-dlp` |

Backends without remote playlists queue the resolved track list into the local mpv player instead ("Add" plays the whole list; **Enter** plays from the selected track).

## Session history

Every successful generation is saved to `~/.config/spotify-harness-tui/history.json` (capped at 50 sessions): the request, the track list, and the full reasoning/tool transcript. Each session gets an LLM-summarized title (falls back to the playlist name). `/history` opens the browser — pick a session to read the stored reasoning, press **Enter** inside to re-resolve its tracks against the current backend and load them as a playable list (playback, `/save`, `/like` all work as usual).

## Taste memory

Generated sessions and `/like`d tracks accumulate in `.commandcode/taste/taste.md` and bias future playlists. Raw sessions are capped at 10 — older ones get summarized into a compact `Preferences` block automatically. Artist names extracted from preferences + sessions are also surfaced to the agent's `clarify` tool so disambiguating questions stay grounded in your prior taste.

## Agent loop

API providers (`openai`, `openrouter`, `opencode`, `ollama` with a tool-capable model) drive a multi-turn agent loop instead of a single prompt→JSON shot. The model gets tools (`searchTrack`, `searchArtist`, `getArtistTopTracks`, `clarify`, `finalize_playlist`), investigates the active music backend, asks at most one clarifying question through the existing ClarifyPrompt UI, then commits the playlist via the `finalize_playlist` tool. The loop is bounded — at most 8 iterations, then it errors. A duplicate-call guard keeps weaker models from looping on the same query: repeating a tool call with identical arguments replays the cached result with a warning instead of re-dispatching, and an always-on `anti-loop` prompt skill tells the model to reuse prior results and finalize when stuck. Models that silently drop the tools (older Ollama backends) fall through to the JSON-in-text fallback, so legacy flow still works.

While the agent thinks, a `ReasoningTranscript` panel takes over the list area as a chat-style log of reasoning/tool lines, pinned to the tail via `stickyScroll` — it disengages when you scroll up with arrows to read earlier reasoning and re-engages once you reach the bottom again. The status bar shows `⠋ thinking n=… · elapsed·s · vol` on the right while the backend identity (`♪ spotify ✓`) stays on the left.

## Config

Optional overrides via env vars or `~/.config/spotify-harness-tui/config.json` (env > file > default). Provider keys/models are editable in-app via `/model`; the music backend via `/music`.

| Env var | Config key | Default | Purpose |
|---|---|---|---|
| `MUSIC_BACKEND` | `musicBackend` | `youtube-music` | `spotify` · `soundcloud` · `youtube-music` |
| `SPOTIFY_CLIENT_ID` | `spotifyClientId` | built-in shared | Spotify app client ID (32 hex) |
| `SOUNDCLOUD_CLIENT_ID` | `soundcloudClientId` | auto-scraped | SoundCloud api-v2 client_id |
| `DEFAULT_PROVIDER` | `defaultProvider` | `claude-cli` | agent provider (see below) |
| `OLLAMA_URL` | `ollamaUrl` | `http://127.0.0.1:11434` | Ollama daemon URL |
| `OLLAMA_MODEL` | `ollamaModel` | `llama3` | Ollama model |
| `CLAUDE_MODEL` | `claudeModel` | `sonnet` | Claude CLI model alias |
| `CLAUDE_EFFORT` | `claudeEffort` | `low` | Claude reasoning effort |
| `CLAUDE_SYSTEM_PROMPT` | `customSystemPrompt` | `""` | override the system prompt |
| `OPENCODE_ZEN_API_KEY` | `opencodeZenApiKey` | `""` | opencode Zen tier key |
| `OPENCODE_ZEN_BASE_URL` | `opencodeZenBaseUrl` | `https://opencode.ai/zen/v1` | Zen base URL |
| `OPENCODE_ZEN_MODEL` | `opencodeZenModel` | `claude-sonnet-5` | Zen model |
| `OPENCODE_GO_API_KEY` | `opencodeGoApiKey` | `""` | opencode Go tier key |
| `OPENCODE_GO_BASE_URL` | `opencodeGoBaseUrl` | `https://opencode.ai/zen/go/v1` | Go base URL |
| `OPENCODE_GO_MODEL` | `opencodeGoModel` | `glm-5.2` | Go model |
| `OPENAI_AUTH_MODE` | `openaiAuthMode` | auto | `api` · `subs` (auto-picks from which credential is set) |
| `OPENAI_API_KEY` | `openaiApiKey` | `""` | OpenAI platform key (`sk-…`) |
| `OPENAI_SUBS_TOKEN` | `openaiSubsToken` | `""` | ChatGPT subscription bearer |
| `OPENAI_BASE_URL` | `openaiBaseUrl` | `https://api.openai.com/v1` | chat completions base |
| `OPENAI_MODEL` | `openaiModel` | `gpt-5` | OpenAI model id |
| `OPENROUTER_API_KEY` | `openrouterApiKey` | `""` | OpenRouter API key |
| `OPENROUTER_BASE_URL` | `openrouterBaseUrl` | `https://openrouter.ai/api/v1` | OpenRouter base URL |
| `OPENROUTER_MODEL` | `openrouterModel` | `openrouter/auto` | vendor-prefixed model id (`openrouter/auto` routes automatically) |
| `VOLUME` | `volume` | `70` | playback volume 0-100 |

Minimal `config.json`:

```json
{
  "defaultProvider": "claude-cli",
  "musicBackend": "spotify",
  "volume": 70
}
```

### Agent provider

Cycle with **Ctrl+P** or `/model` (each provider's config page there edits its keys/models).

- **claude-cli**: requires the `claude` CLI installed and authenticated on your machine.
- **ollama**: requires a running Ollama daemon (`ollama serve`) with a pulled model.
- **opencode: go / opencode: zen**: opencode hosted models — separate paid tiers, each with its own key + base URL.
- **openai**: OpenAI Chat Completions, API key (`OPENAI_API_KEY`) or ChatGPT subscription token (`OPENAI_SUBS_TOKEN`).
- **openrouter**: one API key (`OPENROUTER_API_KEY`) for any vendor-prefixed model; the default `openrouter/auto` picks a model per request.

## Run from source

```bash
bun install
bun run dev
```

## Scopes requested

`playlist-modify-public`, `playlist-modify-private`, `user-modify-playback-state`, `user-read-playback-state`, `user-library-modify`.

## Tests

```bash
bun test
```

## Not yet implemented

Album art rendering, playlist editing after creation.
