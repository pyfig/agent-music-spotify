import { useRef, useState } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { AgentProvider } from "../agent/types";
import type { Config } from "../config";
import type { ResolvedPlaylist } from "../core/generate-playlist";
import {
  appendHistory,
  HISTORY_TITLE_SYSTEM,
  loadHistory,
  updateHistoryTitle,
  type HistoryEntry,
} from "../core/history";

/**
 * /history screen state (list + detail levels) and session persistence.
 * Re-resolving a stored entry against the current backend is generation work
 * and lives in useGeneration.resolveHistoryEntry.
 */
export function useHistoryScreen(
  config: Config | null,
  provider: AgentProvider | null,
  deps: { setError: (msg: string | undefined) => void },
) {
  /** Non-null = screen open, newest-first session list. */
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[] | null>(null);
  /** Picked session whose stored transcript is shown (detail level). */
  const [historyDetail, setHistoryDetail] = useState<HistoryEntry | null>(null);
  const historyScrollRef = useRef<ScrollBoxRenderable | null>(null);

  /** /history: load entries and open the screen (newest first). */
  async function openHistory() {
    if (!config) return;
    const entries = await loadHistory(config);
    if (entries.length === 0) {
      deps.setError("no history yet — generate a playlist first");
      return;
    }
    setHistoryDetail(null);
    setHistoryEntries(entries.slice().reverse());
  }

  function closeHistory() {
    setHistoryEntries(null);
    setHistoryDetail(null);
  }

  // Persist the finished session (prompt + playlist + reasoning transcript)
  // into history.json, then patch in an LLM-summarized title. The entry is
  // saved immediately with the playlist name as fallback so a failed/slow
  // title call never loses the session.
  async function recordHistorySession(
    prompt: string,
    r: ResolvedPlaylist,
    events: HistoryEntry["events"],
  ) {
    if (!config) return;
    try {
      const header = new Date().toISOString();
      const entry: HistoryEntry = {
        header,
        prompt,
        title: r.name || prompt,
        playlistName: r.name,
        tracks: r.resolved.map((t) => ({ artist: t.artist, title: t.title })),
        events,
      };
      await appendHistory(config, entry);
      if (!provider) return;
      const digest = [
        `Request: ${prompt}`,
        `Playlist: ${r.name}`,
        "Tracks:",
        ...entry.tracks.map((t) => `- ${t.artist} – ${t.title}`),
      ].join("\n");
      const title = (await provider.generate(HISTORY_TITLE_SYSTEM, digest)).text
        .trim()
        .split("\n")[0]
        ?.trim();
      if (title) await updateHistoryTitle(config, header, title.slice(0, 60));
    } catch {
      // never block generation on history failures
    }
  }

  return {
    historyEntries,
    setHistoryEntries,
    historyDetail,
    setHistoryDetail,
    historyScrollRef,
    openHistory,
    closeHistory,
    recordHistorySession,
  };
}
