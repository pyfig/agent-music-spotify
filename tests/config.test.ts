import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";

// CONFIG_DIR is derived from homedir() at module-eval time, so each case gets
// a fresh HOME sandbox plus a query-string import to bust Bun's module cache.
const savedHome = process.env.HOME;
const savedBackend = process.env.MUSIC_BACKEND;
const sandboxes: string[] = [];
let seq = 0;

async function loadSandboxed(opts: { file?: Record<string, unknown>; env?: string } = {}) {
  const home = mkdtempSync(join(tmpdir(), "music-agent-config-"));
  sandboxes.push(home);
  process.env.HOME = home;
  if (opts.env === undefined) {
    delete process.env.MUSIC_BACKEND;
  } else {
    process.env.MUSIC_BACKEND = opts.env;
  }
  if (opts.file) {
    const dir = join(home, ".config", "spotify-harness-tui");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify(opts.file));
  }
  const mod = (await import(`../src/config.ts?sandbox=${++seq}`)) as typeof import("../src/config");
  return mod.loadConfig();
}

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedBackend === undefined) delete process.env.MUSIC_BACKEND;
  else process.env.MUSIC_BACKEND = savedBackend;
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("musicBackend default", () => {
  test("no env, no file → youtube-music", async () => {
    const config = await loadSandboxed();
    expect(config.musicBackend).toBe("youtube-music");
  });

  test("invalid file value falls through to youtube-music", async () => {
    const config = await loadSandboxed({ file: { musicBackend: "not-a-backend" } });
    expect(config.musicBackend).toBe("youtube-music");
  });

  test("file value wins over the default", async () => {
    const config = await loadSandboxed({ file: { musicBackend: "spotify" } });
    expect(config.musicBackend).toBe("spotify");
  });

  test("env wins over file and default", async () => {
    const config = await loadSandboxed({ file: { musicBackend: "spotify" }, env: "soundcloud" });
    expect(config.musicBackend).toBe("soundcloud");
  });
});
