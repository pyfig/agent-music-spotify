import { randomBytes, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Config } from "../config";
import { tokensPath, hardenSecretFile, ensureSecretDir } from "../config";
import { dirname } from "node:path";

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const REDIRECT_URI = "http://127.0.0.1:8888/callback";
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

// Корень репозитория (два уровня вверх от src/spotify/auth.ts).
// Используем для опознавания «своих» зомби-процессов по их cwd.
const REPO_DIR = resolve(import.meta.dir, "..", "..");

interface PidInfo {
  pid: number;
  comm?: string;
  args?: string;
  cwd?: string;
}

function spawnText(cmd: string[], opts: { timeout?: number } = {}): string {
  try {
    const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "ignore", ...opts });
    return r.stdout?.toString().trim() ?? "";
  } catch {
    return "";
  }
}

async function listListenersOn8888(): Promise<PidInfo[]> {
  const pids: number[] = [];
  const lsof = spawnText(["lsof", "-nP", "-iTCP:8888", "-sTCP:LISTEN", "-t"]);
  for (const line of lsof.split(/\r?\n/)) {
    const n = Number(line.trim());
    if (Number.isInteger(n) && n > 0) pids.push(n);
  }
  if (pids.length === 0) return [];
  return pids.map((pid) => {
    const ps = spawnText(["ps", "-o", "pid=,comm=,args=", "-p", String(pid)]);
    const first = ps.split(/\r?\n/)[0] ?? "";
    const parts = first.trim().split(/\s+/);
    const pidOut = Number(parts[0] ?? pid);
    // cwd через lsof: строки начинаются с 'n', берём первую.
    let cwd: string | undefined;
    const cwdOut = spawnText(["lsof", "-a", "-p", String(pidOut), "-d", "cwd", "-Fn"]);
    for (const line of cwdOut.split(/\r?\n/)) {
      if (line.startsWith("n") && line.length > 1) {
        cwd = line.slice(1);
        break;
      }
    }
    return { pid: pidOut, comm: parts[1], args: first, cwd };
  });
}

function isOurs(info: PidInfo): boolean {
  if (info.pid === process.pid) return false;
  // Надёжный признак: зомби запущен из этого же репозитория.
  if (info.cwd && info.cwd.toLowerCase() === REPO_DIR.toLowerCase()) return true;
  // Запасные маркеры: установленный bin `vibedeck` или наш entrypoint.
  const comm = (info.comm ?? "").toLowerCase();
  const args = (info.args ?? "").toLowerCase();
  if (comm === "vibedeck") return true;
  if (args.includes("src/index.tsx") && (comm.includes("bun") || comm.includes("vibedeck"))) return true;
  // Порт 8888 — выделенный OAuth-callback этого приложения. Любой
  // bun/node/vibedeck-процесс, слушающий его, почти наверняка наш
  // устаревший login-сервер (другие dev-серверы обычно сидят на
  // 3000/5173/8080). Прибиваем без вопросов, чтобы не пугать юзера.
  if (comm === "bun" || comm === "node" || comm.includes("vibedeck")) return true;
  return false;
}

async function killPid(pid: number): Promise<boolean> {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return false;
  }
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 25));
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // ignore
  }
  await new Promise((r) => setTimeout(r, 50));
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

async function freePortIfStaleZombie(): Promise<{ killed: number; foreign?: PidInfo }> {
  const listeners = await listListenersOn8888();
  let killed = 0;
  for (const info of listeners) {
    if (isOurs(info)) {
      if (await killPid(info.pid)) {
        killed++;
        process.stderr.write(`freed stale login server on port 8888 (pid ${info.pid})\n`);
      }
    } else {
      return { killed, foreign: info };
    }
  }
  return { killed };
}

const PORT = 8888;

async function startListenerServer(
  handler: (req: Request) => Response | Promise<Response>,
): Promise<ReturnType<typeof Bun.serve>> {
  // Чужой процесс на 8888 может уйти сам за секунды (кратковременный
  // сервер). Поэтому сначала ждём до ~15с, ретрая бинд, и только потом
  // падаем с ошибкой — чтобы не тыкать юзера в занятый порт.
  const FOREIGN_RETRY_UNTIL = Date.now() + 15_000;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return Bun.serve({
        port: PORT,
        hostname: "127.0.0.1",
        fetch: handler,
      });
    } catch (e) {
      lastErr = e;
      const msg = String((e as { message?: unknown } | null)?.message ?? e);
      if (!/8888|in use|EADDRINUSE/i.test(msg)) throw e;
      const r = await freePortIfStaleZombie();
      if (r.foreign) {
        if (Date.now() < FOREIGN_RETRY_UNTIL) {
          // Дадим чужому процессу шанс уйти; попробуем снова.
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        const f = r.foreign;
        throw new Error(
          `Port ${PORT} занят процессом (PID ${f.pid}: ${f.comm ?? f.args ?? "?"}) уже >15с. Закройте его и перезапустите.`,
        );
      }
      if (r.killed === 0) {
        // Никто не держит, но bind упал — короткая пауза и повтор.
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }
  throw lastErr;
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

  const authUrl = new URL(AUTH_URL);
  authUrl.searchParams.set("client_id", config.spotifyClientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("state", state);

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

  // Ждём, пока сервер реально встанет на порту (или упадёт с ошибкой),
  // иначе браузер может открыться раньше, чем login-сервер готов принять
  // callback Spotify. При занятом порту здесь же авто-прибиваются
  // наши собственные «зомби»-инстансы и старт ретраится.
  const serverReady = startListenerServer(handler).then((s) => {
    server = s;
  });

  const codePromise = new Promise<string>((resolve, reject) => {
    onCode = resolve;
    onAuthError = reject;
  });

  await serverReady;
  await openBrowser(authUrl.toString());
  const code = await codePromise;
  return exchangeCode(config, code, verifier);
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
