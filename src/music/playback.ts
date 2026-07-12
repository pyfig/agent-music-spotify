import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chmodSync, mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import type { MusicBackend, MusicProvider, Track } from "./types";

/** Clamp a volume value to 0-100 and round to integer. */
function clampVolume(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/** Minimal surface of mpv's JSON IPC we depend on; injectable for tests. */
export interface MpvHandle {
  send(cmd: unknown[]): Promise<unknown>;
  onEvent(cb: (ev: any) => void): void;
  kill(): Promise<void>;
}

export interface PlayingState {
  track: Track | null;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number | null;
  volume: number | null;
}

/**
 * Spotify Connect-style backend: playback lives on the service side.
 * SpotifyClient satisfies this structurally.
 */
export interface RemotePlaybackClient {
  play(uri: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  getCurrentlyPlaying(): Promise<{
    uri: string | null;
    isPlaying: boolean;
    volume?: number | null;
    progressMs?: number | null;
    durationMs?: number | null;
  } | null>;
  setVolume?(percent: number): Promise<void>;
}

interface PlayerDeps {
  startMpv?: (socketPath: string) => Promise<MpvHandle>;
}

/** Exported for tests — POSIX path must live in a 0700 per-user dir and be pid-scoped. */
export const socketPath = () => {
  if (process.platform === "win32") {
    // Named-pipe namespace is already per-user/ACL'd on Windows; pid scoping
    // keeps concurrent instances isolated.
    return `\\\\.\\pipe\\music-agent-mpv-${process.pid}`;
  }
  // On POSIX the socket lives in a 0700 per-user directory so other local
  // users can't connect to (or squat on) our mpv IPC endpoint — tmpdir()
  // itself is world-traversable on shared machines. The explicit chmod
  // re-tightens a pre-existing dir (mkdir mode is umask-filtered and ignored
  // when the dir exists) and throws if another user owns the path, which is
  // exactly when we must not use it.
  const dir = join(tmpdir(), `music-agent-${process.getuid?.() ?? "user"}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return join(dir, `mpv-${process.pid}.sock`);
};

/** Exported for tests — the spawn path uses it to wait for mpv's socket. */
export async function connectWithRetry(path: string, timeoutMs: number): Promise<Socket> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await new Promise<Socket>((resolve, reject) => {
        // Handlers must be attached BEFORE connect() is initiated: Bun emits
        // the unix-socket ENOENT error synchronously inside the connect call,
        // so createConnection(path) would fire "error" with no listener yet —
        // an unhandled error event that crashes the process instead of
        // triggering a retry. Persistent error handler + destroy: a second
        // "error" emission on a failed connect would otherwise hit an empty
        // listener list with the same crash.
        const sock = new Socket();
        sock.once("connect", () => resolve(sock));
        sock.on("error", (e) => {
          sock.destroy();
          reject(e);
        });
        sock.connect(path);
      });
    } catch (e) {
      if (Date.now() > deadline) throw new Error(`mpv IPC socket did not appear at ${path}: ${e}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

async function spawnMpv(sock: string): Promise<MpvHandle> {
  const proc = Bun.spawn(
    [
      "mpv",
      "--no-video",
      "--idle=yes",
      "--no-terminal",
      `--input-ipc-server=${sock}`,
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  const socket = await connectWithRetry(sock, 5000);

  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const eventCbs: ((ev: any) => void)[] = [];
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    for (;;) {
      const nl = buffer.indexOf("\n");
      if (nl < 0) break;
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.request_id !== undefined && pending.has(msg.request_id)) {
        const p = pending.get(msg.request_id)!;
        pending.delete(msg.request_id);
        if (msg.error === "success") p.resolve(msg.data);
        else p.reject(new Error(`mpv: ${msg.error}`));
      } else if (msg.event) {
        for (const cb of eventCbs) cb(msg);
      }
    }
  });

  return {
    send(cmd: unknown[]): Promise<unknown> {
      const request_id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(request_id, { resolve, reject });
        socket.write(`${JSON.stringify({ command: cmd, request_id })}\n`);
      });
    },
    onEvent(cb) {
      eventCbs.push(cb);
    },
    async kill() {
      socket.destroy();
      proc.kill();
      await proc.exited.catch(() => {});
      if (process.platform !== "win32") await unlink(sock).catch(() => {});
    },
  };
}

/**
 * Single playback facade for the app. Local backends (SoundCloud, YTM) play
 * through one mpv process driven over JSON IPC; Spotify delegates to its
 * remote Web API client. app.tsx never branches on backend itself.
 */
export class PlayerController {
  private mpv: MpvHandle | null = null;
  private startMpv: (sock: string) => Promise<MpvHandle>;
  private queueTracks: Track[] = [];
  private queueIndex = 0;
  private provider: MusicProvider | null = null;
  private isPlayingLocal = false;
  private remote: RemotePlaybackClient | null = null;
  private remoteTrack: Track | null = null;
  // Last known volume (0-100). Persisted via config; applied to mpv on spawn
  // and to Spotify on play. Kept in sync with the backend by getCurrentlyPlaying.
  private volume = 100;

  constructor(deps: PlayerDeps = {}) {
    this.startMpv = deps.startMpv ?? spawnMpv;
  }

  /** Route play/pause/resume to a remote (Spotify) client instead of mpv. */
  setRemote(client: RemotePlaybackClient | null): void {
    this.remote = client;
  }

  /** Set the desired volume before mpv starts; applied on ensureMpv(). */
  setInitialVolume(pct: number): void {
    this.volume = clampVolume(pct);
  }

  private async ensureMpv(): Promise<MpvHandle> {
    if (this.mpv) return this.mpv;
    const handle = await this.startMpv(socketPath());
    handle.onEvent((ev) => {
      if (ev.event === "end-file" && ev.reason === "eof") {
        if (this.queueIndex >= this.queueTracks.length - 1) {
          // Final track finished — reflect the stopped state so the UI drops
          // the ▶ marker; mpv stays idle for the next queue.
          this.isPlayingLocal = false;
        } else {
          void this.next();
        }
      }
    });
    this.mpv = handle;
    // Apply the configured volume as soon as mpv is up so the first track
    // plays at the right level instead of mpv's default (100).
    try {
      await handle.send(["set_property", "volume", this.volume]);
    } catch {
      // volume property set can fail on some mpv builds with no audio sink yet
    }
    return handle;
  }

  async queue(tracks: Track[], provider: MusicProvider): Promise<void> {
    if (tracks.length === 0) return;
    this.queueTracks = tracks;
    this.queueIndex = 0;
    this.provider = provider;
    await this.playCurrent();
  }

  async playLocal(track: Track, provider: MusicProvider): Promise<void> {
    await this.queue([track], provider);
  }

  private async playCurrent(): Promise<void> {
    const track = this.queueTracks[this.queueIndex];
    const provider = this.provider;
    if (!track || !provider?.resolvePlayableUrl) return;
    const url = await provider.resolvePlayableUrl(track);
    const mpv = await this.ensureMpv();
    await mpv.send(["loadfile", url, "replace"]);
    await mpv.send(["set_property", "pause", false]);
    this.isPlayingLocal = true;
  }

  async next(): Promise<void> {
    if (this.queueIndex >= this.queueTracks.length - 1) return;
    this.queueIndex++;
    await this.playCurrent();
  }

  async prev(): Promise<void> {
    if (this.queueIndex === 0) return;
    this.queueIndex--;
    await this.playCurrent();
  }

  async pause(): Promise<void> {
    if (this.remote) {
      await this.remote.pause();
      return;
    }
    await this.mpv?.send(["set_property", "pause", true]);
    this.isPlayingLocal = false;
  }

  async resume(): Promise<void> {
    if (this.remote) {
      await this.remote.resume();
      return;
    }
    await this.mpv?.send(["set_property", "pause", false]);
    this.isPlayingLocal = true;
  }

  /** Set volume on the active backend (mpv or remote Spotify). 0-100. */
  async setVolume(pct: number): Promise<void> {
    this.volume = clampVolume(pct);
    if (this.remote) {
      await this.remote.setVolume?.(this.volume);
      return;
    }
    if (this.mpv) {
      try {
        await this.mpv.send(["set_property", "volume", this.volume]);
      } catch {
        // mpv not ready yet — volume will be applied on next ensureMpv.
      }
    }
  }

  /** Remote branch needs the Track for display; caller passes what it played. */
  async playRemote(track: Track): Promise<void> {
    if (!this.remote) throw new Error("no remote playback client attached");
    await this.remote.play(track.uri);
    this.remoteTrack = track;
  }

  async getCurrentlyPlaying(): Promise<PlayingState | null> {
    if (this.remote) {
      const state = await this.remote.getCurrentlyPlaying();
      if (!state) return null;
      if (typeof state.volume === "number") this.volume = clampVolume(state.volume);
      return {
        track: this.remoteTrack,
        isPlaying: state.isPlaying,
        positionMs: state.progressMs ?? 0,
        durationMs: state.durationMs ?? this.remoteTrack?.durationMs ?? null,
        volume: state.volume ?? this.volume,
      };
    }
    const track = this.queueTracks[this.queueIndex];
    if (!this.mpv || !track) return null;
    const pos = (await this.mpv.send(["get_property", "time-pos"]).catch(() => 0)) as
      | number
      | null;
    const dur = (await this.mpv.send(["get_property", "duration"]).catch(() => null)) as
      | number
      | null;
    const vol = (await this.mpv.send(["get_property", "volume"]).catch(() => null)) as
      | number
      | null;
    if (typeof vol === "number") this.volume = clampVolume(vol);
    return {
      track,
      isPlaying: this.isPlayingLocal,
      positionMs: Math.round((pos ?? 0) * 1000),
      durationMs:
        typeof dur === "number" && dur > 0 ? Math.round(dur * 1000) : track.durationMs ?? null,
      volume: typeof vol === "number" ? clampVolume(vol) : this.volume,
    };
  }

  async stop(): Promise<void> {
    this.queueTracks = [];
    this.queueIndex = 0;
    this.isPlayingLocal = false;
    if (this.mpv) {
      const mpv = this.mpv;
      this.mpv = null;
      await mpv.kill();
    }
  }
}

/** Shared app-wide instance; app.tsx and cleanup hooks use this one. */
export const player = new PlayerController();

/**
 * Local backends need external binaries. Fail early with install hints
 * instead of a cryptic spawn error mid-playback. `which` is injectable for
 * tests (Bun.which resolves against the process's original PATH).
 */
export function checkLocalPlaybackDeps(
  backend: MusicBackend,
  which: (cmd: string) => string | null = (cmd) => Bun.which(cmd),
): string | null {
  if (backend === "spotify") return null;
  if (!which("mpv")) {
    return `${backend} playback needs mpv — install it: brew install mpv (macOS) / apt install mpv (Linux)`;
  }
  if (backend === "youtube-music" && !which("yt-dlp")) {
    return "youtube-music playback needs yt-dlp — install it: brew install yt-dlp (macOS) / apt install yt-dlp (Linux)";
  }
  return null;
}
