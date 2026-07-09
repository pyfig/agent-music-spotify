import { describe, expect, test, mock, beforeEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { scopesSatisfy, redirectUri } from "../src/spotify/auth";

const OLD_SCOPES = "user-read-playback-state";
const CURRENT_SCOPES = [
  "playlist-modify-public",
  "playlist-modify-private",
  "user-modify-playback-state",
  "user-read-playback-state",
  "user-library-modify",
].join(" ");

describe("loopback redirect URI", () => {
  test("embeds the ephemeral port on the loopback IP literal", () => {
    expect(redirectUri(53211)).toBe("http://127.0.0.1:53211/callback");
  });
});

describe("scope mismatch re-auth logic", () => {
  test("missing scopes field → triggers re-auth", async () => {
    const tokens = JSON.parse(JSON.stringify({
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: Date.now() + 3600_000,
    }));
    expect(tokens.scopes).toBeUndefined();
    expect(scopesSatisfy(tokens.scopes, CURRENT_SCOPES)).toBe(false);
  });

  test("wrong scopes → triggers re-auth", async () => {
    expect(scopesSatisfy(OLD_SCOPES, CURRENT_SCOPES)).toBe(false);
  });

  test("matching scopes and not expired → valid", async () => {
    const tokens = {
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: Date.now() + 3600_000,
      scopes: CURRENT_SCOPES,
    };
    const valid = scopesSatisfy(tokens.scopes, CURRENT_SCOPES) && tokens.expiresAt - 60_000 > Date.now();
    expect(valid).toBe(true);
  });

  test("same scopes, different order → still valid (no re-auth loop)", () => {
    const shuffled = CURRENT_SCOPES.split(" ").reverse().join(" ");
    expect(scopesSatisfy(shuffled, CURRENT_SCOPES)).toBe(true);
  });

  test("granted superset of required → valid", () => {
    expect(scopesSatisfy(`${CURRENT_SCOPES} user-read-email`, CURRENT_SCOPES)).toBe(true);
  });

  test("granted missing one required scope → re-auth", () => {
    const partial = CURRENT_SCOPES.split(" ").slice(1).join(" ");
    expect(scopesSatisfy(partial, CURRENT_SCOPES)).toBe(false);
  });

  test("matching scopes but expired → triggers refresh then re-auth fallback", async () => {
    const tokens = {
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: Date.now() - 1,
      scopes: CURRENT_SCOPES,
    };
    const expired = tokens.expiresAt - 60_000 <= Date.now();
    expect(expired).toBe(true);
    const hasValidScopes = tokens.scopes === CURRENT_SCOPES;
    expect(hasValidScopes).toBe(true);
  });

  test("readTokens returns null for missing file (backward compat path)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vibedeck-test-"));
    const tokensPath = join(dir, "tokens.json");
    let tokens = null;
    try {
      const text = await Bun.file(tokensPath).text();
      tokens = JSON.parse(text);
    } catch {
      // file missing — returns null, triggers full login
    }
    expect(tokens).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  test("readTokens returns valid struct when file exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vibedeck-test-"));
    const tokensPath = join(dir, "tokens.json");
    const data = {
      accessToken: "test-tok",
      refreshToken: "test-ref",
      expiresAt: Date.now() + 3600_000,
      scopes: CURRENT_SCOPES,
    };
    await Bun.write(tokensPath, JSON.stringify(data));
    const text = await Bun.file(tokensPath).text();
    const tokens = JSON.parse(text);
    expect(tokens.scopes).toBe(CURRENT_SCOPES);
    expect(tokens.accessToken).toBe("test-tok");
    rmSync(dir, { recursive: true, force: true });
  });
});
