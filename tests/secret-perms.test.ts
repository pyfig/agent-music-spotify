import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, statSync, chmodSync, writeFileSync } from "node:fs";
import { writeTokens } from "../src/spotify/auth";
import { hardenSecretFile, ensureSecretDir } from "../src/config";
import type { Config } from "../src/config";

// chmod semantics are POSIX-only; on Windows the helpers are deliberate no-ops.
const posixOnly = test.skipIf(process.platform === "win32");

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

describe("secret file permissions", () => {
  posixOnly("writeTokens creates tokens.json with mode 600", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vibedeck-perm-"));
    try {
      await writeTokens({ configDir: dir } as Config, {
        accessToken: "tok",
        refreshToken: "ref",
        expiresAt: Date.now() + 3600_000,
        scopes: "playlist-modify-public",
      });
      expect(modeOf(join(dir, "tokens.json"))).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  posixOnly("hardenSecretFile tightens an existing wide-open file", () => {
    const dir = mkdtempSync(join(tmpdir(), "vibedeck-perm-"));
    try {
      const file = join(dir, "config.json");
      writeFileSync(file, "{}");
      chmodSync(file, 0o644);
      hardenSecretFile(file);
      expect(modeOf(file)).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  posixOnly("hardenSecretFile on missing file does not throw", () => {
    expect(() => hardenSecretFile("/nonexistent/definitely/missing.json")).not.toThrow();
  });

  posixOnly("ensureSecretDir creates dir with mode 700", () => {
    const dir = mkdtempSync(join(tmpdir(), "vibedeck-perm-"));
    try {
      const nested = join(dir, "cfg");
      ensureSecretDir(nested);
      expect(modeOf(nested)).toBe(0o700);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
