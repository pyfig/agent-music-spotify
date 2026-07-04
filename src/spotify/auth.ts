import { randomBytes, createHash } from "node:crypto";
import type { Config } from "../config";
import { tokensPath } from "../config";

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const REDIRECT_URI = "http://127.0.0.1:8888/callback";
const SCOPES = [
  "playlist-modify-private",
  "user-modify-playback-state",
  "user-read-playback-state",
  "user-library-modify",
].join(" ");

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function readTokens(config: Config): Promise<Tokens | null> {
  try {
    const text = await Bun.file(tokensPath(config)).text();
    return JSON.parse(text) as Tokens;
  } catch {
    return null;
  }
}

async function writeTokens(config: Config, tokens: Tokens): Promise<void> {
  await Bun.write(tokensPath(config), JSON.stringify(tokens, null, 2));
}

async function exchangeCode(
  config: Config,
  code: string,
  verifier: string,
): Promise<Tokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: config.spotifyClientId,
    code_verifier: verifier,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as any;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

async function refreshTokens(config: Config, refreshToken: string): Promise<Tokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.spotifyClientId,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`token refresh failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as any;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

async function runLoginFlow(config: Config): Promise<Tokens> {
  const { verifier, challenge } = generatePkce();
  const state = base64url(randomBytes(16));

  const authUrl = new URL(AUTH_URL);
  authUrl.searchParams.set("client_id", config.spotifyClientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("state", state);

  const codePromise = new Promise<string>((resolve, reject) => {
    const server = Bun.serve({
      port: 8888,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== "/callback") {
          return new Response("not found", { status: 404 });
        }
        const returnedState = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        setTimeout(() => server.stop(), 100);
        if (error) {
          reject(new Error(`spotify auth error: ${error}`));
          return new Response(`Auth failed: ${error}`, { status: 400 });
        }
        if (returnedState !== state || !code) {
          reject(new Error("state mismatch or missing code"));
          return new Response("Auth failed: state mismatch", { status: 400 });
        }
        resolve(code);
        return new Response("Spotify auth complete. You can close this tab.");
      },
    });
  });

  await openBrowser(authUrl.toString());
  const code = await codePromise;
  return exchangeCode(config, code, verifier);
}

async function openBrowser(url: string): Promise<void> {
  const cmd =
    process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", url] : ["xdg-open", url];
  Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
}

export async function getAccessToken(config: Config): Promise<string> {
  const existing = await readTokens(config);
  if (existing && existing.expiresAt - 60_000 > Date.now()) {
    return existing.accessToken;
  }
  if (existing) {
    try {
      const refreshed = await refreshTokens(config, existing.refreshToken);
      await writeTokens(config, refreshed);
      return refreshed.accessToken;
    } catch {
      // fall through to full login
    }
  }
  const tokens = await runLoginFlow(config);
  await writeTokens(config, tokens);
  return tokens.accessToken;
}

export async function isAuthenticated(config: Config): Promise<boolean> {
  return (await readTokens(config)) !== null;
}
