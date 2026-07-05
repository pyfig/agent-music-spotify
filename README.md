# vibedeck

Terminal UI (Bun + [@opentui/react](https://github.com/anomalyco/opentui)) that turns a mood/request into Spotify album picks, or a set of seed artists into a generated mix playlist — using an AI agent to make the picks and the real Spotify Web API to resolve and play them.

## Install

```bash
./install.sh
vibedeck
```

The installer ensures Bun is present, installs dependencies, and links a `vibedeck` command into `~/.local/bin`.

Spotify connects automatically on first run: a built-in client ID + PKCE flow opens your browser for consent — nothing to type. Tokens are cached and auto-refreshed at `~/.config/spotify-harness-tui/tokens.json`.

To use your own Spotify app instead, set `SPOTIFY_CLIENT_ID` or put `spotifyClientId` in `~/.config/spotify-harness-tui/config.json` (redirect URI must be `http://127.0.0.1:8888/callback`; no client secret needed).

## Config

Optional overrides — env vars (`SPOTIFY_CLIENT_ID`, `DEFAULT_PROVIDER`, `OLLAMA_URL`, `OLLAMA_MODEL`) or `~/.config/spotify-harness-tui/config.json`:

```json
{
  "defaultProvider": "claude-cli",
  "ollamaUrl": "http://127.0.0.1:11434",
  "ollamaModel": "llama3"
}
```

### Agent provider

- **claude-cli**: requires the `claude` CLI installed and authenticated on your machine.
- **ollama**: requires a running Ollama daemon (`ollama serve`) with a pulled model.

## Run from source

```bash
bun install
bun run dev
```

## Usage

- The prompt starts centered; after your first request it moves to the top with results below.
- Type `/` to open the command dropdown: `/model` (switch provider/model), `/login` (reconnect Spotify), `/quit`. Arrows navigate, **Tab** completes, **Enter** runs.
- **Ctrl+P** — cycle agent provider.
- Type your mood, **Enter** to submit.
- Arrows — move selection in results; **Enter** on empty input — play selection.
- **Ctrl+C** — quit.

## Scopes requested

`playlist-modify-private`, `user-modify-playback-state`, `user-read-playback-state`, `user-library-modify`.

## Tests

```bash
bun test
```

## Not yet implemented

codex CLI / OpenRouter agent providers, album art rendering, live playback progress, playlist editing after creation.
