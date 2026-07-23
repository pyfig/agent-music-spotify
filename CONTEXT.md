# amusic / music-agent Domain

Turns a user's free-text musical intent into a playable set of tracks on a music service, via an AI agent that recommends tracks and a music backend that resolves and plays them.

## Language

**Request**:
The user's raw free-text input describing what they want to hear (a mood, a vibe, or a precise instruction).
_Avoid_: prompt (overloaded with "system prompt"), mood (informal marketing term only), query

**ClarifiedRequest**:
A `Request` plus the `ClarifyAnswer`s the agent gathered to disambiguate it.
_Avoid_: prompt+qa, clarified prompt
