import { randomBytes, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Config } from "../config";
import { tokensPath, hardenSecretFile, ensureSecretDir } from "../config";

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
/**
 * Spotify's loopback-redirect policy (per their redirect_uri docs) follows
 * RFC 8252: register `http://127.0.0.1/callback` WITHOUT a port in the
 * dashboard, then supply the dynamically assigned port at authorization
 * time. This lets us bind an ephemeral port instead of fighting over a
 * fixed one — the same URI (with the real port) must be used in both the
 * authorize request and the token exchange.
 */
export function redirectUri(port: number): string {
  return `http://127.0.0.1:${port}/callback`;
}
const SCOPES = [
  "playlist-modify-public",
  "playlist-modify-private",
  "user-modify-playback-state",
  "user-read-playback-state",
  "user-library-modify",
].join(" ");

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string;
}

/**
 * Spotify returns the granted scope string in its own order (and may omit it
 * on refresh), so compare as sets: every required scope must be granted.
 */
export function scopesSatisfy(granted: string | undefined, required: string): boolean {
  const have = new Set((granted ?? "").split(/\s+/).filter(Boolean));
  return required.split(/\s+/).every((s) => have.has(s));
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Bind an ephemeral loopback port for the OAuth callback. `port: 0` lets the
 * OS pick a free port, so a stale login server (or any other process) can
 * never block us — which also means we never have to kill anything.
 */
function startListenerServer(
  handler: (req: Request) => Response | Promise<Response>,
): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: handler,
  });
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function readTokens(config: Config): Promise<Tokens | null> {
  hardenSecretFile(tokensPath(config));
  try {
    const text = await Bun.file(tokensPath(config)).text();
    return JSON.parse(text) as Tokens;
  } catch {
    return null;
  }
}

export async function writeTokens(config: Config, tokens: Tokens): Promise<void> {
  const path = tokensPath(config);
  ensureSecretDir(dirname(path));
  await Bun.write(path, JSON.stringify(tokens, null, 2));
  hardenSecretFile(path);
}

async function clearTokens(config: Config): Promise<void> {
  try {
    await Bun.file(tokensPath(config)).unlink();
  } catch {
    // already gone, fine
  }
}

async function exchangeCode(
  config: Config,
  code: string,
  verifier: string,
  redirectUriValue: string,
): Promise<Tokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    // Must byte-match the redirect_uri sent in the authorize request,
    // including the ephemeral port.
    redirect_uri: redirectUriValue,
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
    scopes: data.scope ?? SCOPES,
  };
}

async function refreshTokens(config: Config, refreshToken: string, existingScopes: string): Promise<Tokens> {
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
    scopes: data.scope ?? existingScopes,
  };
};

async function runLoginFlow(config: Config): Promise<Tokens> {
  const { verifier, challenge } = generatePkce();
  const state = base64url(randomBytes(16));

  let server!: ReturnType<typeof Bun.serve>;
  let onCode: ((code: string) => void) | null = null;
  let onAuthError: ((err: Error) => void) | null = null;
  let resolved = false;

  const handler = (req: Request): Response | Promise<Response> => {
    const url = new URL(req.url);
    if (url.pathname !== "/callback") {
      return new Response("ok", { status: 200 });
    }
    // Ignore stray requests (preflight, Safari probes) that carry
    // neither a code nor an error — keep waiting for the real callback.
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    if (!code && !error) {
      return new Response("waiting for spotify callback...", { status: 200 });
    }
    if (resolved) return new Response("already handled", { status: 200 });
    const returnedState = url.searchParams.get("state");
    if (returnedState !== state) {
      // Stale callback or replayed redirect — ignore, keep waiting.
      return new Response("stale callback, waiting for fresh one...", { status: 200 });
    }
    resolved = true;
    const s = server;
    setTimeout(() => s?.stop(), 100);
    if (error) {
      onAuthError?.(new Error(`spotify auth error: ${error}`));
      return new Response(`Auth failed: ${error}`, { status: 200 });
    }
    onCode?.(code!);
    return new Response("Spotify auth complete. You can close this tab.");
  };

  // Server must be up before the browser opens (Spotify may redirect back
  // fast), and we need its OS-assigned port to build the redirect URI.
  server = startListenerServer(handler);
  // port is only undefined for unix-socket servers; we always bind TCP.
  if (server.port === undefined) throw new Error("login server bound without a TCP port");
  const uri = redirectUri(server.port);

  const authUrl = new URL(AUTH_URL);
  authUrl.searchParams.set("client_id", config.spotifyClientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", uri);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("state", state);

  const codePromise = new Promise<string>((resolve, reject) => {
    onCode = resolve;
    onAuthError = reject;
  });

  await openBrowser(authUrl.toString());
  const code = await codePromise;
  return exchangeCode(config, code, verifier, uri);
}

function isWSL(): boolean {
  if (process.platform !== "linux") return false;
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    return readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft");
  } catch {
    return false;
  }
}

export async function openBrowser(url: string): Promise<void> {
  // Spotify OAuth URL contains `&`-joined query params, which cmd.exe treats
  // as a command separator unless the URL is quoted. The obvious fix —
  // `cmd.exe /c start "" "<url>"` with `"<url>"` as a single argv element —
  // is broken on WSL: the interop layer re-quotes any argv element that
  // contains a `"` (not just spaces), escaping the inner quotes as `\"`.
  // cmd.exe then strips the outer quotes and un-escapes to `\https://…\`,
  // which surfaces as "Windows cannot find '\https://accounts.spotify.com/'".
  // `explorer.exe <url>` is equally unreliable: with `?`/`&` in the URL it
  // treats the argument as a relative path and prepends the CWD, yielding
  // the same stray-backslash error. Going through `powershell.exe` avoids
  // both: the URL is single-quoted inside the -Command argument (PowerShell
  // treats `&`/`?` literally inside single quotes), interop wraps the
  // space-containing -Command element in double quotes without mangling
  // anything, and Start-Process hands the URL to the OS default browser.
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["powershell", "-NoProfile", "-Command", `Start-Process '${url}'`]
        : isWSL()
          ? ["powershell.exe", "-NoProfile", "-Command", `Start-Process '${url}'`]
          : ["xdg-open", url];
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch {
    console.log(`Open this URL in your browser to continue:\n${url}`);
  }
}

export async function getAccessToken(config: Config): Promise<string> {
  const existing = await readTokens(config);
  const scopesOk = existing !== null && scopesSatisfy(existing.scopes, SCOPES);
  if (existing && !scopesOk) {
    // Scopes changed — cached tokens are for a different permission set.
    // Force full re-login.
    await clearTokens(config);
  }
  if (existing && scopesOk && existing.expiresAt - 60_000 > Date.now()) {
    return existing.accessToken;
  }
  if (existing && scopesOk) {
    try {
      const refreshed = await refreshTokens(config, existing.refreshToken, existing.scopes);
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

export async function forceFreshLogin(config: Config): Promise<string> {
  await clearTokens(config);
  return getAccessToken(config);
}
