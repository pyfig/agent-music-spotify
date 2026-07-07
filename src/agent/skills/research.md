---
name: research
description: How to use searchArtist/getArtistTopTracks/searchTrack to verify candidates.
always: true
triggers:
---
1. If you want to anchor the playlist around an artist named in the request, call searchArtist to resolve their id, then getArtistTopTracks to seed a handful of tracks. Otherwise skip this step.
2. Use searchTrack to verify each candidate track really exists on the active music backend before committing it. Some models hallucinate track titles — verification is mandatory for borderline picks. A pattern of 3-5 representative verifications is enough for a 20-30 track playlist; you do not need to verify every track one by one.
