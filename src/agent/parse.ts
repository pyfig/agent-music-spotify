export interface TrackRec {
  artist: string;
  title: string;
}

export interface PlaylistRec {
  name: string;
  tracks: TrackRec[];
}

export interface ClarifyQuestion {
  text: string;
  options: string[];
}

export interface ClarifyRec {
  questions: ClarifyQuestion[];
}

export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no JSON object found in response");
  }
  return candidate.slice(start, end + 1);
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
  return { name: json.name, tracks };
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
