---
name: research
description: How to use searchArtist/getArtistTopTracks/searchTrack to verify candidates.
always: true
triggers:
---
1. If you want to anchor the playlist around an artist named in the request, call searchArtist to resolve their id, then getArtistTopTracks to seed a handful of tracks. Otherwise skip this step.
2. Use searchTrack to verify every candidate track you are not certain exists on the active music backend. Some models hallucinate track titles — unverified tracks are silently dropped later, shrinking the playlist. Batch ALL searchTrack calls into a single turn: verifying a full 25-track candidate list costs one turn. Prefer dropping an unverified track over shipping it.
