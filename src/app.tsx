import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useMemo, useRef, useState } from "react";
import { DEFAULT_CLIENT_ID, isValidClientId, type Config } from "./config";
import { listOllamaModels } from "./agent/providers/ollama";
import { useProvider, modelLabelFor } from "./hooks/useProviders";
import { useLyrics } from "./hooks/useLyrics";
import type { AgentProvider } from "./agent/types";
import { generateRandomPlaylistUser } from "./agent/prompts";
import { openBrowser } from "./spotify/auth";
import { checkLocalPlaybackDeps, player } from "./music/playback";
import type { MusicBackend } from "./music/types";
import { MusicBackendPicker } from "./ui/MusicBackendPicker";
import { PromptInput } from "./ui/PromptInput";
import { ResultsList, type ResultLine } from "./ui/ResultsList";
import { StatusBar } from "./ui/StatusBar";
import { SetupWizard } from "./ui/SetupWizard";
import { ModelPicker } from "./ui/ModelPicker";
import { EffortPicker } from "./ui/EffortPicker";
import { SlashMenu, filterSlashCommands } from "./ui/SlashMenu";
import { ConnectPrompt } from "./ui/ConnectPrompt";
import { ClarifyPrompt } from "./ui/ClarifyPrompt";
import { ClientIdPrompt } from "./ui/ClientIdPrompt";
import { SystemPromptPrompt } from "./ui/SystemPromptPrompt";
import { HistoryScreen } from "./ui/HistoryScreen";
import { historyEntryToText, historyReasoningToText } from "./core/history";
import { copyToClipboard } from "./core/clipboard";
import { ConfirmActions } from "./ui/ConfirmActions";
import { Logo } from "./ui/Logo";
import { theme, truncateLabel } from "./ui/theme";
import { fmtTime, trackBar } from "./ui/format";
import { useToast } from "./hooks/useToast";
import { useAppConfig } from "./hooks/useAppConfig";
import { useAuthFlow } from "./hooks/useAuthFlow";
import { useGeneration } from "./hooks/useGeneration";
import { useTasteActions } from "./hooks/useTasteActions";
import { useHistoryScreen } from "./hooks/useHistoryScreen";
import { usePlayback } from "./hooks/usePlayback";
import {
  blocksPromptFocus,
  replacesMainRegion,
  type OverlayState,
} from "./app/overlay";
import { dispatchCommand, type CommandCtx } from "./app/commands";
import { layoutBudget, LYRICS_PANEL_ROWS } from "./ui/layout";
import { LyricsPanel } from "./ui/LyricsPanel";
import { LyricsScreen } from "./ui/LyricsScreen";
import type { ScrollBoxRenderable } from "@opentui/core";

export function App() {
  const { width, height } = useTerminalDimensions();
  /** The single active modal overlay — opening one structurally replaces any
   * other (see src/app/overlay.ts). */
  const [overlay, setOverlay] = useState<OverlayState>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [slashIndex, setSlashIndex] = useState(0);
  const [hasInteracted, setHasInteracted] = useState(false);
  const { toast, show } = useToast();

  // Live handle on the reasoning-transcript scrollbox so Up/Down can scroll
  // it while the agent is still generating and the resolved-track list hasn't
  // taken over the screen (see useKeyboard below).
  const reasoningScrollRef = useRef<ScrollBoxRenderable | null>(null);
  /** Lyrics mode: /lyrics toggles. Off by default — no network traffic while off. */
  const [lyricsMode, setLyricsMode] = useState(false);
  /** Full-screen lyrics overlay. */
  const [lyricsFullScreen, setLyricsFullScreen] = useState(false);

  const {
    authed,
    authedRef,
    markAuthed,
    connecting,
    pendingPrompt,
    setPendingPrompt,
    login,
  } = useAuthFlow({
    setError,
    show,
    openClientIdPrompt: () => setOverlay({ kind: "client-id", text: "" }),
  });

  const {
    config,
    screen,
    setScreen,
    ollamaModels,
    setOllamaModels,
    saveAndSet,
    onSaveField,
  } = useAppConfig({
    onBooted: (c, a) => {
      markAuthed(a);
      // Spotify auth only matters for the spotify backend; local backends
      // need external binaries instead.
      if (c.musicBackend === "spotify") {
        if (!a) setOverlay({ kind: "connect-confirm" });
      } else {
        const depError = checkLocalPlaybackDeps(c.musicBackend);
        if (depError) setError(depError);
      }
    },
  });

  const provider: AgentProvider | null = useProvider(config);
  const modelLabel = modelLabelFor(config);

  const taste = useTasteActions(provider, { show });
  const { priorPlaylistRef } = taste;

  const history = useHistoryScreen(config, provider, { setError });
  const {
    historyEntries,
    setHistoryEntries,
    historyDetail,
    setHistoryDetail,
    historyScrollRef,
  } = history;

  const {
    loading,
    progress,
    spinnerFrame,
    elapsed,
    escArmed,
    events,
    resolved,
    awaitingConfirm,
    committedPlaylist,
    selectedIndex,
    setSelectedIndex,
    setResolved,
    setAwaitingConfirm,
    setCommittedPlaylist,
    clarifyQuestions,
    clarifyStepIndex,
    clarifyCustomMode,
    setClarifyCustomMode,
    clarifyCustomText,
    setClarifyCustomText,
    armEsc,
    disarmEsc,
    cancelInFlight,
    cancelClarify,
    cancelResult,
    resetSession,
    advanceClarify,
    runResolve,
    resolveHistoryEntry,
    savePlaylist,
    handleConfirmAction,
  } = useGeneration(config, provider, {
    setError,
    show,
    markAuthed,
    priorPlaylistRef,
    recordTasteSession: taste.recordTasteSession,
    recordHistorySession: history.recordHistorySession,
    closeHistory: history.closeHistory,
    onInteracted: () => setHasInteracted(true),
  });

  const isSpotifyBackend = config?.musicBackend !== "soundcloud" && config?.musicBackend !== "youtube-music";

  const {
    currentlyPlayingUri,
    isPlaying,
    trackPos,
    volume,
    mutedVolume,
    currentTrackMeta,
    lyricsAnchorRef,
    adjustVolume,
    toggleMute,
    handlePlay,
    resetNowPlaying,
  } = usePlayback(config, {
    authed,
    authedRef,
    loading,
    isSpotifyBackend,
    resolved,
    selectedIndex,
    committedPlaylist,
    setError,
    saveVolume: (pct) => saveAndSet({ volume: pct }),
    onNeedsConnect: () => setOverlay({ kind: "connect-confirm" }),
  });

  const { lyricsData, interpolatedPosMs, lyricsCurrentLine, clearLyricsCache } = useLyrics(
    lyricsMode,
    currentlyPlayingUri,
    currentTrackMeta,
    lyricsAnchorRef,
  );

  const slashCommands = useMemo(
    () => (input.trimStart().startsWith("/") ? filterSlashCommands(input) : []),
    [input],
  );
  const slashMenuOpen =
    screen === "main" &&
    !replacesMainRegion(overlay) &&
    historyEntries === null &&
    slashCommands.length > 0;

  const lines: ResultLine[] = useMemo(() => {
    if (!resolved) return [];
    return resolved.resolved.map((t, i) => {
      // SoundCloud/YT titles often embed the uploader ("artist — title");
      // drop that prefix when it just repeats the artist we already show.
      const dup = new RegExp(`^${t.artist.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[—–-]\\s*`, "i");
      const title = t.title.replace(dup, "");
      return {
        key: `r${i}`,
        label: `${t.artist} — ${title}`,
        artist: t.artist,
        title,
        uri: t.uri,
        resolved: true,
      };
    });
  }, [resolved]);

  useKeyboard(async (key) => {
    if (key.ctrl && key.name === "c") process.exit(0);
    if (screen !== "main") return;
    if (overlay?.kind === "connect-confirm") {
      if (key.name === "y") {
        const resume = pendingPrompt;
        setOverlay(null);
        setPendingPrompt(null);
        await runLoginAndResume(resume);
        return;
      }
      if (key.name === "n" || key.name === "escape") {
        setOverlay(null);
        setPendingPrompt(null);
        return;
      }
      return;
    }
    if (overlay?.kind === "forget-confirm") {
      if (key.name === "r") {
        await taste.clearSessions();
        setOverlay(null);
        return;
      }
      if (key.name === "a") {
        await taste.clearAll();
        setOverlay(null);
        return;
      }
      if (key.name === "escape" || key.name === "n") setOverlay(null);
      return;
    }
    if (overlay?.kind === "memory") {
      if (key.name === "escape") setOverlay(null);
      return;
    }
    if (historyEntries !== null) {
      if (historyDetail) {
        // Detail level: scroll the stored transcript; Esc back to the list.
        const box = historyScrollRef.current;
        if (key.name === "up") box?.scrollBy(-1, "step");
        else if (key.name === "down") box?.scrollBy(1, "step");
        else if (key.name === "pageup") box?.scrollBy(-0.5, "viewport");
        else if (key.name === "pagedown") box?.scrollBy(0.5, "viewport");
        else if (key.name === "escape") setHistoryDetail(null);
        else if (key.name === "return") void resolveHistoryEntry(historyDetail);
        else if (key.name === "c" && !key.ctrl) {
          const entry = historyDetail;
          void copyToClipboard(historyReasoningToText(entry))
            .then(() => show("copied reasoning"))
            .catch((e) => setError(String(e instanceof Error ? e.message : e)));
        } else if (key.name === "t" && !key.ctrl) {
          const entry = historyDetail;
          void copyToClipboard(historyEntryToText(entry))
            .then(() => show(`copied ${entry.tracks.length} tracks`))
            .catch((e) => setError(String(e instanceof Error ? e.message : e)));
        }
        return;
      }
      if (key.name === "escape") setHistoryEntries(null);
      return;
    }
    if (lyricsFullScreen) {
      if (key.name === "escape") setLyricsFullScreen(false);
      return;
    }
    if (clarifyQuestions !== null) {
      if (clarifyCustomMode) {
        if (key.name === "escape") {
          setClarifyCustomMode(false);
          setClarifyCustomText("");
        }
        return;
      }
      if (key.name === "escape") cancelClarify();
      return;
    }
    if (awaitingConfirm) {
      if (key.name === "escape") cancelResult();
      return;
    }
    if (overlay?.kind === "client-id") {
      if (key.name === "escape") setOverlay(null);
      if (key.ctrl && key.name === "o") {
        void openBrowser("https://developer.spotify.com/dashboard");
      }
      return;
    }
    if (overlay?.kind === "effort-picker") {
      if (key.name === "escape") setOverlay(null);
      return;
    }
    if (overlay?.kind === "system-prompt") {
      if (key.name === "escape") setOverlay(null);
      return;
    }
    if (overlay?.kind === "backend-picker") {
      if (key.name === "escape") setOverlay(null);
      return;
    }
    if (overlay?.kind === "model-picker") {
      // ModelPicker owns its own keyboard (Esc navigates its 3 levels); App
      // must not also react. Ctrl+C above still works.
      return;
    }
    if (slashMenuOpen) {
      if (key.name === "escape") {
        setInput("");
        setSlashIndex(0);
        return;
      }
      if (key.name === "down") {
        setSlashIndex((i) => Math.min(i + 1, slashCommands.length - 1));
        return;
      }
      if (key.name === "up") {
        setSlashIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (key.name === "tab") {
        const picked =
          slashCommands[Math.min(slashIndex, slashCommands.length - 1)];
        if (picked) setInput(picked.cmd);
        return;
      }
    }
    if (key.name === "escape") {
      // Double-esc cancels an in-flight generation (Claude Code style).
      if (loading) {
        if (escArmed) {
          disarmEsc();
          cancelInFlight();
        } else {
          armEsc();
        }
        return;
      }
      setError(undefined);
      return;
    }
    if (key.ctrl && key.name === "b") {
      setOverlay({ kind: "backend-picker" });
      return;
    }
    if (key.ctrl && key.name === "p") {
      await quickToggleModel();
      return;
    }
    // Volume: ←/→ step by 5%, Ctrl+U toggles mute (restores pre-mute level).
    // Mute lives on a ctrl combo because a bare printable key would steal the
    // letter from the always-focused prompt input while typing track names.
    // Arrow keys are navigation keys the focused <input> would also consume,
    // so stop the event from reaching it — otherwise ←/→ move the text cursor
    // as well as the volume. Skipped while the slash menu is open so those
    // keys navigate the menu / edit the query.
    if (!slashMenuOpen && key.name === "left") {
      key.stopPropagation();
      key.preventDefault();
      await adjustVolume(-5);
      return;
    }
    if (!slashMenuOpen && key.name === "right") {
      key.stopPropagation();
      key.preventDefault();
      await adjustVolume(5);
      return;
    }
    if (key.ctrl && key.name === "u") {
      key.stopPropagation();
      key.preventDefault();
      await toggleMute();
      return;
    }
    // Input owns printable keys; only handle chrome/navigation.
    // While the agent is still thinking and no resolved tracks exist yet, the
    // only scrollable surface on screen is the reasoning transcript. Repurpose
    // Up/Down (and PageUp/PageDown) to scroll it instead of mutating a
    // selectedIndex that has nothing to point at. stickyScroll on the box
    // auto-disengages when the user scrolls up and re-engages once they reach
    // the tail again — `scrollBy` flips those flags via the scrollbox's
    // updateStickyState, so no extra bookkeeping is needed here.
    if (loading && lines.length === 0) {
      const box = reasoningScrollRef.current;
      if (box) {
        if (key.name === "up") {
          key.stopPropagation();
          key.preventDefault();
          box.scrollBy(-1, "step");
          return;
        }
        if (key.name === "down") {
          key.stopPropagation();
          key.preventDefault();
          box.scrollBy(1, "step");
          return;
        }
        if (key.name === "pageup") {
          key.stopPropagation();
          key.preventDefault();
          box.scrollBy(-0.5, "viewport");
          return;
        }
        if (key.name === "pagedown") {
          key.stopPropagation();
          key.preventDefault();
          box.scrollBy(0.5, "viewport");
          return;
        }
        if (key.name === "home") {
          key.stopPropagation();
          key.preventDefault();
          box.scrollTo(0);
          return;
        }
        if (key.name === "end") {
          key.stopPropagation();
          key.preventDefault();
          box.scrollTo(Number.MAX_SAFE_INTEGER);
          return;
        }
      }
    }
    if (key.name === "down") {
      setSelectedIndex((i) => Math.min(i + 1, Math.max(lines.length - 1, 0)));
      return;
    }
    if (key.name === "up") {
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }
  });

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
  function missingProviderFields(provider: string, cfg: Config): string | null {
    if (provider === "opencode-go") {
      if (!cfg.opencodeGoApiKey) return "opencode-go needs an api key — edit the field first";
      if (!cfg.opencodeGoBaseUrl) return "opencode-go needs a base url — edit the field first";
    }
    if (provider === "opencode-zen") {
      if (!cfg.opencodeZenApiKey) return "opencode-zen needs an api key — edit the field first";
      if (!cfg.opencodeZenBaseUrl) return "opencode-zen needs a base url — edit the field first";
    }
    if (provider === "openai") {
      if (cfg.openaiAuthMode === "api" && !cfg.openaiApiKey)
        return "openai api mode needs an api key — edit the field first";
      if (cfg.openaiAuthMode === "subs" && !cfg.openaiSubsToken)
        return "openai subs mode needs a subs token — edit the field first";
    }
    if (provider === "openrouter") {
      if (!cfg.openrouterApiKey) return "openrouter needs an api key — edit the field first";
      if (!cfg.openrouterBaseUrl) return "openrouter needs a base url — edit the field first";
    }
    return null;
  }

  async function onUseProvider(provider: string, opts?: { closePicker?: boolean }): Promise<string | null> {
    if (config) {
      const missing = missingProviderFields(provider, config);
      if (missing) {
        setError(missing);
        return missing;
      }
    }
    await saveAndSet({ defaultProvider: provider });
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
      likeTrack: taste.likeTrack,
      buildMemoryText: taste.buildMemoryText,
      openHistory: history.openHistory,
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

  const columnWidth = Math.min(72, Math.max(40, width - 4));
  // Input starts vertically centered; after the first search/album request the
  // layout shifts to the usual top-aligned position with results below.
  const centered =
    screen === "main" &&
    !hasInteracted &&
    !replacesMainRegion(overlay) &&
    historyEntries === null;
  // Clarify Q&A gets the same centered treatment as the initial prompt.
  const clarifyActive =
    screen === "main" &&
    !replacesMainRegion(overlay) &&
    clarifyQuestions !== null;

  const playingTrackIndex = resolved?.resolved.findIndex((t) => t.uri === currentlyPlayingUri) ?? -1;
  const playingTrack = playingTrackIndex >= 0 ? resolved!.resolved[playingTrackIndex] : undefined;
  const playingPosition =
    playingTrackIndex >= 0 && resolved ? `${playingTrackIndex + 1}/${resolved.resolved.length}` : null;
  const nowPlaying = playingTrack ? `${playingTrack.artist} – ${playingTrack.title}` : null;
  const trackDurationMs = trackPos?.durationMs ?? playingTrack?.durationMs ?? null;
  // All height-driven sizing (results cap, slash menu tiers, logo threshold,
  // vertical padding) comes from the one layoutBudget helper — components get
  // plain numbers via props and never read the terminal size themselves.
  const lyricsResult = lyricsData !== null && lyricsData !== "none" ? lyricsData : null;
  const hasSyncedLyrics = !!lyricsResult?.synced?.length;
  const showCompactLyrics = !lyricsFullScreen && hasSyncedLyrics && nowPlaying !== null && !loading && !connecting;
  // Full-screen lyrics replace ResultsList/input (else both render and the
  // lyrics box pushes the column past the terminal); footer + StatusBar stay.
  const fullscreenLyricsActive = lyricsFullScreen && lyricsResult !== null;
  const budget = layoutBudget(height, {
    awaitingConfirm,
    nowPlaying: nowPlaying !== null && !loading && !connecting,
    toast: toast !== null && !loading && !connecting,
    slashOpen: slashMenuOpen,
    lyricsPanel: showCompactLyrics,
  });
  const slashMaxVisible = budget.slashMaxVisible;
  // Logo only before the first prompt; frees vertical space afterwards. Also
  // hidden on very short terminals so the input and menu stay on screen.
  const showLogo = (screen !== "main" || !hasInteracted) && budget.logoFits;

  const inputCluster = (
    <>
      <PromptInput
        placeholder="Describe a playlist…  (/ for commands)"
        value={input}
        onChange={(v) => {
          setInput(v);
          setSlashIndex(0);
        }}
        onSubmit={handleSubmit}
        focused={!blocksPromptFocus(overlay) && !awaitingConfirm}
      />
      {slashMenuOpen && (
        <SlashMenu
          commands={slashCommands}
          selectedIndex={slashIndex}
          maxVisible={slashMaxVisible}
          width={columnWidth}
        />
      )}
      {overlay?.kind === "connect-confirm" && <ConnectPrompt pendingPrompt={pendingPrompt} />}
      {overlay?.kind === "memory" && (
        <box
          title="taste memory (esc to close)"
          style={{ border: true, borderColor: theme.muted, flexDirection: "column", paddingLeft: 1, paddingRight: 1 }}
        >
          {overlay.text.split("\n").map((line, i) => (
            <text key={`m${i}`} fg={line.endsWith(":") ? theme.accent : theme.fg}>
              {line}
            </text>
          ))}
        </box>
      )}
      {overlay?.kind === "forget-confirm" && (
        <box
          title="forget taste memory"
          style={{ border: true, borderColor: theme.maroon, flexDirection: "column", paddingLeft: 1, paddingRight: 1 }}
        >
          <text fg={theme.fg}>r — clear raw sessions only · a — clear everything · esc — cancel</text>
        </box>
      )}
    </>
  );

  return (
    <box style={{ flexGrow: 1, alignItems: "center", flexDirection: "column" }}>
      <box
        style={{
          width: columnWidth,
          flexDirection: "column",
          flexGrow: 1,
          paddingTop: budget.paddingTop,
          justifyContent: centered || clarifyActive ? "center" : "flex-start",
        }}
      >
        {showLogo && (
          <box style={{ alignItems: "center" }}>
            <Logo />
          </box>
        )}

        {screen === "loading" && <text fg={theme.muted}>loading…</text>}

        {screen === "wizard" && config && (
          <SetupWizard
            ollamaModels={ollamaModels}
            onDone={async (r) => {
              await saveAndSet({
                defaultProvider: r.provider,
                musicBackend: r.musicBackend,
                ...(r.soundcloudClientId ? { soundcloudClientId: r.soundcloudClientId } : {}),
                ...(r.ollamaModel ? { ollamaModel: r.ollamaModel } : {}),
                ...(r.claudeModel ? { claudeModel: r.claudeModel } : {}),
              });
              if (r.musicBackend === "spotify" && !authedRef.current) setOverlay({ kind: "connect-confirm" });
              setScreen("main");
            }}
          />
        )}

        {screen === "main" && overlay?.kind === "model-picker" && config && (
          <ModelPicker
            ollamaModels={ollamaModels}
            config={config}
            focused
            onUseProvider={onUseProvider}
            onSaveField={onSaveField}
            onClose={() => setOverlay(null)}
          />
        )}

        {screen === "main" && overlay?.kind === "backend-picker" && config && (
          <MusicBackendPicker
            focused
            current={config.musicBackend}
            onPick={applyBackendChoice}
          />
        )}

        {screen === "main" && overlay?.kind === "effort-picker" && config && (
          <EffortPicker
            focused
            current={config.claudeEffort}
            onPick={applyEffortChoice}
          />
        )}

        {screen === "main" && overlay?.kind === "system-prompt" && config && (
          <SystemPromptPrompt
            value={overlay.text}
            onChange={(v) =>
              setOverlay((o) => (o?.kind === "system-prompt" ? { ...o, text: v } : o))
            }
            onSubmit={applySystemPrompt}
            focused
          />
        )}

        {screen === "main" && overlay?.kind === "client-id" && config && (
          <ClientIdPrompt
            value={overlay.text}
            onChange={(v) =>
              setOverlay((o) =>
                o?.kind === "client-id" ? { kind: "client-id", text: v } : o,
              )
            }
            onSubmit={handleClientIdSubmit}
            error={overlay.error}
            focused
            currentId={config.spotifyClientId}
            isDefault={config.spotifyClientId === DEFAULT_CLIENT_ID}
          />
        )}

        {screen === "main" && lyricsFullScreen && lyricsResult && (
          <LyricsScreen
            lyrics={lyricsResult}
            currentLine={lyricsCurrentLine}
            interpolatedPosMs={interpolatedPosMs}
            maxLines={budget.lyricsScreenRows}
          />
        )}
        {screen === "main" && historyEntries !== null && (
          <>
            <HistoryScreen
              entries={historyEntries}
              detail={historyDetail}
              focused
              onPick={(entry) => setHistoryDetail(entry)}
              scrollRef={historyScrollRef}
            />
            {/* Main-region toast row is hidden while the overlay is up — show
                copy/feedback toasts here so `c` gives visible confirmation. */}
            {toast && (
              <box style={{ height: 1, flexShrink: 0, flexDirection: "row" }}>
                <text fg={theme.green}> ✓ {toast.msg}</text>
              </box>
            )}
          </>
        )}

        {screen === "main" && overlay?.kind !== "model-picker" && clarifyQuestions !== null && (
          <ClarifyPrompt
            questionText={clarifyQuestions[clarifyStepIndex]!.text}
            options={clarifyQuestions[clarifyStepIndex]!.options}
            stepLabel={`${clarifyStepIndex + 1}/${clarifyQuestions.length}`}
            focused
            customMode={clarifyCustomMode}
            customValue={clarifyCustomText}
            onChangeCustom={setClarifyCustomText}
            onSubmitCustom={(v) => {
              if (v.trim()) advanceClarify(v.trim());
            }}
            onPickOption={advanceClarify}
            onPickCustom={() => setClarifyCustomMode(true)}
          />
        )}

        {screen === "main" &&
          !replacesMainRegion(overlay) &&
          historyEntries === null &&
          clarifyQuestions === null && (
            <>
              {centered && !fullscreenLyricsActive && inputCluster}
              {!centered && !fullscreenLyricsActive && (
                <>
                  <ResultsList
                    title={resolved ? resolved.name : undefined}
                    count={resolved ? resolved.resolved.length : undefined}
                    lines={lines}
                    selectedIndex={selectedIndex}
                    currentlyPlayingUri={currentlyPlayingUri}
                    isPlaying={isPlaying}
                    loading={loading || connecting}
                    events={events}
                    spinnerFrame={spinnerFrame}
                    reasoningScrollRef={reasoningScrollRef}
                    maxHeight={budget.resultsMaxHeight}
                    width={columnWidth}
                  />
                  {awaitingConfirm && (
                    <ConfirmActions
                      focused
                      onAction={handleConfirmAction}
                      backend={config?.musicBackend}
                      remotePlaylists={isSpotifyBackend}
                    />
                  )}
                  {inputCluster}
                  {/* Absorbs leftover height so the player + status bar stay
                      bottom-anchored now that ResultsList sizes to content. */}
                  <box style={{ flexGrow: 1 }} />
                </>
              )}
              {/* Same bottom-anchoring while the full-screen lyrics box
                  (rendered above this block) replaces the results/input. */}
              {fullscreenLyricsActive && <box style={{ flexGrow: 1 }} />}
              {showCompactLyrics && lyricsResult && (
                <box style={{ height: LYRICS_PANEL_ROWS, flexShrink: 0, flexDirection: "column", alignItems: "center" }}>
                  <LyricsPanel lyrics={lyricsResult} currentLine={lyricsCurrentLine} />
                </box>
              )}
              {nowPlaying && !loading && !connecting ? (
                <box style={{ height: 1, flexShrink: 0, flexDirection: "row" }}>
                  <box style={{ flexDirection: "row", flexGrow: 1, flexShrink: 1, overflow: "hidden" }}>
                    <text>
                      <span fg={theme.subtext}> {isPlaying ? "▶" : "⏸"} </span>
                      {playingPosition && <span fg={theme.muted}>{playingPosition} </span>}
                      {/* Ellipsis-truncate instead of letting flexbox hard-clip
                          mid-word; timer cluster on the right is ~36 cols. The
                          row lives inside the columnWidth box, so budget from
                          that — not the full terminal width. */}
                      <span fg={theme.muted}>
                        {truncateLabel(
                          nowPlaying,
                          Math.max(
                            10,
                            columnWidth - (trackPos && trackDurationMs ? 40 : 5) - (playingPosition ? playingPosition.length + 1 : 0),
                          ),
                        )}
                      </span>
                    </text>
                  </box>
                  {trackPos && trackDurationMs ? (
                    <text fg={theme.subtext}>
                      {" "}
                      {fmtTime(trackPos.positionMs)}{" "}
                      <span fg={theme.accent}>{trackBar(trackPos.positionMs, trackDurationMs).filled}</span>
                      <span fg={theme.muted}>{trackBar(trackPos.positionMs, trackDurationMs).rest}</span>{" "}
                      {fmtTime(trackDurationMs)}
                    </text>
                  ) : null}
                </box>
              ) : null}
              {/* Hidden in full-screen lyrics: lyricsScreenRows budgets for the
                  footer + status bar only, an extra toast row would overflow. */}
              {toast && !loading && !connecting && !fullscreenLyricsActive ? (
                <box style={{ height: 1, flexShrink: 0, flexDirection: "row" }}>
                  <text fg={theme.green}> ✓ {toast.msg}</text>
                </box>
              ) : null}
              <StatusBar
                model={modelLabel}
                backend={config?.musicBackend ?? "spotify"}
                authed={isSpotifyBackend ? authed : true}
                loading={loading || connecting}
                error={error}
                progress={progress}
                spinnerFrame={spinnerFrame}
                elapsed={elapsed}
                cancelHint={escArmed}
                excludedCount={resolved?.unresolved.length}
                volume={volume}
                muted={mutedVolume !== null}
                width={columnWidth}
              />
              {/* Model rides the status bar's backend label — no separate row. */}
            </>
          )}
      </box>
    </box>
  );
}
