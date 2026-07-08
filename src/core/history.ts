import { join } from "node:path";
import type { Config } from "../config";
import type { AgentEvent } from "../agent/types";

/** Only the config dir is needed — keeps tests free of full Config fixtures. */
export type HistoryConfig = Pick<Config, "configDir">;

/**
 * One persisted generation session: the request, the finished playlist, and
 * the coalesced reasoning/tool transcript as shown in the live thinking view.
 */
export interface HistoryEntry {
  /** ISO timestamp; unique key for title patching. */
  header: string;
  /** Raw user request that started the generation. */
  prompt: string;
  /** LLM-summarized session title; falls back to the playlist name. */
  title: string;
  playlistName: string;
  tracks: { artist: string; title: string }[];
  events: AgentEvent[];
}

/** Cap stored sessions so the file never grows unbounded. */
export const HISTORY_LIMIT = 50;

export const HISTORY_TITLE_SYSTEM =
  "Summarize this playlist-generation session into a short title of at most 6 words, " +
  "in the language of the user's request. Reply with the title only — no quotes, no punctuation around it, no explanation.";

export function historyPath(config: HistoryConfig): string {
  return join(config.configDir, "history.json");
}

/** Missing or corrupt file → empty history (never throws). */
export async function loadHistory(config: HistoryConfig): Promise<HistoryEntry[]> {
  try {
    const raw = JSON.parse(await Bun.file(historyPath(config)).text());
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (e): e is HistoryEntry =>
        typeof e === "object" && e !== null &&
        typeof (e as HistoryEntry).header === "string" &&
        typeof (e as HistoryEntry).title === "string" &&
        Array.isArray((e as HistoryEntry).tracks) &&
        Array.isArray((e as HistoryEntry).events),
    );
  } catch {
    return [];
  }
}

async function save(config: HistoryConfig, entries: HistoryEntry[]): Promise<void> {
  await Bun.write(historyPath(config), JSON.stringify(entries, null, 2));
}

/** Append one session, trimming to the newest HISTORY_LIMIT entries. */
export async function appendHistory(config: HistoryConfig, entry: HistoryEntry): Promise<void> {
  const entries = await loadHistory(config);
  entries.push(entry);
  await save(config, entries.slice(-HISTORY_LIMIT));
}

/** Patch the title of the entry with the given header; no-op when absent. */
export async function updateHistoryTitle(
  config: HistoryConfig,
  header: string,
  title: string,
): Promise<void> {
  const entries = await loadHistory(config);
  const entry = entries.find((e) => e.header === header);
  if (!entry) return;
  entry.title = title;
  await save(config, entries);
}
