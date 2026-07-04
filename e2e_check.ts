import { loadConfig } from "./src/config";
import { getAccessToken } from "./src/spotify/auth";
import { SpotifyClient } from "./src/spotify/client";
import { ClaudeCliProvider } from "./src/agent/providers/claude-cli";
import { generatePlaylist } from "./src/core/generate-playlist";

const config = await loadConfig();
const token = await getAccessToken(config);
const spotify = new SpotifyClient(token);
const result = await generatePlaylist(new ClaudeCliProvider(), spotify, "late night neon city drive, synthwave and dark electro");
console.log("playlist:", result.playlist.name, result.playlist.url);
console.log("resolved:", result.resolved.length, "unresolved:", result.unresolved.length);
console.log(result.resolved.slice(0, 5).map((t) => `${t.artist} — ${t.name}`).join("\n"));
