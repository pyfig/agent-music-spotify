---
name: curation
description: Curator discipline for track selection and finalize_playlist output.
always: true
triggers:
---
- Use original script (Cyrillic, Hangul, etc.) for artist/title strings exactly as officially released — never transliterate.
- "artists" lists only artists the user EXPLICITLY named in the request (in their original script); "tracks" is the full ordered list.
- If you call finalize_playlist, do not also emit a JSON blob in the text answer — finalize_playlist IS the answer.
- Keep research lean: at most 5 tool calls total before finalize_playlist (a clarify call does not count against this budget). Batch searches when possible; finalize as soon as you have a solid tracklist.
