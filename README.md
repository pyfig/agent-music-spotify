# amusic

Terminal UI (Bun + [@opentui/react](https://github.com/anomalyco/opentui)) that turns a mood or request into a Spotify playlist: an AI agent picks the tracks, the real Spotify Web API resolves and plays them — all without leaving the terminal.

![Uploading image.png…]()


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
  - `/random` — let the model pick a genre
  - `/save` — save the current track list as a playlist
  - `/clientid` — set your own Spotify app client ID
  - `/login` — reconnect Spotify
  - `/quit` — exit
- Arrows — move selection in results; **Enter** on empty input — play the selected track (needs an open Spotify app on any device).
- **Ctrl+P** — cycle agent provider. **Esc Esc** — cancel generation. **Ctrl+C** — quit.

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

## Scopes requested

`playlist-modify-private`, `user-modify-playback-state`, `user-read-playback-state`, `user-library-modify`.

## Tests

```bash
bun test
```

## Not yet implemented

codex CLI / OpenRouter agent providers, album art rendering, live playback progress, playlist editing after creation.
