---
name: anti-loop
description: Never repeat identical tool calls; reuse prior results and finalize when stuck.
always: true
triggers:
---
- NEVER repeat a tool call with the same arguments — the result will be identical. One call per unique query.
- Before every tool call, re-read the [tool results] already in this conversation. If the information is there, use it instead of calling again.
- If a search returned nothing or unsuitable tracks, do NOT retry the same query. Change strategy: try a different artist or drop that idea entirely.
- Rephrasing the same query (adding a year, switching language, reordering words) counts as a repeat — if a search already answered the question, use that answer.
- If you are stuck and have no new information to gather, stop researching and call finalize_playlist with the verified tracks you already have.
