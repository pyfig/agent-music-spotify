## ADDED Requirements

### Requirement: YouTube Music is the default backend
When neither the `MUSIC_BACKEND` environment variable nor the `musicBackend` key in `config.json` provides a valid backend, `loadConfig()` SHALL resolve `musicBackend` to `"youtube-music"`.

#### Scenario: Fresh install, no configuration
- **WHEN** `MUSIC_BACKEND` is unset and `config.json` is absent or has no `musicBackend` key
- **THEN** the loaded config has `musicBackend === "youtube-music"`

#### Scenario: Invalid configured value falls through to default
- **WHEN** `MUSIC_BACKEND` is unset and `config.json` contains `musicBackend: "not-a-backend"`
- **THEN** the loaded config has `musicBackend === "youtube-music"`

### Requirement: Configured backend still wins over the default
Config precedence SHALL remain env > file > default; the new default MUST NOT override any explicitly configured backend.

#### Scenario: Saved Spotify user keeps Spotify
- **WHEN** `config.json` contains `musicBackend: "spotify"` and `MUSIC_BACKEND` is unset
- **THEN** the loaded config has `musicBackend === "spotify"`

#### Scenario: Env overrides file and default
- **WHEN** `MUSIC_BACKEND=soundcloud` is set and `config.json` contains `musicBackend: "spotify"`
- **THEN** the loaded config has `musicBackend === "soundcloud"`

### Requirement: First run surfaces local-playback dependency hints
On startup with the default backend, the app SHALL run the existing local-playback dependency check and surface its install hint when mpv or yt-dlp is missing, instead of routing the user into the Spotify credential flow.

#### Scenario: mpv missing on first run
- **WHEN** the app starts with unconfigured backend and `mpv` is not on PATH
- **THEN** the user sees the install hint from `checkLocalPlaybackDeps("youtube-music")` and no Spotify login/ClientIdPrompt is triggered
