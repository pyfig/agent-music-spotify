import { describe, expect, test } from "bun:test";
import { PlayerController, type MpvHandle } from "../src/music/playback";
import type { MusicProvider, Track } from "../src/music/types";

function makeTrack(n: number): Track {
  return { uri: `sc:${n}`, title: `Song ${n}`, artist: `Artist ${n}` };
}

class FakeMpv implements MpvHandle {
  commands: unknown[][] = [];
  killed = false;
  properties: Record<string, unknown> = { "time-pos": 12.5, duration: 200 };
  private eventCb: ((ev: any) => void) | null = null;

  async send(cmd: unknown[]): Promise<unknown> {
    this.commands.push(cmd);
    if (cmd[0] === "get_property") return this.properties[cmd[1] as string];
    return null;
  }
  onEvent(cb: (ev: any) => void): void {
    this.eventCb = cb;
  }
  emit(ev: any): void {
    this.eventCb?.(ev);
  }
  async kill(): Promise<void> {
    this.killed = true;
  }
}

function makeLocalProvider(): MusicProvider {
  return {
    name: "soundcloud",
    capabilities: { remotePlaylists: false, remotePlayback: false, localPlayback: true },
    searchTrack: async () => null,
    searchArtist: async () => null,
    getArtistTopTracks: async () => [],
    resolvePlayableUrl: async (t) => `https://stream.example/${t.uri}`,
  };
}

function makeController() {
  const mpv = new FakeMpv();
  const controller = new PlayerController({ startMpv: async () => mpv });
  return { mpv, controller };
}

describe("PlayerController local playback", () => {
  test("queue resolves url and loads first track", async () => {
    const { mpv, controller } = makeController();
    await controller.queue([makeTrack(1), makeTrack(2)], makeLocalProvider());
    expect(mpv.commands).toContainEqual(["loadfile", "https://stream.example/sc:1", "replace"]);
    const state = await controller.getCurrentlyPlaying();
    expect(state?.track?.uri).toBe("sc:1");
    expect(state?.isPlaying).toBe(true);
  });

  test("end-file eof advances to next track", async () => {
    const { mpv, controller } = makeController();
    await controller.queue([makeTrack(1), makeTrack(2)], makeLocalProvider());
    mpv.emit({ event: "end-file", reason: "eof" });
    await Bun.sleep(0);
    expect(mpv.commands).toContainEqual(["loadfile", "https://stream.example/sc:2", "replace"]);
    const state = await controller.getCurrentlyPlaying();
    expect(state?.track?.uri).toBe("sc:2");
  });

  test("next/prev move within queue and clamp", async () => {
    const { mpv, controller } = makeController();
    await controller.queue([makeTrack(1), makeTrack(2)], makeLocalProvider());
    await controller.next();
    expect((await controller.getCurrentlyPlaying())?.track?.uri).toBe("sc:2");
    await controller.next(); // clamp at end
    expect((await controller.getCurrentlyPlaying())?.track?.uri).toBe("sc:2");
    await controller.prev();
    expect((await controller.getCurrentlyPlaying())?.track?.uri).toBe("sc:1");
    void mpv;
  });

  test("pause/resume toggle mpv pause property and state", async () => {
    const { mpv, controller } = makeController();
    await controller.queue([makeTrack(1)], makeLocalProvider());
    await controller.pause();
    expect(mpv.commands).toContainEqual(["set_property", "pause", true]);
    expect((await controller.getCurrentlyPlaying())?.isPlaying).toBe(false);
    await controller.resume();
    expect(mpv.commands).toContainEqual(["set_property", "pause", false]);
    expect((await controller.getCurrentlyPlaying())?.isPlaying).toBe(true);
  });

  test("getCurrentlyPlaying reports position from mpv time-pos", async () => {
    const { controller } = makeController();
    await controller.queue([makeTrack(1)], makeLocalProvider());
    const state = await controller.getCurrentlyPlaying();
    expect(state?.positionMs).toBe(12500);
  });

  test("stop kills mpv and clears state", async () => {
    const { mpv, controller } = makeController();
    await controller.queue([makeTrack(1)], makeLocalProvider());
    await controller.stop();
    expect(mpv.killed).toBe(true);
    expect(await controller.getCurrentlyPlaying()).toBeNull();
  });

  test("second queue reuses mpv process via loadfile", async () => {
    const { mpv, controller } = makeController();
    await controller.queue([makeTrack(1)], makeLocalProvider());
    await controller.queue([makeTrack(3)], makeLocalProvider());
    expect(mpv.killed).toBe(false);
    expect(mpv.commands).toContainEqual(["loadfile", "https://stream.example/sc:3", "replace"]);
  });
});
