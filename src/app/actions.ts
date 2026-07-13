import { type Dispatch, type SetStateAction } from "react";
import { isValidClientId, type Config } from "../config";
import { listOllamaModels } from "../agent/providers/ollama";
import { generateRandomPlaylistUser } from "../agent/prompts";
import { openBrowser } from "../spotify/auth";
import { checkLocalPlaybackDeps, player } from "../music/playback";
import type { AgentProvider } from "../agent/types";
import type { MusicBackend, RemotePlaylist } from "../music/types";
import type { ResolvedPlaylist } from "../core/generate-playlist";
import type { Overlay } from "./overlay";
import { dispatchCommand, type CommandCtx } from "./commands";

/**
 * App-shell wiring actions — the IO-flavored glue that previously lived inline
 * in App(). Pulled out so app.tsx is wiring-only (composition + routing): the
 * actions here take explicit hook returns + state setters and return the
 * closing helpers (commandCtx, handleSubmit), plus the overlay-commit actions
 * (applyBackendChoice/Effort/SystemPrompt) and provider/model toggles.
 *
 * No React rendering here — pure functions closed over deps. App passes the
 * already-assembled hook outputs in; this hook just rebundles them into the
 * App-facing handlers used by useKeyboard, the overlay pickers, and the
 * PromptInput submit path.
 */
export interface AppActionsDeps {
  // config axis
  config: Config | null;
  saveAndSet: (partial: Partial<Config>) => Promise<Config>;
  setOllamaModels: (models: string[]) => void;
  // auth axis
  authedRef: { current: boolean };
  pendingPrompt: string | null;
  setPendingPrompt: (v: string | null) => void;
  login: (cfg: Config, resumePrompt: string | null) => Promise<boolean>;
  // provider
  provider: AgentProvider | null;
  // generation axis
  loading: boolean;
  resolved: ResolvedPlaylist | null;
  committedPlaylist: RemotePlaylist | null;
  runResolve: (prompt: string, qa: never[]) => Promise<ResolvedPlaylist | null>;
  savePlaylist: () => Promise<void>;
  cancelInFlight: () => void;
  resetSession: () => void;
  setAwaitingConfirm: (v: boolean) => void;
  setResolved: (v: ResolvedPlaylist | null) => void;
  setCommittedPlaylist: (v: RemotePlaylist | null) => void;
  setSelectedIndex: (v: number | ((i: number) => number)) => void;
  // playback axis
  currentlyPlayingUri: string | null;
  selectedIndex: number;
  handlePlay: () => Promise<void>;
  resetNowPlaying: () => void;
  // taste axis
  likeTrack: (track: Pick<{ artist: string; title: string }, "artist" | "title">, comment: string) => Promise<void>;
  buildMemoryText: () => Promise<string | null>;
  priorPlaylistRef: { current: string[] | null };
  // history axis
  openHistory: () => Promise<void>;
  // lyrics axis
  lyricsMode: boolean;
  lyricsFullScreen: boolean;
  setLyricsMode: (v: boolean) => void;
  setLyricsFullScreen: (v: boolean) => void;
  clearLyricsCache: () => void;
  // chrome + feedback
  isSpotifyBackend: boolean;
  setError: (msg: string | undefined) => void;
  show: (msg: string) => void;
  setOverlay: Dispatch<SetStateAction<Overlay | null>>;
  setHasInteracted: (v: boolean) => void;
  // input cluster (slash menu / prompt)
  slashMenuOpen: boolean;
  slashCommands: { cmd: string }[];
  slashIndex: number;
  setSlashIndex: (v: number | ((i: number) => number)) => void;
  setInput: (v: string) => void;
}

export function useAppActions(deps: AppActionsDeps) {
  const {
    config,
    saveAndSet,
    setOllamaModels,
    authedRef,
    pendingPrompt,
    setPendingPrompt,
    login,
    provider,
    loading,
    resolved,
    committedPlaylist,
    runResolve,
    savePlaylist,
    cancelInFlight,
    resetSession,
    setAwaitingConfirm,
    setResolved,
    setCommittedPlaylist,
    setSelectedIndex,
    currentlyPlayingUri,
    selectedIndex,
    handlePlay,
    resetNowPlaying,
    likeTrack,
    buildMemoryText,
    priorPlaylistRef,
    openHistory,
    lyricsMode,
    lyricsFullScreen,
    setLyricsMode,
    setLyricsFullScreen,
    clearLyricsCache,
    isSpotifyBackend,
    setError,
    show,
    setOverlay,
    setHasInteracted,
    slashMenuOpen,
    slashCommands,
    slashIndex,
    setSlashIndex,
    setInput,
  } = deps;

  /** Login, then re-run whatever prompt triggered the connect flow. The auth
   * mechanics live in useAuthFlow; the resume choreography is wiring. */
  async function runLoginAndResume(
    resumePrompt: string | null,
    cfgOverride?: Config,
  ): Promise<void> {
      const cfg = cfgOverride ?? config;
      if (!cfg) return;
      const ok = await login(cfg, resumePrompt);
      if (!ok || !resumePrompt) return;
      if (resumePrompt === "__random__") {
        setHasInteracted(true);
        await runResolve(generateRandomPlaylistUser(), []);
      } else {
        await handleSubmit(resumePrompt);
      }
  }

  async function handleClientIdSubmit(value: string) {
    const id = value.trim();
    if (!isValidClientId(id)) {
      setOverlay((o) =>
        o?.kind === "client-id"
          ? { ...o, error: "invalid — expected 32 hex characters" }
          : o,
      );
      return;
    }
    const next = await saveAndSet({ spotifyClientId: id });
    setOverlay(null);
    const resume = pendingPrompt;
    setPendingPrompt(null);
    await runLoginAndResume(resume, next);
  }

  // Ctrl+P quick-toggle between ollama and claude-cli. The full /model picker
  // is a multi-level config UI; this shortcut bypasses it for the common case.
  async function quickToggleModel() {
    await saveAndSet({
      defaultProvider: config?.defaultProvider === "ollama" ? "claude-cli" : "ollama",
      ...(config?.defaultProvider === "ollama"
        ? { claudeModel: config?.claudeModel ?? "sonnet" }
        : { ollamaModel: config?.ollamaModel }),
    });
    setOverlay(null);
  }

  // /model: commit defaultProvider + close the picker (the "▶ use" action).
  // Validates required credentials so the user doesn't switch to a provider
  // that will throw at generate() time — they stay on the config page and see
  // an error pointing at the missing field.
  function missingProviderFields(p: string, cfg: Config): string | null {
    if (p === "opencode-go") {
      if (!cfg.opencodeGoApiKey) return "opencode-go needs an api key — edit the field first";
      if (!cfg.opencodeGoBaseUrl) return "opencode-go needs a base url — edit the field first";
    }
    if (p === "opencode-zen") {
      if (!cfg.opencodeZenApiKey) return "opencode-zen needs an api key — edit the field first";
      if (!cfg.opencodeZenBaseUrl) return "opencode-zen needs a base url — edit the field first";
    }
    if (p === "openai") {
      if (cfg.openaiAuthMode === "api" && !cfg.openaiApiKey)
        return "openai api mode needs an api key — edit the field first";
      if (cfg.openaiAuthMode === "subs" && !cfg.openaiSubsToken)
        return "openai subs mode needs a subs token — edit the field first";
    }
    if (p === "openrouter") {
      if (!cfg.openrouterApiKey) return "openrouter needs an api key — edit the field first";
      if (!cfg.openrouterBaseUrl) return "openrouter needs a base url — edit the field first";
    }
    return null;
  }

  async function onUseProvider(p: string, opts?: { closePicker?: boolean }): Promise<string | null> {
    if (config) {
      const missing = missingProviderFields(p, config);
      if (missing) {
        setError(missing);
        return missing;
      }
    }
    await saveAndSet({ defaultProvider: p });
    if (opts?.closePicker ?? true) setOverlay(null);
    return null;
  }

  async function applyBackendChoice(backend: MusicBackend) {
    // A locally playing track belongs to the old backend — stop before switching.
    await player.stop();
    resetNowPlaying();
    // Resolved tracks carry old-backend URIs (spotify:… / ytm:…) — they can't
    // be played or committed on the new backend, so drop the list and any
    // pending "what next?" confirm along with it.
    setAwaitingConfirm(false);
    setResolved(null);
    setCommittedPlaylist(null);
    setSelectedIndex(0);
    await saveAndSet({ musicBackend: backend });
    setOverlay(null);
    setError(checkLocalPlaybackDeps(backend) ?? undefined);
  }

  async function applyEffortChoice(effort: string) {
    await saveAndSet({ claudeEffort: effort });
    setOverlay(null);
  }

  async function applySystemPrompt(value: string) {
    await saveAndSet({ customSystemPrompt: value });
    setOverlay(null);
  }

  /** Explicit state+action surface handed to the command dispatch table. */
  function commandCtx(): CommandCtx {
    return {
    config,
    providerReady: provider !== null,
    loading,
    isSpotifyBackend,
    authedRef,
    resolved,
    committedPlaylist,
    currentlyPlayingUri,
    selectedIndex,
    lyricsMode,
    lyricsFullScreen,
    priorPlaylistRef,
    setError,
    show,
    setOverlay,
    openModelPicker: async () => {
      setOllamaModels(await listOllamaModels(config!.ollamaUrl));
      setOverlay({ kind: "model-picker" });
    },
    runLoginAndResume: (resume) => runLoginAndResume(resume),
    savePlaylist,
    cancelInFlight,
    resetSession,
    resetNowPlaying,
    stopPlayer: () => player.stop(),
    setLyricsMode,
    setLyricsFullScreen,
    clearLyricsCache,
    likeTrack,
    buildMemoryText,
    openHistory,
    setPendingPrompt,
    setHasInteracted,
    runResolve,
    quit: () => process.exit(0),
    };
  }

  async function handleSubmit(value: string) {
    let trimmed = value.trim();
    // Slash menu open: run the highlighted command, not the partial text.
    if (slashMenuOpen) {
      const picked =
        slashCommands[Math.min(slashIndex, slashCommands.length - 1)];
      if (picked) trimmed = picked.cmd;
      setSlashIndex(0);
    }
    if (trimmed.startsWith("/")) {
      setInput("");
      await dispatchCommand(trimmed, commandCtx());
      return;
    }
    if (trimmed.length === 0) {
      if (resolved) await handlePlay();
      return;
    }
    if (!config || !provider || loading) return;
    if (isSpotifyBackend && !authedRef.current) {
      setPendingPrompt(trimmed);
      setOverlay({ kind: "connect-confirm" });
      return;
    }
    setHasInteracted(true);
    setError(undefined);
    setInput("");
    // Agent loop drives clarify through the `clarify` tool — no separate
    // pre-step. runResolve resets elapsed/events/progress synchronously on
    // entry and aborts itself; the loop surfaces questions to ClarifyPrompt
    // via the deferred resolver in `advanceClarify`.
    await runResolve(trimmed, []);
  }

  /** Client-id overlay: Ctrl+O opens the Spotify dashboard. */
  function openClientIdDashboard() {
    void openBrowser("https://developer.spotify.com/dashboard");
  }

  return {
    runLoginAndResume,
    handleClientIdSubmit,
    quickToggleModel,
    onUseProvider,
    applyBackendChoice,
    applyEffortChoice,
    applySystemPrompt,
    commandCtx,
    handleSubmit,
    openClientIdDashboard,
  };
}