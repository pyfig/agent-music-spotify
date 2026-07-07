# amusic

Terminal UI (Bun + [@opentui/react](https://github.com/anomalyco/opentui)) that turns a mood or request into a Spotify playlist: an AI agent picks the tracks, the real Spotify Web API resolves and plays them — all without leaving the terminal.

<img width="1672" height="1031" alt="image" src="https://github.com/user-attachments/assets/6595e6c6-a010-409e-bd6a-cd9b2e8f82f8" />


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

The installer ensures Bun is present, installs dependencies, and links an `amusic` command into `~/.local/bin` (the curl variant keeps the repo in `~/.local/share/amusic`).

## Spotify setup

Spotify connects automatically on first run: a built-in client ID + PKCE flow opens your browser for consent — nothing to type. Tokens are cached and auto-refreshed at `~/.config/spotify-harness-tui/tokens.json`.

The built-in client ID is shared and its API quota can run out (you'll see a `429` error). Use your own Spotify app instead — run `/clientid` inside the TUI, it walks you through creating the app and saves the ID. Manual alternatives: set `SPOTIFY_CLIENT_ID` or put `spotifyClientId` in `~/.config/spotify-harness-tui/config.json` (redirect URI must be `http://127.0.0.1:8888/callback`; no client secret needed).

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
  - `/model` — switch AI provider/model
  - `/settings` — configure provider keys, models, base URLs
  - `/random` — let the model pick a genre
  - `/save` — save the current track list as a playlist
  - `/clientid` — set your own Spotify app client ID
  - `/login` — reconnect Spotify
  - `/like [comment]` — remember the current track in taste memory
  - `/memory` — show saved taste memory
  - `/forget` — clear taste memory
  - `/quit` — exit
- Arrows — move selection in results; **Enter** on empty input — play the selected track (Spotify backend needs an open Spotify app on any device; other backends play locally via mpv).
- **Ctrl+P** — cycle agent provider. **Ctrl+B** — switch music backend. **Esc Esc** — cancel generation. **Ctrl+C** — quit.

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

## Taste memory

Generated sessions and `/like`d tracks accumulate in `.commandcode/taste/taste.md` and bias future playlists. Raw sessions are capped at 10 — older ones get summarized into a compact `Preferences` block automatically. Artist names extracted from preferences + sessions are also surfaced to the agent's `clarify` tool so disambiguating questions stay grounded in your prior taste.

## Agent loop

API providers (`openai`, `opencode`, `ollama` with a tool-capable model) drive a multi-turn agent loop instead of a single prompt→JSON shot. The model gets tools (`searchTrack`, `searchArtist`, `getArtistTopTracks`, `clarify`, `finalize_playlist`), investigates the active music backend, asks at most one clarifying question through the existing ClarifyPrompt UI, then commits the playlist via the `finalize_playlist` tool. The loop is bounded — at most 8 iterations, then it errors. Models that silently drop the tools (older Ollama backends) fall through to the JSON-in-text fallback, so legacy flow still works.

Reasoning deltas (o-series `reasoning_content`, Anthropic `thinking_delta`, Gemini 2.5 `thought`, Responses `response.reasoning.delta`, Ollama `message.thinking`) stream live into a column drawn beside the spinning donut while the agent thinks — see `DonutAnimation` + `ReasoningPane`.

## Config

Optional overrides via env vars or `~/.config/spotify-harness-tui/config.json` (env > file > default). All keys are editable in-app via `/settings`.

| Env var | Config key | Default | Purpose |
|---|---|---|---|
| `MUSIC_BACKEND` | `musicBackend` | `spotify` | `spotify` · `soundcloud` · `youtube-music` |
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

Cycle with **Ctrl+P** or `/model`, configure keys/models in `/settings`.

- **claude-cli**: requires the `claude` CLI installed and authenticated on your machine.
- **ollama**: requires a running Ollama daemon (`ollama serve`) with a pulled model.
- **opencode: go / opencode: zen**: opencode hosted models — separate paid tiers, each with its own key + base URL.
- **openai**: OpenAI Chat Completions, API key (`OPENAI_API_KEY`) or ChatGPT subscription token (`OPENAI_SUBS_TOKEN`).

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

OpenRouter agent provider, album art rendering, live playback progress, playlist editing after creation.
