import { join } from "node:path";
import { mkdir } from "node:fs/promises";

/**
 * Agent taste memory: .commandcode/taste/taste.md
 *
 * ## Preferences (curated)   — compact digest, always fed to the prompt
 * ## Recent sessions (raw)   — last MAX_RAW_SESSIONS sessions verbatim;
 *                              older ones get LLM-summarized into Preferences.
 */

export interface TasteSession {
  /** e.g. "2026-07-06T14:00" */
  header: string;
  lines: string[];
}

export interface Taste {
  preferences: string[];
  sessions: TasteSession[];
}

export const MAX_RAW_SESSIONS = 10;
/** Above this, the prompt prefix falls back to Preferences + last 3 sessions. */
const PROMPT_CAP_BYTES = 4096;
const PREFS_HEADING = "## Preferences (curated)";
const SESSIONS_HEADING = "## Recent sessions (raw, max 10)";

export function emptyTaste(): Taste {
  return { preferences: [], sessions: [] };
}

export function parseTaste(md: string): Taste {
  const taste = emptyTaste();
  let mode: "none" | "prefs" | "sessions" = "none";
  let current: TasteSession | null = null;
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("## Preferences")) {
      mode = "prefs";
      continue;
    }
    if (line.startsWith("## Recent sessions")) {
      mode = "sessions";
      continue;
    }
    if (mode === "sessions" && line.startsWith("### Session ")) {
      current = { header: line.slice("### Session ".length).trim(), lines: [] };
      taste.sessions.push(current);
      continue;
    }
    if (!line.startsWith("- ")) continue;
    if (mode === "prefs") taste.preferences.push(line);
    else if (mode === "sessions" && current) current.lines.push(line);
  }
  return taste;
}

export function formatTaste(taste: Taste): string {
  const parts = [PREFS_HEADING, ...taste.preferences, "", SESSIONS_HEADING];
  for (const s of taste.sessions) {
    parts.push(`### Session ${s.header}`, ...s.lines, "");
  }
  return `${parts.join("\n").trimEnd()}\n`;
}

export function appendSession(taste: Taste, session: TasteSession): Taste {
  return { ...taste, sessions: [...taste.sessions, session] };
}

/** Append a line to the session with this header, creating it if missing. */
export function addLine(taste: Taste, sessionHeader: string, line: string): Taste {
  const sessions = [...taste.sessions];
  const existing = sessions.find((s) => s.header === sessionHeader);
  if (existing) {
    existing.lines = [...existing.lines, line];
  } else {
    sessions.push({ header: sessionHeader, lines: [line] });
  }
  return { ...taste, sessions };
}

export function needsRotation(taste: Taste): boolean {
  return taste.sessions.length > MAX_RAW_SESSIONS;
}

/**
 * Fold the oldest sessions (beyond MAX_RAW_SESSIONS) into Preferences via one
 * LLM call, then drop their raw blocks. Keeps the file size stable over time.
 */
export async function rotate(
  taste: Taste,
  summarize: (rawSessions: string) => Promise<string>,
): Promise<Taste> {
  if (!needsRotation(taste)) return taste;
  const overflow = taste.sessions.slice(0, taste.sessions.length - MAX_RAW_SESSIONS);
  const raw = overflow
    .map((s) => `Session ${s.header}\n${s.lines.join("\n")}`)
    .join("\n\n");
  const summary = await summarize(raw);
  const bullets = summary
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "));
  const merged = [...taste.preferences];
  for (const b of bullets) {
    if (!merged.includes(b)) merged.push(b);
  }
  return { preferences: merged, sessions: taste.sessions.slice(-MAX_RAW_SESSIONS) };
}

/** System-prompt prefix. Never ships the whole file when it grows past the cap. */
export function tastePromptPrefix(taste: Taste): string {
  if (taste.preferences.length === 0 && taste.sessions.length === 0) return "";
  const full = formatTaste(taste);
  const capped =
    Buffer.byteLength(full, "utf8") > PROMPT_CAP_BYTES
      ? formatTaste({ preferences: taste.preferences, sessions: taste.sessions.slice(-3) })
      : full;
  return `The user's accumulated music taste (use it to bias picks; explicit request constraints still win):\n${capped}`;
}

export const ROTATE_SYSTEM =
  'You compress listening-session logs into durable taste preferences. Given raw session lines, respond with ONLY 3-5 short bullets, one per line, each starting with "- ", capturing likes (artists, styles) and things to avoid. No prose, no headings.';

// --- IO ---

const TASTE_DIR = join(process.cwd(), ".commandcode", "taste");
const TASTE_FILE = join(TASTE_DIR, "taste.md");

export async function loadTaste(): Promise<Taste> {
  try {
    return parseTaste(await Bun.file(TASTE_FILE).text());
  } catch {
    return emptyTaste();
  }
}

export async function saveTaste(taste: Taste): Promise<void> {
  await mkdir(TASTE_DIR, { recursive: true });
  await Bun.write(TASTE_FILE, formatTaste(taste));
}
