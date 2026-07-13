import { useRef } from "react";
import type { AgentProvider } from "../agent/types";
import type { ResolvedPlaylist } from "../core/generate-playlist";
import {
  addLine,
  appendSession,
  emptyTaste,
  loadTaste,
  needsRotation,
  rotate,
  ROTATE_SYSTEM,
  saveTaste,
} from "../core/taste";

/**
 * Taste-memory actions: session recording, /like, /forget, /memory text.
 * Everything is best-effort — taste failures never block generation.
 */
export function useTasteActions(
  provider: AgentProvider | null,
  deps: { show: (msg: string) => void },
) {
  // Taste sessions group by generation; /like lands in the latest one.
  const sessionHeaderRef = useRef<string>(new Date().toISOString().slice(0, 16));
  // Soft seed context: the previous session's resolved playlist (as
  // "artist – title" lines) is fed into the next generation's user prompt.
  // Lives in memory only — /clear nulls it; restart loses it (consistent
  // with `resolved`/`committedPlaylist`/`events`).
  const priorPlaylistRef = useRef<string[] | null>(null);

  // Best-effort taste memory: only sessions where ≥50% of tracks resolved.
  async function recordTasteSession(r: ResolvedPlaylist) {
    const total = r.resolved.length + r.unresolved.length;
    if (total === 0 || r.resolved.length / total < 0.5) return;
    try {
      const header = new Date().toISOString().slice(0, 16);
      sessionHeaderRef.current = header;
      let taste = await loadTaste();
      taste = appendSession(taste, {
        header,
        lines: r.resolved.map((t) => `- ${t.artist} – ${t.title}`),
      });
      if (needsRotation(taste) && provider) {
        taste = await rotate(taste, (raw) =>
          provider
            .generate(ROTATE_SYSTEM, raw, undefined, undefined, {
              reasoningEffort: "none",
              maxTokens: 512,
            })
            .then((r) => r.text),
        ).catch(() => taste);
      }
      await saveTaste(taste);
    } catch {
      // never block generation on memory failures
    }
  }

  /** /like: append the track (with optional comment) to the latest session. */
  async function likeTrack(track: { artist: string; title: string }, comment: string) {
    const line = comment
      ? `- ${track.artist} – ${track.title} (liked: "${comment}")`
      : `- ${track.artist} – ${track.title} (liked)`;
    const taste = await loadTaste();
    await saveTaste(addLine(taste, sessionHeaderRef.current, line));
    deps.show(`liked · ${track.artist} – ${track.title}`);
  }

  /** /forget r — drop raw sessions, keep curated preferences. */
  async function clearSessions() {
    const taste = await loadTaste();
    await saveTaste({ ...taste, sessions: [] });
  }

  /** /forget a — wipe everything. */
  async function clearAll() {
    await saveTaste(emptyTaste());
  }

  /** /memory: human-readable digest, or null when the file is empty. */
  async function buildMemoryText(): Promise<string | null> {
    const taste = await loadTaste();
    if (taste.preferences.length === 0 && taste.sessions.length === 0) return null;
    const last = taste.sessions.at(-1);
    return [
      "Preferences:",
      ...(taste.preferences.length ? taste.preferences : ["- (none yet)"]),
      ...(last ? ["", `Last session (${last.header}):`, ...last.lines] : []),
    ].join("\n");
  }

  return {
    sessionHeaderRef,
    priorPlaylistRef,
    recordTasteSession,
    likeTrack,
    clearSessions,
    clearAll,
    buildMemoryText,
  };
}
