/**
 * Live end-to-end check of the skills + forced-clarify feature against the
 * opencode go backend. No Spotify auth needed — the music backend is stubbed
 * so the run exercises only the provider + agent loop.
 *
 * Run: bun e2e_clarify_check.ts
 */
import { loadConfig } from "./src/config";
import { OpencodeProvider } from "./src/agent/providers/opencode";
import { composeAgentSystem, BUNDLED_SKILLS } from "./src/agent/skills";
import { resolvePlaylist } from "./src/core/generate-playlist";
import type { MusicProvider, Track } from "./src/music/types";

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const stubMusic: MusicProvider = {
  name: "spotify",
  capabilities: { remotePlaylists: false, remotePlayback: false, localPlayback: false },
  searchTrack: async (artist, title): Promise<Track> => ({ uri: `stub:${artist}:${title}`, artist, title }),
  searchArtist: async (name) => ({ id: `stub-artist-${name}`, name }),
  getArtistTopTracks: async () => [],
} as MusicProvider;

// 1. Skills present in the composed system prompt.
const system = composeAgentSystem({ prompt: "грустные песни" });
for (const name of ["clarify", "curation", "research"]) {
  if (!system.includes(`## Skill: ${name}`)) fail(`composed system prompt is missing skill "${name}"`);
}
if (system.indexOf("## Skill: clarify") > system.indexOf("## Skill: curation")) {
  fail("clarify skill is not pinned first");
}
console.log(`ok: system prompt carries ${BUNDLED_SKILLS.filter((s) => s.always).length} always-on skills, clarify pinned first`);

// 2. Provider from the real config (opencode go).
const config = await loadConfig();
if (!config.opencodeGoApiKey) fail("OPENCODE_GO_API_KEY is not configured");
const provider = new OpencodeProvider({
  name: "opencode-go",
  apiKey: config.opencodeGoApiKey,
  baseUrl: config.opencodeGoBaseUrl,
  model: config.opencodeGoModel,
});
console.log(`ok: provider opencode-go, model ${config.opencodeGoModel}`);

// 3. Vague prompt → forced clarify must fire with a question + 3 options.
let clarifyCount = 0;
const vague = await resolvePlaylist(provider, stubMusic, "грустные песни", [], {
  onClarifyTool: async (question, options) => {
    clarifyCount++;
    console.log(`clarify fired: ${JSON.stringify(question)} options=${JSON.stringify(options)}`);
    if (!question.trim()) fail("clarify question is empty");
    if (options.length !== 3) fail(`expected 3 clarify options, got ${options.length}`);
    return options[0]!;
  },
});
if (clarifyCount !== 1) fail(`expected clarify to fire exactly once on the vague prompt, fired ${clarifyCount}x`);
if (vague.resolved.length === 0) fail("vague-prompt run produced no tracks");
console.log(`ok: vague prompt → clarify fired once, playlist "${vague.name}" with ${vague.resolved.length} tracks`);
console.log(vague.resolved.slice(0, 5).map((t) => `  ${t.artist} — ${t.title}`).join("\n"));

// 4. Pinned prompt → clarify must not be *forced* (skill may still ask; log only).
let pinnedClarify = 0;
const pinned = await resolvePlaylist(provider, stubMusic, "80s japanese city pop, 25 tracks", [], {
  onClarifyTool: async (question, options) => {
    pinnedClarify++;
    console.log(`note: model chose to clarify on the pinned prompt: ${JSON.stringify(question)}`);
    return options[0]!;
  },
});
if (pinned.resolved.length === 0) fail("pinned-prompt run produced no tracks");
console.log(
  `ok: pinned prompt → playlist "${pinned.name}" with ${pinned.resolved.length} tracks` +
    (pinnedClarify ? ` (model voluntarily clarified ${pinnedClarify}x)` : " (no clarify, as expected)"),
);

console.log("\nE2E CLARIFY CHECK PASSED");
