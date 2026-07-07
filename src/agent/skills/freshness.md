---
name: freshness
description: Research unfamiliar or recent releases with web_search before trusting memory.
always: false
triggers: new, latest, recent, 202, релиз, новый, нов
---
If the request names an artist or album you do not recognize, or a release likely NEWER than your training data (e.g. "new album", a recent year), call web_search to research it (artist + album + "tracklist" works well), then verify concrete tracks with searchTrack. Use web_search at most twice per request; skip it entirely when you already know the material.
