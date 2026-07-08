import { GENERATE_PLAYLIST_SYSTEM } from "./prompts";
import clarifyMd from "./skills/clarify.md" with { type: "text" };
import curationMd from "./skills/curation.md" with { type: "text" };
import researchMd from "./skills/research.md" with { type: "text" };
import freshnessMd from "./skills/freshness.md" with { type: "text" };
import continuityMd from "./skills/continuity.md" with { type: "text" };
import antiLoopMd from "./skills/anti-loop.md" with { type: "text" };

/**
 * A runtime agent skill: a markdown prompt module with frontmatter. Skills are
 * bundled via Bun text imports (never read from disk at runtime — safe under
 * `bun build --compile` and independent of cwd) and composed into the agent
 * system prompt per request by `composeAgentSystem`.
 */
export interface Skill {
  name: string;
  description: string;
  /** Always included in the composed prompt, regardless of the request. */
  always: boolean;
  /** Lowercase substrings; a match against the request includes the skill. */
  triggers: string[];
  /** Markdown body injected verbatim into the system prompt. */
  body: string;
}

/**
 * Parse one skill file: `---` frontmatter (name/description/always/triggers)
 * followed by a markdown body. Throws on malformed input — skill files are
 * bundled with the app, so a parse failure is a build bug and should fail loud.
 */
export function parseSkill(raw: string): Skill {
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== "---") {
    throw new Error("skill file must start with '---' frontmatter");
  }
  let end = -1;
  const meta: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "---") {
      end = i;
      break;
    }
    const sep = line.indexOf(":");
    if (sep === -1) throw new Error(`invalid frontmatter line: ${line}`);
    meta[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
  }
  if (end === -1) throw new Error("skill frontmatter is missing the closing '---'");
  const name = meta.name ?? "";
  const description = meta.description ?? "";
  if (!name || !description) {
    throw new Error("skill frontmatter requires 'name' and 'description'");
  }
  const triggers = (meta.triggers ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
  return {
    name,
    description,
    always: meta.always === "true",
    triggers,
    body: lines.slice(end + 1).join("\n").trim(),
  };
}

/** All bundled skills, parsed once at module load. Order = prompt order. */
export const BUNDLED_SKILLS: Skill[] = [
  clarifyMd,
  researchMd,
  freshnessMd,
  continuityMd,
  curationMd,
  antiLoopMd,
].map(parseSkill);

/**
 * Pick the skills relevant to a request: always-on skills plus any whose
 * trigger substring appears in the prompt (case-insensitive). Registry order
 * is preserved.
 */
export function selectSkills(prompt: string, skills: Skill[] = BUNDLED_SKILLS): Skill[] {
  const p = prompt.toLowerCase();
  return skills.filter(
    (s) => s.always || s.triggers.some((t) => p.includes(t)),
  );
}

export interface ComposeOptions {
  /** Raw user request; drives skill trigger matching. */
  prompt: string;
  /** Date appended to the prompt footer (training-cutoff disclaimer). */
  now?: Date;
  /** Force-include the continuity skill (prior-playlist seed context). */
  hasPriorPlaylist?: boolean;
  /** Skill registry override for tests. */
  skills?: Skill[];
}

/**
 * Assemble the agent-mode system prompt: base curator contract + agent
 * preamble, then the selected skills as `## Skill: <name>` sections (clarify
 * pinned first so the ask-before-curating rule isn't buried), then the
 * current-date footer. Replaces the old monolithic
 * GENERATE_PLAYLIST_AGENT_SYSTEM / agentSystemPrompt pair.
 */
export function composeAgentSystem(opts: ComposeOptions): string {
  const registry = opts.skills ?? BUNDLED_SKILLS;
  const selected = selectSkills(opts.prompt, registry);
  if (opts.hasPriorPlaylist) {
    const continuity = registry.find((s) => s.name === "continuity");
    if (continuity && !selected.includes(continuity)) selected.push(continuity);
  }
  selected.sort((a, b) => Number(b.name === "clarify") - Number(a.name === "clarify"));

  const date = (opts.now ?? new Date()).toISOString().slice(0, 10);
  const sections = selected.map((s) => `## Skill: ${s.name}\n${s.body}`);
  return [
    GENERATE_PLAYLIST_SYSTEM,
    "You are running in agent mode with tools available. Follow the skills below — they are your workflow. When your tracklist is ready, call finalize_playlist with the curated ordered list; the harness stops at this call.",
    ...sections,
    `Today's date is ${date}. Your training data ends earlier than this — releases from the recent months may exist that you don't know about. When the request mentions "new", "latest", or a year at or after your knowledge cutoff, trust web_search results over your own memory.`,
  ].join("\n\n");
}

/** RU+EN request boilerplate that carries no curation signal. */
const FILLER_WORDS = new Set([
  // EN
  "a", "an", "the", "some", "please", "make", "create", "build", "give", "me",
  "my", "i", "want", "need", "for", "of", "to", "and", "with", "playlist",
  "songs", "song", "tracks", "track", "music", "mix", "list",
  // RU
  "сделай", "создай", "собери", "дай", "мне", "мой", "мою", "хочу", "нужен",
  "нужна", "нужно", "для", "и", "с", "под", "на", "из", "плейлист", "песни",
  "песен", "песню", "треки", "треков", "музыка", "музыку", "подборка",
  "подборку", "микс",
]);

/**
 * Ambiguity heuristic for forcing a first-turn clarify tool call. A request
 * is vague when, after dropping filler ("make me a playlist of…", «сделай
 * мне плейлист…»), at most 4 content words remain — unless it carries a
 * concrete pin (a year, a decade like "80s"/«90-е», or a track count),
 * which means the user already knows what they want. The gray zone stays
 * with the clarify skill prompt.
 */
export function isVagueRequest(prompt: string): boolean {
  const trimmed = prompt.trim().toLowerCase();
  if (trimmed.length === 0) return false;
  if (/\b(19|20)\d{2}\b/.test(trimmed)) return false;
  if (/\b\d0\s*-?\s*(s|е|х)(?!\p{L})/u.test(trimmed)) return false;
  if (/\b\d+\s*(tracks?|songs?|треков|трека|песен|песни)(?!\p{L})/u.test(trimmed)) return false;
  const content = trimmed
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((w) => w.length > 0 && !FILLER_WORDS.has(w));
  return content.length <= 4;
}
