import { describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import {
  checkLocalPlaybackDeps,
  connectWithRetry,
  PlayerController,
  socketPath,
  type MpvHandle,
} from "../src/music/playback";
import { statSync } from "node:fs";
import { dirname, basename } from "node:path";
import type { MusicProvider, Track } from "../src/music/types";

function makeTrack(n: number): Track {
  return { uri: `sc:${n}`, title: `Song ${n}`, artist: `Artist ${n}` };
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

class FakeMpv implements MpvHandle {
  commands: unknown[][] = [];
  killed = false;
  private eventCb: ((ev: any) => void) | null = null;

  async send(cmd: unknown[]): Promise<unknown> {
    this.commands.push(cmd);
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

// --- checkLocalPlaybackDeps: injected `which` -----------------------------
// Bun.which resolves against the process's original PATH (mutating
// process.env.PATH has no effect), so tests inject the lookup instead.

function whichOf(available: string[]): (cmd: string) => string | null {
  return (cmd) => (available.includes(cmd) ? `/fake/bin/${cmd}` : null);
}

describe("checkLocalPlaybackDeps", () => {
  test("mpv missing: actionable hint naming mpv, for any local backend", () => {
    const err = checkLocalPlaybackDeps("soundcloud", whichOf([]));
    expect(err).toContain("mpv");
    expect(err).toContain("install");
  });

  test("yt-dlp missing: youtube-music complains, soundcloud does not", () => {
    const err = checkLocalPlaybackDeps("youtube-music", whichOf(["mpv"]));
    expect(err).toContain("yt-dlp");
    expect(checkLocalPlaybackDeps("soundcloud", whichOf(["mpv"]))).toBeNull();
  });

  test("all present: no error", () => {
    expect(checkLocalPlaybackDeps("youtube-music", whichOf(["mpv", "yt-dlp"]))).toBeNull();
    expect(checkLocalPlaybackDeps("soundcloud", whichOf(["mpv", "yt-dlp"]))).toBeNull();
  });

  test("spotify never needs local binaries", () => {
    expect(checkLocalPlaybackDeps("spotify", whichOf([]))).toBeNull();
  });
});

// --- mpv IPC socket handshake --------------------------------------------

describe("connectWithRetry", () => {
  test("connects once the socket appears (late bind)", async () => {
    const sockPath = join(mkdtempSync(join(tmpdir(), "audio-sock-")), "mpv.sock");
    const server = createServer();
    // Socket appears only after a few retry cycles, like a slow mpv startup.
    setTimeout(() => server.listen(sockPath), 250);
    const sock = await connectWithRetry(sockPath, 3000);
    sock.destroy();
    await new Promise((r) => server.close(r));
  });

  test("socket never appears: bounded timeout, error names the socket", async () => {
    const sockPath = join(mkdtempSync(join(tmpdir(), "audio-sock-")), "never.sock");
    const started = Date.now();
    await expect(connectWithRetry(sockPath, 400)).rejects.toThrow(
      /mpv IPC socket did not appear at .*never\.sock/,
    );
    // Bounded: timeout + one retry sleep, not hanging forever.
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe("socketPath scoping (POSIX)", () => {
  test.if(process.platform !== "win32")(
    "socket lives in a 0700 per-user dir and is pid-scoped",
    () => {
      const path = socketPath();
      const dir = dirname(path);
      const mode = statSync(dir).mode & 0o777;
      expect(mode).toBe(0o700);
      expect(dir).toContain(`music-agent-${process.getuid?.()}`);
      // pid scoping keeps concurrent instances from cross-driving each other
      expect(basename(path)).toBe(`mpv-${process.pid}.sock`);
    },
  );
});

describe("PlayerController startup", () => {
  test("startMpv success: load command issued and playing state reported", async () => {
    const mpv = new FakeMpv();
    const controller = new PlayerController({ startMpv: async () => mpv });
    await controller.queue([makeTrack(1)], makeLocalProvider());
    expect(mpv.commands).toContainEqual(["loadfile", "https://stream.example/sc:1", "replace"]);
    expect(mpv.commands).toContainEqual(["set_property", "pause", false]);
    const state = await controller.getCurrentlyPlaying();
    expect(state?.isPlaying).toBe(true);
  });

  test("startMpv failure surfaces the error and retains no zombie handle", async () => {
    let calls = 0;
    const mpv = new FakeMpv();
    const controller = new PlayerController({
      startMpv: async () => {
        calls++;
        if (calls === 1) throw new Error("mpv IPC socket did not appear at /tmp/x.sock: timeout");
        return mpv;
      },
    });
    await expect(controller.queue([makeTrack(1)], makeLocalProvider())).rejects.toThrow(
      /mpv IPC socket did not appear/,
    );
    // No zombie: controller reports nothing playing after the failure…
    expect(await controller.getCurrentlyPlaying()).toBeNull();
    // …and the next attempt spawns mpv again instead of reusing a dead handle.
    await controller.queue([makeTrack(1)], makeLocalProvider());
    expect(calls).toBe(2);
    expect(mpv.commands).toContainEqual(["loadfile", "https://stream.example/sc:1", "replace"]);
  });
});

describe("queue auto-advance", () => {
  test("mid-queue eof advances to the next track", async () => {
    const mpv = new FakeMpv();
    const controller = new PlayerController({ startMpv: async () => mpv });
    await controller.queue([makeTrack(1), makeTrack(2)], makeLocalProvider());
    mpv.emit({ event: "end-file", reason: "eof" });
    await Bun.sleep(0);
    expect(mpv.commands).toContainEqual(["loadfile", "https://stream.example/sc:2", "replace"]);
    expect((await controller.getCurrentlyPlaying())?.isPlaying).toBe(true);
  });

  test("eof on the final track stops cleanly: no error, playing state cleared", async () => {
    const mpv = new FakeMpv();
    const controller = new PlayerController({ startMpv: async () => mpv });
    await controller.queue([makeTrack(1), makeTrack(2)], makeLocalProvider());
    mpv.emit({ event: "end-file", reason: "eof" }); // → track 2
    await Bun.sleep(0);
    mpv.emit({ event: "end-file", reason: "eof" }); // final track ends
    await Bun.sleep(0);
    const state = await controller.getCurrentlyPlaying();
    expect(state?.isPlaying).toBe(false);
    // No extra loadfile beyond the two real tracks.
    const loads = mpv.commands.filter((c) => c[0] === "loadfile");
    expect(loads).toHaveLength(2);
  });
});
