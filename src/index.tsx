#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./app";
import { player } from "./music/playback";

// Kill mpv (and its IPC socket) however the TUI dies — normal exit, Ctrl+C,
// SIGTERM, or the terminal window closing (SIGHUP) — so no orphan player
// keeps the audio device.
process.on("exit", () => void player.stop());
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => {
    void player.stop().finally(() => process.exit(0));
  });
}

const renderer = await createCliRenderer();
createRoot(renderer).render(<App />);
