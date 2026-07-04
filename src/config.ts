import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  configDir: string;
  spotifyClientId: string;
  defaultProvider: string;
  ollamaUrl: string;
  ollamaModel: string;
  /** True when provider was explicitly chosen (env or config file), not just defaulted. */
  providerChosen: boolean;
}

const CONFIG_DIR = join(homedir(), ".config", "spotify-harness-tui");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface FileConfig {
  spotifyClientId?: string;
  defaultProvider?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
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
  const chosenProvider = process.env.DEFAULT_PROVIDER ?? fileConfig.defaultProvider;
  return {
    configDir: CONFIG_DIR,
    spotifyClientId: process.env.SPOTIFY_CLIENT_ID ?? fileConfig.spotifyClientId ?? "",
    defaultProvider: chosenProvider ?? "claude-cli",
    ollamaUrl: process.env.OLLAMA_URL ?? fileConfig.ollamaUrl ?? "http://127.0.0.1:11434",
    ollamaModel: process.env.OLLAMA_MODEL ?? fileConfig.ollamaModel ?? "llama3",
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
  return config.spotifyClientId.length > 0 && config.providerChosen;
}
