import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  configDir: string;
  spotifyClientId: string;
  defaultProvider: string;
  ollamaUrl: string;
  ollamaModel: string;
  claudeModel: string;
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
  spotifyClientId?: string;
  defaultProvider?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  claudeModel?: string;
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
    spotifyClientId: isValidClientId(process.env.SPOTIFY_CLIENT_ID)
      ? process.env.SPOTIFY_CLIENT_ID
      : isValidClientId(fileConfig.spotifyClientId)
        ? fileConfig.spotifyClientId
        : DEFAULT_CLIENT_ID,
    defaultProvider: chosenProvider ?? "claude-cli",
    ollamaUrl:
      process.env.OLLAMA_URL ??
      fileConfig.ollamaUrl ??
      "http://127.0.0.1:11434",
    ollamaModel: process.env.OLLAMA_MODEL ?? fileConfig.ollamaModel ?? "llama3",
    claudeModel: process.env.CLAUDE_MODEL ?? fileConfig.claudeModel ?? "sonnet",
    providerChosen: chosenProvider !== undefined,
  };
}

export function tokensPath(config: Config): string {
  return join(config.configDir, "tokens.json");
}

export async function saveConfig(partial: FileConfig): Promise<Config> {
  const existing = await readFileConfig();
  const merged = { ...existing, ...partial };
  await Bun.write(CONFIG_FILE, JSON.stringify(merged, null, 2));
  return loadConfig();
}

export function isConfigured(config: Config): boolean {
  return config.providerChosen;
}
