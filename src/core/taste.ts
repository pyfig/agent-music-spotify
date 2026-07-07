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

/**
 * Compact taste-channel for the clarify step: ONLY artist names extracted from
 * curated preferences and raw session lines. Cheap on tokens, surfaces just
 * enough context to ground a clarifying question in the user's recent taste
 * without shipping the full listening log. Returns "" when there is no taste
 * yet (first run) or no recognizable artist names could be parsed.
 */
export function tasteForClarify(taste: Taste): string {
  const seen = new Set<string>();
  const names: string[] = [];

  const pushClean = (raw: string) => {
    const name = raw.trim();
    if (name.length === 0) return;
    // Normalize key for de-dup so Cyrillic vs Latin duplicates collapse only
    // when literally identical. Keep original-script first occurrence.
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    names.push(name);
  };

  // Preferences bullets: tolerate "- likes: Artist X" / "- avoid: Artist Y" /
  // flat "- Artist Z". We only pull the on-artist-on side; explicit "avoid"
  // lines are skipped (they're a *negative* signal for clarify grounding).
  for (const line of taste.preferences) {
    const body = line.replace(/^-\s+/, "").trim();
    if (/^(avoid|none of| never| skip)/i.test(body)) continue;
    if (/^(likes?|enjoys?|wants?|prefers?|favorite|fav)\b\s*[:]?/i.test(body)) {
      // "likes: A, B, C" → split
      const after = body.replace(/^[A-Za-z]+\s*:?\s*/, "").trim();
      for (const piece of after.split(/[,/;]|\band\b/)) pushClean(piece);
      continue;
    }
    pushClean(body);
  }

  // Session lines: "- Artist – Title" (en dash U+2013 or hyphen-minus). Pull
  // the left side; "(liked: …)" / "(meh)" / "(skip)" tags are dropped.
  for (const session of taste.sessions) {
    for (const line of session.lines) {
      const body = line.replace(/^-\s+/, "");
      // Skip annotation-only lines like "- (liked: 'banger')" — they have no
      // artist/title pair. Detect by absence of any dash separator.
      const m = body.match(/^(.+?)\s+[–-]\s+(.+)$/u);
      if (!m) continue;
      pushClean(m[1]!.replace(/\s*\([^)]*\)\s*$/, "").trim());
    }
  }

  // Cap the surfaced list so it can't blow up the prompt on extensive taste.
  if (names.length === 0) return "";
  const cap = 25;
  const list = names.slice(0, cap).join(", ");
  return `Artists you've enjoyed before: ${list}`;
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
