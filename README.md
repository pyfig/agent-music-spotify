# spotify-harness-tui

Terminal UI (Bun + [@opentui/react](https://github.com/anomalyco/opentui)) that turns a mood/request into Spotify album picks, or a set of seed artists into a generated mix playlist — using an AI agent to make the picks and the real Spotify Web API to resolve and play them.

## Setup

### 1. Spotify app

1. Create an app at https://developer.spotify.com/dashboard.
2. Add redirect URI: `http://127.0.0.1:8888/callback`.
3. Copy the client ID.

No client secret needed — auth uses PKCE.

### 2. Config

Set env vars, or write `~/.config/spotify-harness-tui/config.json`:

```json
{
  "spotifyClientId": "your-client-id",
  "defaultProvider": "claude-cli",
  "ollamaUrl": "http://127.0.0.1:11434",
  "ollamaModel": "llama3"
}
```

Env vars (override config file): `SPOTIFY_CLIENT_ID`, `DEFAULT_PROVIDER`, `OLLAMA_URL`, `OLLAMA_MODEL`.

### 3. Agent provider

- **claude-cli**: requires the `claude` CLI installed and authenticated on your machine.
- **ollama**: requires a running Ollama daemon (`ollama serve`) with a pulled model.

## Install & run

```bash
bun install
bun run dev
```

First action that needs Spotify opens your browser for consent; tokens are cached and auto-refreshed at `~/.config/spotify-harness-tui/tokens.json`.

## Usage

- **Tab** — switch mode: mood → album picks, or artist mix.
- **Ctrl+P** — cycle agent provider.
- Type your mood (mode 1) or `seed artist, another artist | optional mood` (mode 2), **Enter** to submit.
- **j/k** or arrows — move selection in results.
- **Enter** on a result — play it on your active Spotify device.
- **s** (mood mode) — save the selected album to your library.
- **q** / **Ctrl+C** — quit.

## Scopes requested

`playlist-modify-private`, `user-modify-playback-state`, `user-read-playback-state`, `user-library-modify`.

## Tests

```bash
bun test
```

## Not yet implemented

codex CLI / OpenRouter agent providers (interface is ready — add to `src/agent/registry.ts`), album art rendering, live playback progress, playlist editing after creation.
