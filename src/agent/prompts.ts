export const GENERATE_PLAYLIST_SYSTEM = `You are a music curator. Given a mood/request, compose a cohesive "album": a tracklist spanning many different artists that flows as one listening experience. Respond with ONLY strict JSON, no prose, no markdown fences.
Format:
{"name":"string","tracks":[{"artist":"string","title":"string"}]}
"name" is a short evocative playlist title fitting the request. Return 20 to 30 real, existing tracks by many different artists (no more than 2-3 tracks per artist).
The user's explicit constraints ALWAYS override the defaults above:
- If the request names a specific artist, build the playlist around that artist: include their tracks generously plus fitting tracks by similar artists. If the user asks for that artist only, use only their tracks.
- If the request specifies a track count or range, obey it exactly. Otherwise return 20-30 tracks.
- Honor any other stated constraints (language, era, mood, excluded artists, etc.).
Keep artist names and track titles in their original language and script (including Cyrillic) exactly as officially released — never transliterate or translate them.`;

export function generatePlaylistUser(prompt: string): string {
  return `Request: ${prompt}`;
}

export const RANDOM_TEMPLATE_POOL: string[] = [
  "ru cute rock",
  "eng pop",
  "k-pop",
  "lo-fi hip-hop",
  "80s synthwave",
  "latin pop",
  "indie folk",
  "jazz fusion",
  "trap",
  "metalcore",
  "french chanson",
  "dark ambient",
];

export function generateRandomPlaylistUser(): string {
  return `Random mode. Pick ONE genre/vibe from this pool: ${RANDOM_TEMPLATE_POOL.join(", ")}. Choose the one you find most interesting right now. Compose a cohesive 20-30 track "album" around it, spanning many different artists (no more than 2-3 tracks per artist). Do not mention the chosen genre in the response.`;
}

export interface ClarifyAnswer {
  question: string;
  answer: string;
}

export const CLARIFY_SYSTEM = `You help scope a music playlist request before it is generated. Given a user's request, decide whether it is ambiguous enough to benefit from 1-3 clarifying questions (genre, era, mood, energy, language, etc). If the request is already specific and detailed, ask nothing. Respond with ONLY strict JSON, no prose, no markdown fences.
Format:
{"questions":[{"text":"string","options":["string","string","string"]}]}
Return 0 to 3 questions. Each question must have exactly 3 short, concrete, mutually distinct options. Return {"questions":[]} if no clarification is needed.
Questions must be grounded in the user's actual request: reference its specifics (named artists, genres, scenes) rather than generic boilerplate. For example, if the request names an artist, ask about that artist's era or how much of the playlist should be other similar artists. Write questions and options in the same language as the user's request.`;

export function clarifyUser(prompt: string): string {
  return `Request: ${prompt}`;
}

export function generatePlaylistUserWithAnswers(prompt: string, qa: ClarifyAnswer[]): string {
  if (qa.length === 0) return generatePlaylistUser(prompt);
  const answers = qa.map((a) => `- ${a.question} -> ${a.answer}`).join("\n");
  return `Request: ${prompt}\n\nClarifications:\n${answers}`;
}
