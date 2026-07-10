export interface TrackRec {
  artist: string;
  title: string;
}

export interface PlaylistRec {
  name: string;
  tracks: TrackRec[];
  artists: string[];
}

export interface ClarifyQuestion {
  text: string;
  options: string[];
}

export interface ClarifyRec {
  questions: ClarifyQuestion[];
}

function scanBalancedObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : text;
  const balanced = scanBalancedObject(candidate) ?? (fenced ? scanBalancedObject(text) : undefined);
  if (!balanced) {
    throw new Error("no JSON object found in response");
  }
  return balanced;
}

export function parsePlaylistResponse(text: string): PlaylistRec {
  const json = JSON.parse(extractJson(text));
  if (!json || typeof json.name !== "string" || !Array.isArray(json.tracks)) {
    throw new Error("response missing 'name' string or 'tracks' array");
  }
  const tracks: TrackRec[] = json.tracks
    .filter((t: unknown): t is TrackRec => {
      const rec = t as Record<string, unknown>;
      return (
        typeof rec === "object" &&
        rec !== null &&
        typeof rec.artist === "string" &&
        typeof rec.title === "string"
      );
    })
    .map((t: TrackRec) => ({ artist: t.artist, title: t.title }));
  if (tracks.length === 0) {
    throw new Error("no valid tracks in response");
  }
  const artists: string[] = Array.isArray(json.artists)
    ? json.artists
        .filter((a: unknown): a is string => typeof a === "string")
        .map((a: string) => a.trim())
        .filter((a: string) => a.length > 0)
    : [];
  return { name: json.name, tracks, artists };
}

export function parseClarifyResponse(text: string): ClarifyRec {
  const json = JSON.parse(extractJson(text));
  if (!json || !Array.isArray(json.questions)) {
    throw new Error("response missing 'questions' array");
  }
  const questions: ClarifyQuestion[] = json.questions
    .filter((q: unknown): q is { text: unknown; options: unknown } => {
      const rec = q as Record<string, unknown>;
      return typeof rec === "object" && rec !== null && typeof rec.text === "string" && Array.isArray(rec.options);
    })
    .slice(0, 3)
    .map((q: { text: string; options: unknown[] }) => ({
      text: q.text,
      options: q.options.filter((o): o is string => typeof o === "string").slice(0, 3),
    }))
    .filter((q: ClarifyQuestion) => q.options.length > 0);
  return { questions };
}

export async function withRetry<T>(
  attempt: () => Promise<string>,
  parse: (text: string) => T,
): Promise<T> {
  const first = await attempt();
  try {
    return parse(first);
  } catch {
    const second = await attempt();
    return parse(second);
  }
}
