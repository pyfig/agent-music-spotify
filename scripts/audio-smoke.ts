// Manual end-to-end audio smoke check — NOT part of `bun test` (needs real
// mpv, network, and an audio device). Run:
//
//   bun scripts/audio-smoke.ts [backend] ["artist"] ["title"]
//
// backend: soundcloud (default) | youtube-music
//
// Verifies the real launch path the unit tests fake: dependency preflight →
// provider search/resolve → mpv spawn → IPC socket handshake → loadfile →
// mpv reports playback progressing. Exits non-zero on any failure.

import { checkLocalPlaybackDeps, PlayerController } from "../src/music/playback";
import { loadConfig } from "../src/config";
import { createMusicProvider } from "../src/music/factory";
import type { MusicBackend } from "../src/music/types";

const TIMEOUT_MS = 30_000;

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const backend = (process.argv[2] ?? "soundcloud") as MusicBackend;
const artist = process.argv[3] ?? "Daft Punk";
const title = process.argv[4] ?? "Harder Better Faster Stronger";

if (backend === "spotify") fail("spotify plays remotely — smoke check covers local backends only");

const depErr = checkLocalPlaybackDeps(backend);
if (depErr) fail(`dependency preflight: ${depErr}`);
console.log(`✓ deps present for ${backend}`);

const config = await loadConfig();
const provider = await createMusicProvider({ ...config, musicBackend: backend });

const track = await provider.searchTrack(artist, title);
if (!track) fail(`could not resolve "${artist} — ${title}" on ${backend}`);
console.log(`✓ resolved: ${track.artist} — ${track.title} (${track.uri})`);

const player = new PlayerController();
// Keep the machine quiet while smoking; playback state is what we assert.
player.setInitialVolume(20);

const deadline = Date.now() + TIMEOUT_MS;
try {
  await player.queue([track], provider);
  console.log("✓ mpv spawned, IPC socket connected, loadfile issued");

  // mpv reports time-pos only once audio is actually rolling.
  for (;;) {
    if (Date.now() > deadline) fail(`mpv never reached playing state within ${TIMEOUT_MS}ms`);
    const state = await player.getCurrentlyPlaying();
    if (state?.isPlaying && state.positionMs > 0) {
      console.log(`✓ playing: position ${state.positionMs}ms / ${state.durationMs ?? "?"}ms, volume ${state.volume}%`);
      break;
    }
    await Bun.sleep(500);
  }
  console.log("✓ audio smoke check passed");
} finally {
  await player.stop();
}
process.exit(0);
