import type { Config } from "../config";
import { getAccessToken } from "../spotify/auth";
import { SpotifyClient } from "../spotify/client";
import { getSoundCloudClientId, refreshSoundCloudClientId } from "./soundcloud/auth";
import { SoundCloudClient } from "./soundcloud/client";
import { YouTubeMusicClient } from "./ytmusic/client";
import type { RemotePlaybackClient } from "./playback";
import type { MusicProvider } from "./types";

export async function createMusicProvider(config: Config): Promise<MusicProvider> {
  switch (config.musicBackend) {
    case "spotify": {
      const token = await getAccessToken(config);
      return new SpotifyClient(token);
    }
    case "soundcloud": {
      const clientId = await getSoundCloudClientId(config);
      return new SoundCloudClient(clientId, refreshSoundCloudClientId);
    }
    case "youtube-music":
      return new YouTubeMusicClient();
    default:
      throw new Error(`music backend "${config.musicBackend}" is not supported`);
  }
}

/**
 * Remote playback client for PlayerController.setRemote(). Only spotify has
 * remote playback; local backends return null. Each call resolves a fresh
 * token (getAccessToken caches and refreshes internally), matching the old
 * per-operation SpotifyClient construction — a client attached for hours
 * never holds an expired token.
 */
export function createRemotePlaybackClient(config: Config): RemotePlaybackClient | null {
  if (config.musicBackend !== "spotify") return null;
  const withClient = async <T>(fn: (c: SpotifyClient) => Promise<T>): Promise<T> => {
    const token = await getAccessToken(config);
    return fn(new SpotifyClient(token));
  };
  return {
    play: (uri) => withClient((c) => c.play(uri)),
    pause: () => withClient((c) => c.pause()),
    resume: () => withClient((c) => c.resume()),
    getCurrentlyPlaying: () => withClient((c) => c.getCurrentlyPlaying()),
    setVolume: (pct) => withClient((c) => c.setVolume(pct)),
  };
}
