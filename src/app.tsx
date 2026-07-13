import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CLIENT_ID,
  isConfigured,
  isValidClientId,
  loadConfig,
  saveConfig,
  type Config,
  type FileConfig,
} from "./config";
import { listOllamaModels } from "./agent/providers/ollama";
import { useProvider, modelLabelFor } from "./hooks/useProviders";
import { useLyrics, type TrackMeta } from "./hooks/useLyrics";
import type { AgentEvent, AgentProvider } from "./agent/types";
import type { ClarifyQuestion } from "./agent/parse";
import {
  generateRandomPlaylistUser,
  type ClarifyAnswer,
} from "./agent/prompts";

import {
  forceFreshLogin,
  getAccessToken,
  isAuthenticated,
  openBrowser,
} from "./spotify/auth";
import { SpotifyClient } from "./spotify/client";
import { createMusicProvider } from "./music/factory";
import { checkLocalPlaybackDeps, player } from "./music/playback";
import {
  addLine,
  appendSession,
  emptyTaste,
  loadTaste,
  needsRotation,
  rotate,
  ROTATE_SYSTEM,
  saveTaste,
  tasteForClarify,
  tastePromptPrefix,
} from "./core/taste";
import type { MusicBackend, RemotePlaylist } from "./music/types";
import { MusicBackendPicker } from "./ui/MusicBackendPicker";
import {
  resolvePlaylist,
  resolveTracks,
  commitPlaylist,
  type ResolvedPlaylist,
  type Progress,
} from "./core/generate-playlist";
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
import {
  appendHistory,
  HISTORY_TITLE_SYSTEM,
  historyEntryToText,
  historyReasoningToText,
  loadHistory,
  updateHistoryTitle,
  type HistoryEntry,
} from "./core/history";
import { copyToClipboard } from "./core/clipboard";
import { ConfirmActions, type ConfirmAction } from "./ui/ConfirmActions";
import { Logo } from "./ui/Logo";
import { theme, truncateLabel } from "./ui/theme";
import { fmtTime, trackBar } from "./ui/format";
import { useToast } from "./hooks/useToast";
import {
  blocksPromptFocus,
  replacesMainRegion,
  type OverlayState,
} from "./app/overlay";
import { layoutBudget, LYRICS_PANEL_ROWS } from "./ui/layout";
import { LyricsPanel } from "./ui/LyricsPanel";
import { LyricsScreen } from "./ui/LyricsScreen";
import { reduceEvents } from "./ui/reasoning";
import type { ScrollBoxRenderable } from "@opentui/core";

type Screen = "loading" | "wizard" | "main";

export function App() {
  const { width, height } = useTerminalDimensions();
  const [config, setConfig] = useState<Config | null>(null);
  const [screen, setScreen] = useState<Screen>("loading");
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  /** The single active modal overlay — opening one structurally replaces any
   * other (see src/app/overlay.ts). */
  const [overlay, setOverlay] = useState<OverlayState>(null);
  const [input, setInput] = useState("");
  const [authed, setAuthed] = useState(false);
  const authedRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [resolved, setResolved] = useState<ResolvedPlaylist | null>(null);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [committedPlaylist, setCommittedPlaylist] =
    useState<RemotePlaylist | null>(null);
  const [clarifyQuestions, setClarifyQuestions] = useState<
    ClarifyQuestion[] | null
  >(null);
  const [clarifyStepIndex, setClarifyStepIndex] = useState(0);
  const [clarifyAnswers, setClarifyAnswers] = useState<ClarifyAnswer[]>([]);
  const [clarifyCustomMode, setClarifyCustomMode] = useState(false);
  const [clarifyCustomText, setClarifyCustomText] = useState("");
  const [pendingBasePrompt, setPendingBasePrompt] = useState<string | null>(
    null,
  );
  const [slashIndex, setSlashIndex] = useState(0);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [escArmed, setEscArmed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const escTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [currentlyPlayingUri, setCurrentlyPlayingUri] = useState<string | null>(
    null,
  );
  const [isPlaying, setIsPlaying] = useState(false);
  // Track progress (ms); durationMs null = unknown → bar hidden.
  const [trackPos, setTrackPos] = useState<{ positionMs: number; durationMs: number | null } | null>(null);
  const [volume, setVolume] = useState<number | null>(null);
  // Mute state: mutedVolume holds the pre-mute level so a second M restores it.
  const [mutedVolume, setMutedVolume] = useState<number | null>(null);
  /** Ordered reasoning/tool transcript, rendered as a chat-style thinking log. */
  const [events, setEvents] = useState<AgentEvent[]>([]);
  // Mirror of `events` readable from runResolve's closure (state var is stale
  // there); used to persist the transcript into session history.
  const eventsRef = useRef<AgentEvent[]>([]);
  /** /history overlay: non-null = open, newest-first session list. */
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[] | null>(null);
  /** Picked session whose stored transcript is shown (detail level). */
  const [historyDetail, setHistoryDetail] = useState<HistoryEntry | null>(null);
  const historyScrollRef = useRef<ScrollBoxRenderable | null>(null);
  /** Deferred resolver for the in-loop `clarify` tool: when the agent calls
   * clarify, the loop awaits this promise; we resolve it from `advanceClarify`
   * once the user picks an option / submits a custom answer. */
  const clarifyResolverRef = useRef<((answer: string) => void) | null>(null);
  const { toast, show } = useToast();
  // Live handle on the reasoning-transcript scrollbox so Up/Down can scroll
  // it while the agent is still generating and the resolved-track list hasn't
  // taken over the screen (see useKeyboard below).
  const reasoningScrollRef = useRef<ScrollBoxRenderable | null>(null);
  /** Lyrics mode: /lyrics toggles. Off by default — no network traffic while off. */
  const [lyricsMode, setLyricsMode] = useState(false);
  /** Full-screen lyrics overlay. */
  const [lyricsFullScreen, setLyricsFullScreen] = useState(false);
  /** Anchor for position interpolation: updated on each 1.5s poll. */
  const lyricsAnchorRef = useRef<{ positionMs: number; wallClock: number; isPlaying: boolean } | null>(null);
  /** Current track metadata for lyrics lookup — updated on each poll. */
  const [currentTrackMeta, setCurrentTrackMeta] = useState<TrackMeta>({ uri: null, artist: "", title: "", durationMs: 0 });
  // Taste sessions group by generation; /like lands in the latest one.
  const sessionHeaderRef = useRef<string>(new Date().toISOString().slice(0, 16));
  // Soft seed context: the previous session's resolved playlist (as
  // "artist – title" lines) is fed into the next generation's user prompt.
  // Lives in memory only — /clear nulls it; restart loses it (consistent
  // with `resolved`/`committedPlaylist`/`events`).
  const priorPlaylistRef = useRef<string[] | null>(null);

  function disarmEsc() {
    if (escTimerRef.current) clearTimeout(escTimerRef.current);
    escTimerRef.current = null;
    setEscArmed(false);
  }

  // One timer drives both spinner and elapsed-seconds while generating.
  useEffect(() => {
    if (!loading || startTime === null) return;
    const id = setInterval(() => {
      setSpinnerFrame((f) => (f + 1) % 10);
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 80);
    return () => clearInterval(id);
  }, [loading, startTime]);

  useEffect(() => {
    loadConfig().then(async (c) => {
      setConfig(c);
      setVolume(c.volume);
      // Local backends: prime the mpv singleton with the persisted volume so
      // the first track plays at the right level. Spotify volume is set per
      // playback action since there's no persistent mpv for it.
      player.setInitialVolume(c.volume);
      const a = await isAuthenticated(c);
      authedRef.current = a;
      setAuthed(a);
      // Spotify auth only matters for the spotify backend; local backends
      // need external binaries instead.
      if (c.musicBackend === "spotify") {
        if (!a) setOverlay({ kind: "connect-confirm" });
      } else {
        const depError = checkLocalPlaybackDeps(c.musicBackend);
        if (depError) setError(depError);
      }
      setOllamaModels(await listOllamaModels(c.ollamaUrl));
      setScreen(isConfigured(c) ? "main" : "wizard");
    });
  }, []);

  // Poll current playback state (which track is playing / paused):
  // spotify — its Web API /me/player; local backends — the mpv-backed player.
  useEffect(() => {
    if (loading || !config) return;
    const isSpotify = config.musicBackend === "spotify";
    if (isSpotify && !authed) return;
    let cancelled = false;
    const poll = async () => {
      try {
        if (isSpotify) {
          const token = await getAccessToken(config);
          const spotify = new SpotifyClient(token);
          const state = await spotify.getCurrentlyPlaying();
          if (cancelled) return;
          setCurrentlyPlayingUri(state?.uri ?? null);
          setIsPlaying(state?.isPlaying ?? false);
          if (typeof state?.volume === "number") setVolume(state.volume);
          setTrackPos(
            state
              ? { positionMs: state.progressMs ?? 0, durationMs: state.durationMs ?? null }
              : null,
          );
          lyricsAnchorRef.current = state
            ? { positionMs: state.progressMs ?? 0, wallClock: Date.now(), isPlaying: state.isPlaying ?? false }
            : null;
          if (state?.uri) {
            setCurrentTrackMeta({
              uri: state.uri,
              artist: state.trackArtist ?? "",
              title: state.trackTitle ?? "",
              durationMs: state.durationMs ?? 0,
            });
          }
        } else {
          const state = await player.getCurrentlyPlaying();
          if (cancelled) return;
          setCurrentlyPlayingUri(state?.track?.uri ?? null);
          setIsPlaying(state?.isPlaying ?? false);
          if (typeof state?.volume === "number") setVolume(state.volume);
          setTrackPos(
            state ? { positionMs: state.positionMs, durationMs: state.durationMs } : null,
          );
          lyricsAnchorRef.current = state
            ? { positionMs: state.positionMs, wallClock: Date.now(), isPlaying: state.isPlaying }
            : null;
          if (state?.track) {
            setCurrentTrackMeta({
              uri: state.track.uri,
              artist: state.track.artist ?? "",
              title: state.track.title ?? "",
              durationMs: state.track.durationMs ?? 0,
            });
          }
        }
      } catch {
        // ignore polling errors
      }
    };
    poll();
    const id = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [authed, loading, config]);

  const { lyricsData, interpolatedPosMs, lyricsCurrentLine, clearLyricsCache } = useLyrics(
    lyricsMode,
    currentlyPlayingUri,
    currentTrackMeta,
    lyricsAnchorRef,
  );

  const connectingRef = useRef(false);

  const slashCommands = useMemo(
    () => (input.trimStart().startsWith("/") ? filterSlashCommands(input) : []),
    [input],
  );
  const slashMenuOpen =
    screen === "main" &&
    !replacesMainRegion(overlay) &&
    historyEntries === null &&
    slashCommands.length > 0;

  const isSpotifyBackend = config?.musicBackend !== "soundcloud" && config?.musicBackend !== "youtube-music";

  const provider: AgentProvider | null = useProvider(config);
  const modelLabel = modelLabelFor(config);

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

  function cancelClarify() {
    setClarifyQuestions(null);
    setClarifyStepIndex(0);
    setClarifyAnswers([]);
    setClarifyCustomMode(false);
    setClarifyCustomText("");
    setPendingBasePrompt(null);
  }

  function cancelResult() {
    setResolved(null);
    setAwaitingConfirm(false);
    setCommittedPlaylist(null);
    setPendingBasePrompt(null);
    setClarifyAnswers([]);
    priorPlaylistRef.current = null;
  }

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
        const taste = await loadTaste();
        await saveTaste({ ...taste, sessions: [] });
        setOverlay(null);
        return;
      }
      if (key.name === "a") {
        await saveTaste(emptyTaste());
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
        else if (key.name === "return") void loadHistorySession(historyDetail);
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
          // If the agent loop is parked on the deferred clarify tool call,
          // aborting the controller alone won't unblock it — the loop is
          // awaiting a Promise that only `advanceClarify` resolves. Drain it
          // with an empty answer so dispatchTool returns; the loop's next
          // iteration will see `signal.aborted` and throw, releasing loading.
          const drain = clarifyResolverRef.current as ((answer: string) => void) | null;
          if (drain) {
            clarifyResolverRef.current = null;
            drain("");
          }
          abortRef.current?.abort();
        } else {
          setEscArmed(true);
          if (escTimerRef.current) clearTimeout(escTimerRef.current);
          escTimerRef.current = setTimeout(() => {
            escTimerRef.current = null;
            setEscArmed(false);
          }, 2000);
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

  async function runLoginAndResume(
    resumePrompt: string | null,
    cfgOverride?: Config,
  ): Promise<void> {
    const cfg = cfgOverride ?? config;
    if (!cfg || connectingRef.current) return;
    if (!isValidClientId(cfg.spotifyClientId)) {
      setPendingPrompt(resumePrompt);
      setOverlay({ kind: "client-id", text: "" });
      return;
    }
    connectingRef.current = true;
    setConnecting(true);
    setError(undefined);
    try {
      // /login (resumePrompt === null) means the user explicitly asked to
      // re-connect, so force a fresh browser-based auth instead of returning
      // the cached token.
      const token =
        resumePrompt === null
          ? await forceFreshLogin(cfg)
          : await getAccessToken(cfg);
      void token;
      authedRef.current = true;
      setAuthed(true);
      if (resumePrompt === null) show("logged in ✓");
      if (resumePrompt) {
        if (resumePrompt === "__random__") {
          setHasInteracted(true);
          await runResolve(generateRandomPlaylistUser(), []);
        } else {
          await handleSubmit(resumePrompt);
        }
      }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      connectingRef.current = false;
      setConnecting(false);
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
    const next = await saveConfig({ spotifyClientId: id });
    setConfig(next);
    setOverlay(null);
    const resume = pendingPrompt;
    setPendingPrompt(null);
    await runLoginAndResume(resume, next);
  }

  // Ctrl+P quick-toggle between ollama and claude-cli. The full /model picker
  // is a multi-level config UI; this shortcut bypasses it for the common case.
  async function quickToggleModel() {
    const next = await saveConfig({
      defaultProvider: config?.defaultProvider === "ollama" ? "claude-cli" : "ollama",
      ...(config?.defaultProvider === "ollama"
        ? { claudeModel: config?.claudeModel ?? "sonnet" }
        : { ollamaModel: config?.ollamaModel }),
    });
    setConfig(next);
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
    const next = await saveConfig({ defaultProvider: provider });
    setConfig(next);
    if (opts?.closePicker ?? true) setOverlay(null);
    return null;
  }

  // /model: save a field edit without switching provider (editing apiKey/baseUrl
  // on a provider's config page). Keeps the picker open so the user can then
  // hit "▶ use".
  async function onSaveField(partial: FileConfig) {
    const next = await saveConfig(partial);
    setConfig(next);
  }

  // Push a new volume to the active backend and persist it. Spotify routes
  // through its Web API; local backends go through the mpv singleton. The
  // polling effect keeps `volume` in sync if the backend changes it on its
  // side (e.g. another Spotify client).
  async function applyVolume(pct: number) {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    setVolume(clamped);
    const next = await saveConfig({ volume: clamped });
    setConfig(next);
    try {
      if (isSpotifyBackend && authedRef.current && config) {
        const token = await getAccessToken(config);
        await new SpotifyClient(token).setVolume(clamped);
      } else {
        await player.setVolume(clamped);
      }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }

  async function adjustVolume(delta: number) {
    const base = volume ?? config?.volume ?? 70;
    // If muted, adjusting from the muted level feels wrong — start from the
    // remembered pre-mute level instead so the first tap unmutes and moves.
    const from = mutedVolume !== null ? mutedVolume : base;
    const next = Math.max(0, Math.min(100, from + delta));
    if (mutedVolume !== null) setMutedVolume(null);
    await applyVolume(next);
  }

  async function toggleMute() {
    if (mutedVolume !== null) {
      const restore = mutedVolume;
      setMutedVolume(null);
      await applyVolume(restore);
    } else {
      const current = volume ?? config?.volume ?? 70;
      setMutedVolume(current);
      await applyVolume(0);
    }
  }

  async function applyBackendChoice(backend: MusicBackend) {
    // A locally playing track belongs to the old backend — stop before switching.
    await player.stop();
    setCurrentlyPlayingUri(null);
    setIsPlaying(false);
    // Resolved tracks carry old-backend URIs (spotify:… / ytm:…) — they can't
    // be played or committed on the new backend, so drop the list and any
    // pending "what next?" confirm along with it.
    setAwaitingConfirm(false);
    setResolved(null);
    setCommittedPlaylist(null);
    setSelectedIndex(0);
    const next = await saveConfig({ musicBackend: backend });
    setConfig(next);
    setOverlay(null);
    setError(checkLocalPlaybackDeps(backend) ?? undefined);
  }

  async function applyEffortChoice(effort: string) {
    const next = await saveConfig({ claudeEffort: effort });
    setConfig(next);
    setOverlay(null);
  }

  async function applySystemPrompt(value: string) {
    const next = await saveConfig({ customSystemPrompt: value });
    setConfig(next);
    setOverlay(null);
  }

  async function runResolve(
    prompt: string,
    qa: ClarifyAnswer[],
  ): Promise<ResolvedPlaylist | null> {
    if (!config || !provider) return null;
    setError(undefined);
    setLoading(true);
    setProgress(null);
    setElapsed(0);
    setStartTime(Date.now());
    setEvents([]);
    eventsRef.current = [];
    // Clear the previous run's results so the reasoning transcript takes over
    // the screen (it only renders when the track list is empty). Without this,
    // a re-run leaves the stale list up and the thinking view never shows.
    setResolved(null);
    setAwaitingConfirm(false);
    setCommittedPlaylist(null);
    // If a stale resolver lingers from a cancelled run, drop it so the next
    // clarify tool call installs a fresh one.
    clarifyResolverRef.current = null;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const music = await createMusicProvider(config);
      if (config.musicBackend === "spotify") setAuthed(true);
      const taste = await loadTaste();
      // System-prompt taste prefix carries the full curated+raw digest; the
      // clarify channel carries just artist names grounded in the user's
      // prior taste (decision Q4: only names, not the whole file).
      const tasteFull = tastePromptPrefix(taste) || undefined;
      const tasteArtists = tasteForClarify(taste) || undefined;
      // Agent-loop system prompt carries the full curated+raw taste digest; the
      // taste-artists channel below is appended only when an artist-name list
      // was extractable (decision Q4: clarify grounded in prior artist picks),
      // and is used as additional prefix to ease clarify grounding without
      // duplicating the entire taste file.
      const tasteClarifyChannel = tasteArtists
        ? `\n\n${tasteArtists}`
        : "";
      const r = await resolvePlaylist(
        provider,
        music,
        prompt,
        qa,
        {
          onProgress: (p) => setProgress(p),
          onEvent: (e) =>
            setEvents((prev) => {
              const next = reduceEvents(prev, e);
              eventsRef.current = next;
              return next;
            }),
          signal: controller.signal,
          tasteContext: (tasteFull ?? "") + tasteClarifyChannel || undefined,
          priorPlaylistContext: priorPlaylistRef.current ?? undefined,
          onClarifyTool: async (question, options) => {
            // Surface the question to the existing ClarifyPrompt UI; await the
            // user's answer via a deferred resolver.
            setClarifyQuestions([{ text: question, options }]);
            setClarifyStepIndex(0);
            setClarifyCustomMode(false);
            setClarifyCustomText("");
            return new Promise<string>((resolve) => {
              clarifyResolverRef.current = resolve;
            });
          },
        },
      );
      setResolved(r);
      setCommittedPlaylist(null);
      setAwaitingConfirm(true);
      setSelectedIndex(0);
      // Capture the just-finished playlist as soft seed for the NEXT request.
      // /clear nulls this ref; the next runResolve reads it before overwriting.
      priorPlaylistRef.current = r.resolved.map((t) => `${t.artist} – ${t.title}`);
      void recordTasteSession(r);
      void recordHistorySession(prompt, r);
      return r;
    } catch (e) {
      // User-initiated cancel is not an error. But a stuck deferred clarify
      // (cancelled mid-question) must be drained so a future generate call
      // doesn't see a stale resolver.
      const drain = clarifyResolverRef.current as ((answer: string) => void) | null;
      if (drain) {
        drain("");
        clarifyResolverRef.current = null;
      }
      if (!(
        controller.signal.aborted ||
        (e instanceof Error && e.name === "AbortError")
      )) {
        setError(String(e instanceof Error ? e.message : e));
      }
      return null;
    } finally {
      abortRef.current = null;
      disarmEsc();
      setLoading(false);
      setProgress(null);
      setStartTime(null);
    }
  }

  // Best-effort taste memory: only sessions where ≥50% of tracks resolved.
  async function recordTasteSession(r: ResolvedPlaylist) {
    const total = r.resolved.length + r.unresolved.length;
    if (total === 0 || r.resolved.length / total < 0.5) return;
    try {
      const header = new Date().toISOString().slice(0, 16);
      sessionHeaderRef.current = header;
      let taste = await loadTaste();
      taste = appendSession(taste, {
        header,
        lines: r.resolved.map((t) => `- ${t.artist} – ${t.title}`),
      });
      if (needsRotation(taste) && provider) {
        taste = await rotate(taste, (raw) =>
          provider.generate(ROTATE_SYSTEM, raw, undefined, undefined, { reasoningEffort: "none", maxTokens: 512 }).then(
            (r) => r.text,
          ),
        ).catch(() => taste);
      }
      await saveTaste(taste);
    } catch {
      // never block generation on memory failures
    }
  }

  // Persist the finished session (prompt + playlist + reasoning transcript)
  // into history.json, then patch in an LLM-summarized title. The entry is
  // saved immediately with the playlist name as fallback so a failed/slow
  // title call never loses the session.
  async function recordHistorySession(prompt: string, r: ResolvedPlaylist) {
    if (!config) return;
    try {
      const header = new Date().toISOString();
      const entry: HistoryEntry = {
        header,
        prompt,
        title: r.name || prompt,
        playlistName: r.name,
        tracks: r.resolved.map((t) => ({ artist: t.artist, title: t.title })),
        events: eventsRef.current,
      };
      await appendHistory(config, entry);
      if (!provider) return;
      const digest = [
        `Request: ${prompt}`,
        `Playlist: ${r.name}`,
        "Tracks:",
        ...entry.tracks.map((t) => `- ${t.artist} – ${t.title}`),
      ].join("\n");
      const title = (await provider.generate(HISTORY_TITLE_SYSTEM, digest)).text
        .trim()
        .split("\n")[0]
        ?.trim();
      if (title) await updateHistoryTitle(config, header, title.slice(0, 60));
    } catch {
      // never block generation on history failures
    }
  }

  // /history playback: re-resolve a stored session's tracks against the
  // current backend (stored entries carry no URIs — the backend may have
  // changed since) and load them into the normal resolved list, where the
  // existing playback/save/like flow takes over.
  async function loadHistorySession(entry: HistoryEntry) {
    if (!config || loading) return;
    setHistoryEntries(null);
    setHistoryDetail(null);
    setHasInteracted(true);
    setError(undefined);
    setLoading(true);
    setProgress(null);
    setElapsed(0);
    setStartTime(Date.now());
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const music = await createMusicProvider(config);
      const { resolved, unresolved } = await resolveTracks(
        entry.tracks,
        music,
        controller.signal,
        setProgress,
      );
      if (resolved.length === 0) {
        setError(`no tracks resolved on ${music.name}`);
        return;
      }
      setResolved({
        name: entry.playlistName || entry.title,
        description: `Replayed from history: ${entry.prompt}`,
        resolved,
        unresolved,
      });
      setCommittedPlaylist(null);
      // No confirm step — the list is immediately playable (Enter plays).
      setAwaitingConfirm(false);
      setSelectedIndex(0);
      priorPlaylistRef.current = resolved.map((t) => `${t.artist} – ${t.title}`);
      show(`loaded from history · ${resolved.length} tracks — enter to play`);
    } catch (e) {
      if (!(controller.signal.aborted || (e instanceof Error && e.name === "AbortError"))) {
        setError(String(e instanceof Error ? e.message : e));
      }
    } finally {
      abortRef.current = null;
      disarmEsc();
      setLoading(false);
      setProgress(null);
      setStartTime(null);
    }
  }

  function advanceClarify(answer: string) {
    if (!clarifyQuestions) return;
    // Agent loop drives clarify through the `clarify` tool — one question per
    // call. The deferred resolver installed by `runResolve`'s `onClarifyTool`
    // hook is held by `clarifyResolverRef`. Resolving it unblocks the loop and
    // lets the model continue with the user's answer. Multi-question clarify
    // from a single `clarify` call is explicitly out of scope (loop decides).
    const resolver = clarifyResolverRef.current;
    setClarifyCustomMode(false);
    setClarifyCustomText("");
    setClarifyQuestions(null);
    setClarifyStepIndex(0);
    if (resolver) {
      clarifyResolverRef.current = null;
      resolver(answer);
    }
  }

  async function handleConfirmAction(action: ConfirmAction) {
    if (action === "cancel") {
      cancelResult();
      return;
    }
    if (action === "listen") {
      // Keep the resolved list on screen for playback without committing a playlist.
      setAwaitingConfirm(false);
      return;
    }
    if (action === "continue") {
      if (!pendingBasePrompt) return;
      await runResolve(pendingBasePrompt, clarifyAnswers);
      return;
    }
    // add
    await savePlaylist();
  }

  async function savePlaylist() {
    if (!config || !resolved) return;
    setError(undefined);
    try {
      const music = await createMusicProvider(config);
      if (!music.capabilities.remotePlaylists) {
        // No playlists on the service side — the local queue is the playlist.
        await player.queue(resolved.resolved, music);
        setAwaitingConfirm(false);
        show(`queued ${resolved.resolved.length} tracks locally`);
        return;
      }
      setAuthed(true);
      const playlist = await commitPlaylist(
        music,
        resolved.name,
        resolved.description,
        resolved.resolved,
        setProgress,
      );
      setCommittedPlaylist(playlist);
      setAwaitingConfirm(false);
      setProgress(null);
      show(`saved as playlist · ${playlist.name ?? playlist.uri}`);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
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
    if (trimmed === "/model") {
      setInput("");
      setOllamaModels(await listOllamaModels(config!.ollamaUrl));
      setOverlay({ kind: "model-picker" });
      return;
    }
    if (trimmed === "/music") {
      setInput("");
      setOverlay({ kind: "backend-picker" });
      return;
    }
    if (trimmed === "/login") {
      setInput("");
      await runLoginAndResume(null);
      return;
    }
    if (trimmed === "/clientid") {
      setInput("");
      setOverlay({ kind: "client-id", text: "" });
      return;
    }
    if (trimmed === "/effort") {
      setInput("");
      if (config?.defaultProvider === "ollama") {
        setError("effort only applies to the Claude provider");
        return;
      }
      setOverlay({ kind: "effort-picker" });
      return;
    }
    if (trimmed === "/systemprompt") {
      setInput("");
      setOverlay({ kind: "system-prompt", text: config?.customSystemPrompt ?? "" });
      return;
    }
    if (trimmed === "/save") {
      setInput("");
      if (!resolved) {
        setError("nothing to save — generate a track list first");
        return;
      }
      if (committedPlaylist) {
        setError("already saved as a playlist");
        return;
      }
      await savePlaylist();
      return;
    }
    if (trimmed === "/clear") {
      setInput("");
      // Abort any in-flight generation (mirror the double-Esc path) so a
      // clear mid-generation actually stops the loop instead of racing it.
      if (loading) {
        const drain = clarifyResolverRef.current as ((answer: string) => void) | null;
        if (drain) {
          clarifyResolverRef.current = null;
          drain("");
        }
        abortRef.current?.abort();
      }
      // Stop local playback so a still-running mpv/Spotify doesn't outlive
      // the cleared session (mirror applyBackendChoice).
      await player.stop();
      setResolved(null);
      setCommittedPlaylist(null);
      setAwaitingConfirm(false);
      setPendingBasePrompt(null);
      setClarifyQuestions(null);
      setClarifyStepIndex(0);
      setClarifyAnswers([]);
      setEvents([]);
      setProgress(null);
      setError(undefined);
      setCurrentlyPlayingUri(null);
      setIsPlaying(false);
      setTrackPos(null);
      setLyricsMode(false);
      setLyricsFullScreen(false);
      setCurrentTrackMeta({ uri: null, artist: "", title: "", durationMs: 0 });
      clearLyricsCache();
      setSelectedIndex(0);
      // Wipe the prior-playlist seed so the next request starts fresh.
      priorPlaylistRef.current = null;
      show("session cleared");
      return;
    }
    if (trimmed === "/like" || trimmed.startsWith("/like ")) {
      setInput("");
      const comment = trimmed.slice("/like".length).trim();
      const track =
        resolved?.resolved.find((t) => t.uri === currentlyPlayingUri) ??
        resolved?.resolved[selectedIndex];
      if (!track) {
        setError("nothing to like — no current track");
        return;
      }
      const line = comment
        ? `- ${track.artist} – ${track.title} (liked: "${comment}")`
        : `- ${track.artist} – ${track.title} (liked)`;
      const taste = await loadTaste();
      await saveTaste(addLine(taste, sessionHeaderRef.current, line));
      show(`liked · ${track.artist} – ${track.title}`);
      return;
    }
    if (trimmed === "/memory") {
      setInput("");
      const taste = await loadTaste();
      if (taste.preferences.length === 0 && taste.sessions.length === 0) {
        setOverlay({ kind: "memory", text: "taste memory is empty — /like tracks or generate playlists" });
        return;
      }
      const last = taste.sessions.at(-1);
      setOverlay({
        kind: "memory",
        text: [
          "Preferences:",
          ...(taste.preferences.length ? taste.preferences : ["- (none yet)"]),
          ...(last ? ["", `Last session (${last.header}):`, ...last.lines] : []),
        ].join("\n"),
      });
      return;
    }
    if (trimmed === "/lyrics") {
      setInput("");
      // Cycle: off → compact → fullscreen → off
      if (lyricsFullScreen) {
        setLyricsFullScreen(false);
        setLyricsMode(false);
      } else if (lyricsMode) {
        setLyricsFullScreen(true);
      } else {
        setLyricsMode(true);
      }
      return;
    }
    if (trimmed === "/history") {
      setInput("");
      if (!config) return;
      const entries = await loadHistory(config);
      if (entries.length === 0) {
        setError("no history yet — generate a playlist first");
        return;
      }
      setHistoryDetail(null);
      // Newest first in the list.
      setHistoryEntries(entries.slice().reverse());
      return;
    }
    if (trimmed === "/forget") {
      setInput("");
      setOverlay({ kind: "forget-confirm" });
      return;
    }
    if (trimmed === "/quit") process.exit(0);
    if (trimmed === "/random") {
      setInput("");
      if (!config || !provider || loading) {
        setError("not ready — still loading or no provider");
        return;
      }
      if (isSpotifyBackend && !authedRef.current) {
        setPendingPrompt("__random__");
        setOverlay({ kind: "connect-confirm" });
        return;
      }
      setHasInteracted(true);
      const r = await runResolve(generateRandomPlaylistUser(), []);
      if (r) show(`random playlist ready · ${r.resolved.length} tracks`);
      return;
    }
    // Every real command returned above — anything else starting with "/" is
    // an unknown/removed command; error instead of feeding it to the agent.
    if (trimmed.startsWith("/")) {
      setInput("");
      setError(`unknown command: ${trimmed.split(/\s+/)[0]}`);
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
    setElapsed(0);
    setEvents([]);
    // Agent loop drives clarify through the `clarify` tool — no separate
    // pre-step. runResolve sets progress and aborts itself; the loop surfaces
    // questions to ClarifyPrompt via the deferred resolver in `advanceClarify`.
    await runResolve(trimmed, []);
  }

  async function handlePlay() {
    if (!config) return;
    // Local backends: play through mpv, queueing the rest of the list so
    // playback continues past the selected track.
    if (!isSpotifyBackend) {
      const track = resolved?.resolved[selectedIndex];
      if (!track) return;
      try {
        const state = await player.getCurrentlyPlaying();
        if (state?.track?.uri === track.uri) {
          if (state.isPlaying) {
            await player.pause();
            setIsPlaying(false);
          } else {
            await player.resume();
            setIsPlaying(true);
          }
          return;
        }
        const music = await createMusicProvider(config);
        await player.queue(resolved!.resolved.slice(selectedIndex), music);
        setCurrentlyPlayingUri(track.uri);
        setIsPlaying(true);
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e));
      }
      return;
    }
    if (!authedRef.current) {
      setOverlay({ kind: "connect-confirm" });
      return;
    }
    // Selected track plays directly (works before any playlist is committed);
    // fall back to the committed playlist context when nothing is selected.
    const track = resolved?.resolved[selectedIndex];
    const target = track?.uri ?? committedPlaylist?.uri;
    if (!target) return;
    try {
      const token = await getAccessToken(config);
      const spotify = new SpotifyClient(token);
      // Re-check live state (the 1.5s poll can be stale): pressing enter on the
      // track that's already playing pauses it instead of restarting it.
      const state = await spotify.getCurrentlyPlaying();
      if (state?.uri === target) {
        if (state.isPlaying) {
          await spotify.pause();
          setIsPlaying(false);
        } else {
          await spotify.resume();
          setIsPlaying(true);
        }
        return;
      }
      await spotify.play(target);
      setCurrentlyPlayingUri(target);
      setIsPlaying(true);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
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
              const next = await saveConfig({
                defaultProvider: r.provider,
                musicBackend: r.musicBackend,
                ...(r.soundcloudClientId ? { soundcloudClientId: r.soundcloudClientId } : {}),
                ...(r.ollamaModel ? { ollamaModel: r.ollamaModel } : {}),
                ...(r.claudeModel ? { claudeModel: r.claudeModel } : {}),
              });
              setConfig(next);
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
