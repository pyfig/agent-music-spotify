import { homedir } from "node:os";
import { join } from "node:path";
import type { MusicBackend } from "./music/types";

const MUSIC_BACKENDS: MusicBackend[] = ["spotify", "soundcloud", "youtube-music"];

function asMusicBackend(value: string | undefined): MusicBackend | undefined {
  return MUSIC_BACKENDS.includes(value as MusicBackend) ? (value as MusicBackend) : undefined;
}

export type OpenAIAuthMode = "api" | "subs";
const OPENAI_AUTH_MODES: OpenAIAuthMode[] = ["api", "subs"];
function asOpenAIAuthMode(v: string | undefined): OpenAIAuthMode | undefined {
  return v && OPENAI_AUTH_MODES.includes(v as OpenAIAuthMode)
    ? (v as OpenAIAuthMode)
    : undefined;
}

export interface Config {
  configDir: string;
  musicBackend: MusicBackend;
  spotifyClientId: string;
  /** api-v2 client_id — from env, or scraped from soundcloud.com and cached. */
  soundcloudClientId: string;
  defaultProvider: string;
  ollamaUrl: string;
  ollamaModel: string;
  claudeModel: string;
  claudeEffort: string;
  customSystemPrompt: string;
  /** opencode hosted models — Go and Zen are separate paid tiers, each with its own key + base URL. */
  opencodeZenApiKey: string;
  opencodeZenBaseUrl: string;
  opencodeZenModel: string;
  opencodeGoApiKey: string;
  opencodeGoBaseUrl: string;
  opencodeGoModel: string;
  /** OpenAI: two auth modes — api key (sk-...) or ChatGPT subscription token. */
  openaiAuthMode: OpenAIAuthMode;
  openaiApiKey: string;
  openaiSubsToken: string;
  openaiBaseUrl: string;
  openaiModel: string;
  /** Playback volume 0-100, persisted across sessions. Default 70. */
  volume: number;
  /** True when provider was explicitly chosen (env or config file), not just defaulted. */
  providerChosen: boolean;
}

const CONFIG_DIR = join(homedir(), ".config", "spotify-harness-tui");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/**
 * Built-in Spotify app client ID (PKCE flow, no secret) so users never enter
 * credentials by hand. Replace the placeholder with the real app's client ID.
 */
export const DEFAULT_CLIENT_ID =
  "change this id on https://developer.spotify.com/dashboard";

export function isValidClientId(id: string | undefined): id is string {
  return typeof id === "string" && /^[0-9a-f]{32}$/i.test(id);
}

export interface FileConfig {
  musicBackend?: string;
  spotifyClientId?: string;
  soundcloudClientId?: string;
  defaultProvider?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  claudeModel?: string;
  claudeEffort?: string;
  customSystemPrompt?: string;
  opencodeZenApiKey?: string;
  opencodeZenBaseUrl?: string;
  opencodeZenModel?: string;
  opencodeGoApiKey?: string;
  opencodeGoBaseUrl?: string;
  opencodeGoModel?: string;
  openaiAuthMode?: string;
  openaiApiKey?: string;
  openaiSubsToken?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  volume?: number;
}

async function readFileConfig(): Promise<FileConfig> {
  try {
    const text = await Bun.file(CONFIG_FILE).text();
    return JSON.parse(text) as FileConfig;
  } catch {
    return {};
  }
}

export async function loadConfig(): Promise<Config> {
  const fileConfig = await readFileConfig();
  const chosenProvider =
    process.env.DEFAULT_PROVIDER ?? fileConfig.defaultProvider;
  return {
    configDir: CONFIG_DIR,
    musicBackend:
      asMusicBackend(process.env.MUSIC_BACKEND) ??
      asMusicBackend(fileConfig.musicBackend) ??
      "spotify",
    spotifyClientId: isValidClientId(process.env.SPOTIFY_CLIENT_ID)
      ? process.env.SPOTIFY_CLIENT_ID
      : isValidClientId(fileConfig.spotifyClientId)
        ? fileConfig.spotifyClientId
        : DEFAULT_CLIENT_ID,
    soundcloudClientId:
      process.env.SOUNDCLOUD_CLIENT_ID ?? fileConfig.soundcloudClientId ?? "",
    defaultProvider: chosenProvider ?? "claude-cli",
    ollamaUrl:
      process.env.OLLAMA_URL ??
      fileConfig.ollamaUrl ??
      "http://127.0.0.1:11434",
    ollamaModel: process.env.OLLAMA_MODEL ?? fileConfig.ollamaModel ?? "llama3",
    claudeModel: process.env.CLAUDE_MODEL ?? fileConfig.claudeModel ?? "sonnet",
    claudeEffort: process.env.CLAUDE_EFFORT ?? fileConfig.claudeEffort ?? "low",
    customSystemPrompt:
      process.env.CLAUDE_SYSTEM_PROMPT ?? fileConfig.customSystemPrompt ?? "",
    // Zen's base URL is public (opencode.ai/docs/zen); Go's is not documented
    // but follows the same pattern per the account dashboard, so it's a
    // reasonable default — still overridable via env/config either way.
    opencodeZenApiKey:
      process.env.OPENCODE_ZEN_API_KEY ?? fileConfig.opencodeZenApiKey ?? "",
    opencodeZenBaseUrl:
      process.env.OPENCODE_ZEN_BASE_URL ??
      fileConfig.opencodeZenBaseUrl ??
      "https://opencode.ai/zen/v1",
    opencodeZenModel:
      process.env.OPENCODE_ZEN_MODEL ?? fileConfig.opencodeZenModel ?? "claude-sonnet-5",
    opencodeGoApiKey:
      process.env.OPENCODE_GO_API_KEY ?? fileConfig.opencodeGoApiKey ?? "",
    opencodeGoBaseUrl:
      process.env.OPENCODE_GO_BASE_URL ??
      fileConfig.opencodeGoBaseUrl ??
      "https://opencode.ai/zen/go/v1",
    opencodeGoModel:
      process.env.OPENCODE_GO_MODEL ?? fileConfig.opencodeGoModel ?? "glm-5.2",
    openaiAuthMode:
      asOpenAIAuthMode(process.env.OPENAI_AUTH_MODE) ??
      asOpenAIAuthMode(fileConfig.openaiAuthMode) ??
      // Auto-pick from whichever credential is present; default to "api".
      (process.env.OPENAI_SUBS_TOKEN ?? fileConfig.openaiSubsToken
        ? "subs"
        : "api"),
    openaiApiKey:
      process.env.OPENAI_API_KEY ?? fileConfig.openaiApiKey ?? "",
    openaiSubsToken:
      process.env.OPENAI_SUBS_TOKEN ?? fileConfig.openaiSubsToken ?? "",
    openaiBaseUrl:
      process.env.OPENAI_BASE_URL ??
      fileConfig.openaiBaseUrl ??
      "https://api.openai.com/v1",
    openaiModel:
      process.env.OPENAI_MODEL ?? fileConfig.openaiModel ?? "gpt-5",
    volume: (() => {
      const env = process.env.VOLUME !== undefined ? Number(process.env.VOLUME) : undefined;
      const file = typeof fileConfig.volume === "number" ? fileConfig.volume : undefined;
      const raw = env ?? file ?? 70;
      return Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : 70;
    })(),
    providerChosen: chosenProvider !== undefined,
  };
}

export function tokensPath(config: Config): string {
  return join(config.configDir, "tokens.json");
}

// Map every FileConfig key to its env var name so saveConfig can mirror edits
// into process.env. loadConfig() reads env first (env > file > default), so
// without this, editing e.g. OPENCODE_API_KEY via /settings while the env var
// is set silently no-ops: the file is written but loadConfig() re-reads env
// and returns the stale value, the provider useMemo reconstructs with the old
// key, and the user sees no change. Mirroring into env makes the TUI edit win
// for the current session; the file write makes it persist across restarts.
const FILE_KEY_TO_ENV: Record<keyof FileConfig, string> = {
  musicBackend: "MUSIC_BACKEND",
  spotifyClientId: "SPOTIFY_CLIENT_ID",
  soundcloudClientId: "SOUNDCLOUD_CLIENT_ID",
  defaultProvider: "DEFAULT_PROVIDER",
  ollamaUrl: "OLLAMA_URL",
  ollamaModel: "OLLAMA_MODEL",
  claudeModel: "CLAUDE_MODEL",
  claudeEffort: "CLAUDE_EFFORT",
  customSystemPrompt: "CLAUDE_SYSTEM_PROMPT",
  opencodeZenApiKey: "OPENCODE_ZEN_API_KEY",
  opencodeZenBaseUrl: "OPENCODE_ZEN_BASE_URL",
  opencodeZenModel: "OPENCODE_ZEN_MODEL",
  opencodeGoApiKey: "OPENCODE_GO_API_KEY",
  opencodeGoBaseUrl: "OPENCODE_GO_BASE_URL",
  opencodeGoModel: "OPENCODE_GO_MODEL",
  openaiAuthMode: "OPENAI_AUTH_MODE",
  openaiApiKey: "OPENAI_API_KEY",
  openaiSubsToken: "OPENAI_SUBS_TOKEN",
  openaiBaseUrl: "OPENAI_BASE_URL",
  openaiModel: "OPENAI_MODEL",
  volume: "VOLUME",
};

// Keys that never want fuzzy whitespace/quote cleanup — freeform text where
// the user's exact input (including leading/trailing spaces) may be intentional.
const NO_SANITIZE_KEYS = new Set<keyof FileConfig>(["customSystemPrompt", "volume"]);

// Pasted API keys/tokens/URLs commonly carry a trailing newline (terminal
// paste), wrapping quotes (copied from JSON), or an accidental "Bearer "
// prefix (copied from a curl example) — any of which breaks the auth header
// downstream and turns into an opaque 401. Clean these once at the save
// choke point so every provider gets a clean value regardless of source.
function sanitizeFieldValue(key: keyof FileConfig, value: unknown): unknown {
  if (typeof value !== "string" || NO_SANITIZE_KEYS.has(key)) return value;
  let v = value.trim();
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    v = v.slice(1, -1).trim();
  }
  v = v.replace(/^bearer\s+/i, "");
  return v;
}

export async function saveConfig(partial: FileConfig): Promise<Config> {
  const existing = await readFileConfig();
  const sanitized: FileConfig = { ...partial };
  for (const [k, v] of Object.entries(partial)) {
    (sanitized as Record<string, unknown>)[k] = sanitizeFieldValue(k as keyof FileConfig, v);
  }
  const merged = { ...existing, ...sanitized };
  await Bun.write(CONFIG_FILE, JSON.stringify(merged, null, 2));
  // Mirror the edited keys into process.env so the next loadConfig() — and
  // the provider useMemo in app.tsx — pick up the new value even when the
  // env var was set at startup. undefined clears the env override (used by
  // the SoundCloud client_id invalidation path).
  for (const [k, v] of Object.entries(sanitized)) {
    const envName = FILE_KEY_TO_ENV[k as keyof FileConfig];
    if (!envName) continue;
    if (v === undefined || v === null) delete process.env[envName];
    else process.env[envName] = String(v);
  }
  return loadConfig();
}

export function isConfigured(config: Config): boolean {
  return config.providerChosen;
}
