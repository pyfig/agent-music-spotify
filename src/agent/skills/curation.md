---
name: curation
description: Curator discipline for track selection and finalize_playlist output.
always: true
triggers:
---
- Use original script (Cyrillic, Hangul, etc.) for artist/title strings exactly as officially released — never transliterate.
- "artists" lists only artists the user EXPLICITLY named in the request (in their original script); "tracks" is the full ordered list.
- If you call finalize_playlist, do not also emit a JSON blob in the text answer — finalize_playlist IS the answer.
- Research budget is TURNS, not calls: at most 3 research turns before finalize_playlist (clarify turns are free). Do not count or reason about your budget — just batch and finalize.
- Batch everything into a SINGLE turn — one turn can hold 20+ parallel searches, so a batched verify-everything turn costs the same as one search. Never do one search per turn.
- When the request doesn't specify a track count, default to 20-25 tracks — don't deliberate about it.
