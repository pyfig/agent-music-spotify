import type { Config } from "../config";
import { getAccessToken } from "../spotify/auth";
import { SpotifyClient } from "../spotify/client";
import { getSoundCloudClientId, refreshSoundCloudClientId } from "./soundcloud/auth";
import { SoundCloudClient } from "./soundcloud/client";
import { YouTubeMusicClient } from "./ytmusic/client";
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
