---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## Project environment variables

- `MUSIC_BACKEND` — `spotify` (default) | `soundcloud` | `youtube-music`.
- `SPOTIFY_CLIENT_ID` — Spotify app client ID (32 hex chars), only needed for the spotify backend.
- `SOUNDCLOUD_CLIENT_ID` — api-v2 client_id; optional — auto-scraped from soundcloud.com and cached in config when unset.
- `YTMUSIC_COOKIE` — reserved for future YouTube Music library access; not required (search and playback are anonymous).
- Local backends (soundcloud, youtube-music) play through `mpv` (JSON IPC); youtube-music also needs `yt-dlp`. Both are external binaries checked at startup, not npm packages.

### AI model providers (`DEFAULT_PROVIDER`)

- `DEFAULT_PROVIDER` — `claude-cli` (default) | `ollama` | `opencode-go` | `opencode-zen` | `openai`. Selectable at runtime via `/model`.
- `OLLAMA_URL` / `OLLAMA_MODEL` — local Ollama daemon URL + model (defaults `http://127.0.0.1:11434` / `llama3`).
- `CLAUDE_MODEL` / `CLAUDE_EFFORT` / `CLAUDE_SYSTEM_PROMPT` — Claude CLI model alias, reasoning effort, and optional system prompt override (auth is delegated to the installed `claude` CLI binary).
- `OPENCODE_ZEN_API_KEY` / `OPENCODE_ZEN_BASE_URL` — bearer token + base URL for the opencode Zen tier (default base URL `https://opencode.ai/zen/v1`, per opencode.ai/docs/zen).
- `OPENCODE_GO_API_KEY` / `OPENCODE_GO_BASE_URL` — bearer token + base URL for the opencode Go tier, a separate subscription with its own key (default base URL `https://opencode.ai/zen/go/v1`, not publicly documented — override if it differs for your account).
- `OPENCODE_GO_MODEL` / `OPENCODE_ZEN_MODEL` — model ids for the two hosted instances (defaults `glm-5.2` / `claude-sonnet-5`).
- `OPENAI_AUTH_MODE` — `api` (default) | `subs`. Auto-picks `subs` if only `OPENAI_SUBS_TOKEN` is set. `api` uses `OPENAI_API_KEY`; `subs` uses `OPENAI_SUBS_TOKEN` (ChatGPT subscription bearer).
- `OPENAI_API_KEY` — platform key (starts with `sk-`) for `api` mode.
- `OPENAI_SUBS_TOKEN` — ChatGPT subscription bearer token for `subs` mode.
- `OPENAI_BASE_URL` — chat completions base URL (default `https://api.openai.com/v1`).
- `OPENAI_MODEL` — model id (default `gpt-5`).
- `VOLUME` — playback volume 0-100 (default 70); persisted in config.json after adjustment via ←/→ in the TUI.
