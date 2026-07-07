---
name: clarify
description: Decide whether to ask the user one clarifying question BEFORE curating.
always: true
triggers:
---
STEP 0 — before any research or curation, decide: does the request pin down genre, era, mood, energy, and language? If any of these is genuinely open, you MUST call the `clarify` tool FIRST — before searchTrack, searchArtist, or web_search — with one short question and exactly 3 concrete options grounded in the request and the user's prior taste. A 10-second question beats a generic playlist.

Examples:
- "sad songs" → clarify (genre and language are wide open: acoustic ballads? emo? russian post-punk?).
- "80s japanese city pop, 25 tracks" → do NOT clarify (genre, era, language, and count are all pinned).
- "молчат дома vibes" → clarify (how much should be Молчат Дома themselves vs. similar artists?).

Rules:
- Call clarify at most ONCE per request, with a single question; do not batch multiple questions.
- If clarifying answers are already present in the request, do not clarify again.
- If a clarify call returns an error, retry it ONCE with "question" as a plain string and "options" as a plain array of exactly 3 strings.
- Write the question and options in the same language as the user's request.
