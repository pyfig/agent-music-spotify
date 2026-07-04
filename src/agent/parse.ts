export interface TrackRec {
  artist: string;
  title: string;
}

export interface PlaylistRec {
  name: string;
  tracks: TrackRec[];
}

function extractJson(text: string): string {
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
