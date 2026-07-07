import type { MusicProvider, Track } from "../music/types";
import type { ToolSpec } from "./types";
import { duckDuckGoSearch, type WebSearchFn } from "./websearch";

// --- Music backend tools -------------------------------------------------

const searchTrackSpec: ToolSpec = {
  name: "searchTrack",
  description:
    "Search the active music backend for a single track by artist and title. " +
    "Returns {uri,title,artist,album?,durationMs?,artwork?} when found, or null. " +
    "Use to verify a track exists before committing it to a playlist.",
  parameters: {
    type: "object",
    properties: {
      artist: { type: "string", description: "Exact artist name, original script (no transliteration)." },
      title: { type: "string", description: "Track title as officially released." },
    },
    required: ["artist", "title"],
  },
};

const searchArtistSpec: ToolSpec = {
  name: "searchArtist",
  description:
    "Resolve an artist name to a backend-specific artist id. " +
    "Returns {id,name} or null when the backend has no match. " +
    "Use the returned id with getArtistTopTracks to seed tracks around a named artist.",
  parameters: {
    type: "object",
    properties: { name: { type: "string", description: "Artist name to resolve." } },
    required: ["name"],
  },
};

const getArtistTopTracksSpec: ToolSpec = {
  name: "getArtistTopTracks",
  description:
    "Fetch the top tracks for a resolved artist id. " +
    "Returns up to `limit` tracks. Use searchArtist first to obtain the id. " +
    "Useful when the request names an artist around which to build the playlist.",
  parameters: {
    type: "object",
    properties: {
      artistId: { type: "string", description: "Backend-specific artist id from searchArtist." },
      limit: { type: "integer", description: "How many top tracks to return (default 5).", minimum: 1, maximum: 20 },
    },
    required: ["artistId"],
  },
};

const webSearchSpec: ToolSpec = {
  name: "web_search",
  description:
    "Search the web (DuckDuckGo) for information you don't reliably know: an unfamiliar " +
    "artist, a brand-new album or release newer than your training data, or an official " +
    "tracklist you need to confirm. Returns up to 5 results as {title,url,snippet}. " +
    "Use at most twice per request, then verify concrete tracks with searchTrack.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Web search query, e.g. artist + album name + 'tracklist'." },
      reason: { type: "string", description: "Short note on why the search is needed (shown to the user)." },
    },
    required: ["query"],
  },
};

const clarifySpec: ToolSpec = {
  name: "clarify",
  description:
    "Ask the user one clarifying question with 3 concrete options. " +
    "The harness surfaces this in the TUI and returns the user's chosen answer " +
    "(one of the options or a custom free-text answer). Call when the request is " +
    "ambiguous enough to benefit from disambiguation. Call at most once per request " +
    "with a single question; do not batch multiple questions.",
  parameters: {
    type: "object",
    properties: {
      question: { type: "string", description: "One short clarifying question grounded in the user's actual request." },
      options: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 3,
        description: "Exactly 3 short, concrete, mutually distinct options.",
      },
    },
    required: ["question", "options"],
  },
};

const finalizePlaylistSpec: ToolSpec = {
  name: "finalize_playlist",
  description:
    "Commit the final playlist. Call exactly once, as the last agent step. " +
    "The harness stops the loop on this call. `tracks` should be the full " +
    "ordered tracklist; `artists` lists artist names the user explicitly named " +
    "in their request (use an empty array if none were named).",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Short evocative playlist title fitting the request." },
      tracks: {
        type: "array",
        description: "Ordered track list. 20-30 tracks by many different artists (no more than 2-3 per artist). " +
          "Artist names and titles in their original script, never transliterated.",
        items: {
          type: "object",
          properties: {
            artist: { type: "string" },
            title: { type: "string" },
          },
          required: ["artist", "title"],
        },
        minItems: 1,
      },
      artists: {
        type: "array",
        items: { type: "string" },
        description: "Artists explicitly named in the user's request, in their original script. Empty array if none.",
      },
    },
    required: ["name", "tracks", "artists"],
  },
};

export const MUSIC_AGENT_TOOLS: ToolSpec[] = [
  searchTrackSpec,
  searchArtistSpec,
  getArtistTopTracksSpec,
  webSearchSpec,
  clarifySpec,
  finalizePlaylistSpec,
];

export interface ToolDispatcherDeps {
  music: MusicProvider;
  /** Clarify tool callback: presents the question in the UI and awaits the user's answer. */
  onClarify?: (question: string, options: string[]) => Promise<string>;
  /** Progress callback for per-tool telemetry. */
  onToolStart?: (name: string, args: Record<string, unknown>) => void;
  onToolEnd?: (name: string, result: unknown) => void;
  /** Web search implementation override; defaults to the built-in DuckDuckGo scraper. */
  webSearch?: WebSearchFn;
}

/** Normalize a `Track | null` to a tool-result-safe JSON object. */
function trackToResult(t: Track | null): Record<string, unknown> | null {
  if (!t) return null;
  const out: Record<string, unknown> = { uri: t.uri, title: t.title, artist: t.artist };
  if (t.album) out.album = t.album;
  if (typeof t.durationMs === "number") out.durationMs = t.durationMs;
  if (t.artwork) out.artwork = t.artwork;
  return out;
}

/**
 * Recover args from streaming providers that failed to parse accumulated tool
 * arg JSON and passed it through as `{_raw: "<json>"}`. Also coerces field
 * values that arrived as JSON-encoded strings (some models double-encode
 * arrays). Returns the original object when nothing is recoverable.
 */
export function normalizeToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  if (typeof args._raw === "string") {
    try {
      const parsed = JSON.parse(args._raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* keep original */
    }
  }
  return args;
}

/**
 * Dispatch a single tool call against the music backend. Throws on unknown tools
 * (so the loop treats it as a transient failure and feeds the error back to the
 * model as a tool-result error). `clarify` is delegated to the supplied callback;
 * without one, `clarify` throws — callers that don't wire a UI hook disable the
 * `clarify` tool instead.
 */
export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  deps: ToolDispatcherDeps,
  signal?: AbortSignal,
): Promise<unknown> {
  args = normalizeToolArgs(args);
  deps.onToolStart?.(name, args);
  signal?.throwIfAborted();
  let result: unknown;
  switch (name) {
    case "searchTrack": {
      const artist = String(args.artist ?? "");
      const title = String(args.title ?? "");
      result = trackToResult(await deps.music.searchTrack(artist, title));
      break;
    }
    case "searchArtist": {
      const n = String(args.name ?? "");
      result = await deps.music.searchArtist(n);
      break;
    }
    case "getArtistTopTracks": {
      const id = String(args.artistId ?? "");
      const limit = typeof args.limit === "number" ? args.limit : 5;
      result = (await deps.music.getArtistTopTracks(id, limit)).map(trackToResult);
      break;
    }
    case "web_search": {
      const query = String(args.query ?? "").trim();
      if (query.length === 0) {
        throw new Error("web_search requires a non-empty query");
      }
      result = await (deps.webSearch ?? duckDuckGoSearch)(query, signal);
      break;
    }
    case "clarify": {
      if (!deps.onClarify) {
        throw new Error("clarify tool invoked but no UI hook is wired");
      }
      const question = String(args.question ?? "");
      // Some models double-encode the options array as a JSON string.
      let rawOptions: unknown = args.options;
      if (typeof rawOptions === "string") {
        try {
          rawOptions = JSON.parse(rawOptions);
        } catch {
          /* fall through to validation below */
        }
      }
      const options = Array.isArray(rawOptions)
        ? rawOptions.map(String).slice(0, 3)
        : [];
      if (question.length === 0 || options.length === 0) {
        throw new Error("clarify requires non-empty question and options");
      }
      result = await deps.onClarify(question, options);
      break;
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
  deps.onToolEnd?.(name, result);
  return result;
}

// --- Family-specific tool schema transforms -----------------------------

/** Build the `tools` payload for the OpenAI Chat Completions API (and Ollama). */
export function toolsForOpenAIChat(specs: ToolSpec[]): unknown[] {
  return specs.map((s) => ({
    type: "function",
    function: { name: s.name, description: s.description, parameters: s.parameters },
  }));
}

/** Build the `tools` payload for the OpenAI Responses API (gpt-5 family). */
export function toolsForOpenAIResponses(specs: ToolSpec[]): unknown[] {
  return specs.map((s) => ({
    type: "function",
    name: s.name,
    description: s.description,
    parameters: s.parameters,
    strict: false,
  }));
}

/** Build the `tools` payload for the Anthropic Messages API. */
export function toolsForAnthropic(specs: ToolSpec[]): unknown[] {
  return specs.map((s) => ({
    name: s.name,
    description: s.description,
    input_schema: s.parameters,
  }));
}

/** Build the `tools` payload for the Google generateContent API (Gemini). */
export function toolsForGoogle(specs: ToolSpec[]): unknown[] {
  return [
    {
      functionDeclarations: specs.map((s) => ({
        name: s.name,
        description: s.description,
        parameters: s.parameters,
      })),
    },
  ];
}

/**
 * Pick the right tool-schema transform by ZenFamily id. Reused by `opencode.ts`
 * and the loop-side debug paths.
 */
export function toolsForFamily(family: "anthropic" | "openai-responses" | "openai-compat" | "google", specs: ToolSpec[]): unknown[] {
  switch (family) {
    case "anthropic":
      return toolsForAnthropic(specs);
    case "openai-responses":
      return toolsForOpenAIResponses(specs);
    case "google":
      return toolsForGoogle(specs);
    case "openai-compat":
    default:
      return toolsForOpenAIChat(specs);
  }
}