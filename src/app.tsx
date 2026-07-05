import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CLIENT_ID,
  isConfigured,
  isValidClientId,
  loadConfig,
  saveConfig,
  type Config,
} from "./config";
import { ClaudeCliProvider } from "./agent/providers/claude-cli";
import { OllamaProvider, listOllamaModels } from "./agent/providers/ollama";
import type { AgentProvider } from "./agent/types";
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
  tastePromptPrefix,
} from "./core/taste";
import type { MusicBackend, RemotePlaylist } from "./music/types";
import { MusicBackendPicker } from "./ui/MusicBackendPicker";
import {
  clarify,
  resolvePlaylist,
  commitPlaylist,
  type ResolvedPlaylist,
  type Progress,
} from "./core/generate-playlist";
import { PromptInput } from "./ui/PromptInput";
import { ResultsList, type ResultLine } from "./ui/ResultsList";
import { StatusBar } from "./ui/StatusBar";
import { SetupWizard } from "./ui/SetupWizard";
import { ModelPicker, type ModelChoice } from "./ui/ModelPicker";
import { EffortPicker } from "./ui/EffortPicker";
import { SlashMenu, filterSlashCommands } from "./ui/SlashMenu";
import { ConnectPrompt } from "./ui/ConnectPrompt";
import { ClarifyPrompt } from "./ui/ClarifyPrompt";
import { ClientIdPrompt } from "./ui/ClientIdPrompt";
import { SystemPromptPrompt } from "./ui/SystemPromptPrompt";
import { ConfirmActions, type ConfirmAction } from "./ui/ConfirmActions";
import { Logo } from "./ui/Logo";
import { theme } from "./ui/theme";

type Screen = "loading" | "wizard" | "main";

export function App() {
  const { width, height } = useTerminalDimensions();
  const [config, setConfig] = useState<Config | null>(null);
  const [screen, setScreen] = useState<Screen>("loading");
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [backendPickerOpen, setBackendPickerOpen] = useState(false);
  const [effortPickerOpen, setEffortPickerOpen] = useState(false);
  const [clientIdOpen, setClientIdOpen] = useState(false);
  const [clientIdText, setClientIdText] = useState("");
  const [clientIdError, setClientIdError] = useState<string | undefined>(
    undefined,
  );
  const [claudeFamilyOpen, setClaudeFamilyOpen] = useState(false);
  const [systemPromptOpen, setSystemPromptOpen] = useState(false);
  const [systemPromptText, setSystemPromptText] = useState("");
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
  const [confirmConnect, setConfirmConnect] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [tokenCount, setTokenCount] = useState(0);
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
  const [memoryText, setMemoryText] = useState<string | null>(null);
  const [forgetOpen, setForgetOpen] = useState(false);
  // Taste sessions group by generation; /like lands in the latest one.
  const sessionHeaderRef = useRef<string>(new Date().toISOString().slice(0, 16));

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
      const a = await isAuthenticated(c);
      authedRef.current = a;
      setAuthed(a);
      // Spotify auth only matters for the spotify backend; local backends
      // need external binaries instead.
      if (c.musicBackend === "spotify") {
        if (!a) setConfirmConnect(true);
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
        } else {
          const state = await player.getCurrentlyPlaying();
          if (cancelled) return;
          setCurrentlyPlayingUri(state?.track?.uri ?? null);
          setIsPlaying(state?.isPlaying ?? false);
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

  const connectingRef = useRef(false);

  const slashCommands = useMemo(
    () => (input.trimStart().startsWith("/") ? filterSlashCommands(input) : []),
    [input],
  );
  const slashMenuOpen =
    screen === "main" &&
    !pickerOpen &&
    !backendPickerOpen &&
    !clientIdOpen &&
    !effortPickerOpen &&
    !systemPromptOpen &&
    slashCommands.length > 0;

  const isSpotifyBackend = config?.musicBackend !== "soundcloud" && config?.musicBackend !== "youtube-music";

  const provider: AgentProvider | null = useMemo(() => {
    if (!config) return null;
    return config.defaultProvider === "ollama"
      ? new OllamaProvider({ url: config.ollamaUrl, model: config.ollamaModel })
      : new ClaudeCliProvider({
          model: config.claudeModel,
          effort: config.claudeEffort,
          systemPrompt: config.customSystemPrompt,
        });
  }, [config]);

  const modelLabel = config
    ? config.defaultProvider === "ollama"
      ? `ollama:${config.ollamaModel}`
      : `claude:${config.claudeModel} · effort:${config.claudeEffort}`
    : "";

  const lines: ResultLine[] = useMemo(() => {
    if (!resolved) return [];
    return resolved.resolved.map((t, i) => ({
      key: `r${i}`,
      label: `${t.artist} — ${t.title}`,
      uri: t.uri,
      resolved: true,
    }));
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
  }

  useKeyboard(async (key) => {
    if (key.ctrl && key.name === "c") process.exit(0);
    if (screen !== "main") return;
    if (confirmConnect) {
      if (key.name === "y") {
        const resume = pendingPrompt;
        setConfirmConnect(false);
        setPendingPrompt(null);
        await runLoginAndResume(resume);
        return;
      }
      if (key.name === "n" || key.name === "escape") {
        setConfirmConnect(false);
        setPendingPrompt(null);
        return;
      }
      return;
    }
    if (forgetOpen) {
      if (key.name === "r") {
        const taste = await loadTaste();
        await saveTaste({ ...taste, sessions: [] });
        setForgetOpen(false);
        return;
      }
      if (key.name === "a") {
        await saveTaste(emptyTaste());
        setForgetOpen(false);
        return;
      }
      if (key.name === "escape" || key.name === "n") setForgetOpen(false);
      return;
    }
    if (memoryText !== null) {
      if (key.name === "escape") setMemoryText(null);
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
    if (clientIdOpen) {
      if (key.name === "escape") {
        setClientIdOpen(false);
        setClientIdText("");
        setClientIdError(undefined);
      }
      if (key.ctrl && key.name === "o") {
        void openBrowser("https://developer.spotify.com/dashboard");
      }
      return;
    }
    if (effortPickerOpen) {
      if (key.name === "escape") setEffortPickerOpen(false);
      return;
    }
    if (systemPromptOpen) {
      if (key.name === "escape") {
        setSystemPromptOpen(false);
        setSystemPromptText("");
      }
      return;
    }
    if (backendPickerOpen) {
      if (key.name === "escape") setBackendPickerOpen(false);
      return;
    }
    if (pickerOpen) {
      if (key.name === "escape") {
        if (claudeFamilyOpen) {
          setClaudeFamilyOpen(false);
        } else {
          setPickerOpen(false);
        }
      }
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
      setBackendPickerOpen(true);
      return;
    }
    if (key.ctrl && key.name === "p") {
      await applyModelChoice(
        config?.defaultProvider === "ollama"
          ? {
              provider: "claude-cli",
              claudeModel: config?.claudeModel ?? "sonnet",
            }
          : { provider: "ollama", ollamaModel: config?.ollamaModel },
      );
      return;
    }
    // Input owns printable keys; only handle chrome/navigation.
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
      setClientIdText("");
      setClientIdError(undefined);
      setClientIdOpen(true);
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
      setClientIdError("invalid — expected 32 hex characters");
      return;
    }
    const next = await saveConfig({ spotifyClientId: id });
    setConfig(next);
    setClientIdOpen(false);
    setClientIdText("");
    setClientIdError(undefined);
    const resume = pendingPrompt;
    setPendingPrompt(null);
    await runLoginAndResume(resume, next);
  }

  async function applyModelChoice(choice: ModelChoice) {
    const next = await saveConfig({
      defaultProvider: choice.provider,
      ...(choice.ollamaModel ? { ollamaModel: choice.ollamaModel } : {}),
      ...(choice.claudeModel ? { claudeModel: choice.claudeModel } : {}),
    });
    setConfig(next);
    setClaudeFamilyOpen(false);
    setPickerOpen(false);
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
    setBackendPickerOpen(false);
    setError(checkLocalPlaybackDeps(backend) ?? undefined);
  }

  async function applyEffortChoice(effort: string) {
    const next = await saveConfig({ claudeEffort: effort });
    setConfig(next);
    setEffortPickerOpen(false);
  }

  async function applySystemPrompt(value: string) {
    const next = await saveConfig({ customSystemPrompt: value });
    setConfig(next);
    setSystemPromptOpen(false);
  }

  async function runResolve(prompt: string, qa: ClarifyAnswer[]) {
    if (!config || !provider) return;
    setError(undefined);
    setLoading(true);
    setProgress(null);
    setTokenCount(0);
    setElapsed(0);
    setStartTime(Date.now());
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const music = await createMusicProvider(config);
      if (config.musicBackend === "spotify") setAuthed(true);
      const taste = await loadTaste();
      const r = await resolvePlaylist(
        provider,
        music,
        prompt,
        qa,
        (p) => {
          setProgress(p);
          // Retry after parse-fail restarts the token stream; count only the live attempt.
          if (p.phase === "thinking") setTokenCount(0);
        },
        (delta) => setTokenCount((n) => n + delta.length),
        controller.signal,
        tastePromptPrefix(taste) || undefined,
      );
      setResolved(r);
      setCommittedPlaylist(null);
      setAwaitingConfirm(true);
      setSelectedIndex(0);
      void recordTasteSession(r);
    } catch (e) {
      // User-initiated cancel is not an error.
      if (!(
        controller.signal.aborted ||
        (e instanceof Error && e.name === "AbortError")
      )) {
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
        taste = await rotate(taste, (raw) => provider.generate(ROTATE_SYSTEM, raw)).catch(
          () => taste,
        );
      }
      await saveTaste(taste);
    } catch {
      // never block generation on memory failures
    }
  }

  function advanceClarify(answer: string) {
    if (!clarifyQuestions) return;
    const q = clarifyQuestions[clarifyStepIndex];
    if (!q) return;
    const newAnswers = [...clarifyAnswers, { question: q.text, answer }];
    const nextIndex = clarifyStepIndex + 1;
    setClarifyCustomMode(false);
    setClarifyCustomText("");
    if (nextIndex >= clarifyQuestions.length) {
      const prompt = pendingBasePrompt;
      setClarifyQuestions(null);
      setClarifyStepIndex(0);
      setClarifyAnswers(newAnswers);
      if (prompt) void runResolve(prompt, newAnswers);
    } else {
      setClarifyAnswers(newAnswers);
      setClarifyStepIndex(nextIndex);
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
      setPickerOpen(true);
      return;
    }
    if (trimmed === "/music") {
      setInput("");
      setBackendPickerOpen(true);
      return;
    }
    if (trimmed === "/login") {
      setInput("");
      await runLoginAndResume(null);
      return;
    }
    if (trimmed === "/clientid") {
      setInput("");
      setClientIdText("");
      setClientIdError(undefined);
      setClientIdOpen(true);
      return;
    }
    if (trimmed === "/effort") {
      setInput("");
      if (config?.defaultProvider === "ollama") {
        setError("effort only applies to the Claude provider");
        return;
      }
      setEffortPickerOpen(true);
      return;
    }
    if (trimmed === "/systemprompt") {
      setInput("");
      setSystemPromptText(config?.customSystemPrompt ?? "");
      setSystemPromptOpen(true);
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
      return;
    }
    if (trimmed === "/memory") {
      setInput("");
      const taste = await loadTaste();
      if (taste.preferences.length === 0 && taste.sessions.length === 0) {
        setMemoryText("taste memory is empty — /like tracks or generate playlists");
        return;
      }
      const last = taste.sessions.at(-1);
      setMemoryText(
        [
          "Preferences:",
          ...(taste.preferences.length ? taste.preferences : ["- (none yet)"]),
          ...(last ? ["", `Last session (${last.header}):`, ...last.lines] : []),
        ].join("\n"),
      );
      return;
    }
    if (trimmed === "/forget") {
      setInput("");
      setForgetOpen(true);
      return;
    }
    if (trimmed === "/quit") process.exit(0);
    if (trimmed === "/random") {
      setInput("");
      if (!config || !provider || loading) return;
      if (isSpotifyBackend && !authedRef.current) {
        setPendingPrompt("__random__");
        setConfirmConnect(true);
        return;
      }
      setHasInteracted(true);
      await runResolve(generateRandomPlaylistUser(), []);
      return;
    }
    if (trimmed.length === 0) {
      if (resolved) await handlePlay();
      return;
    }
    if (!config || !provider || loading) return;
    if (isSpotifyBackend && !authedRef.current) {
      setPendingPrompt(trimmed);
      setConfirmConnect(true);
      return;
    }
    setHasInteracted(true);
    setError(undefined);
    setInput("");
    setElapsed(0);
    setStartTime(Date.now());
    setLoading(true);
    setProgress({ phase: "clarifying" });
    const controller = new AbortController();
    abortRef.current = controller;
    let questions: ClarifyQuestion[] = [];
    try {
      const rec = await clarify(provider, trimmed, controller.signal);
      questions = rec.questions;
    } catch (e) {
      if (
        controller.signal.aborted ||
        (e instanceof Error && e.name === "AbortError")
      ) {
        abortRef.current = null;
        setLoading(false);
        setProgress(null);
        return;
      }
      // Clarify step is best-effort — fall back to generating straight away.
      questions = [];
    }
    abortRef.current = null;
    setLoading(false);
    setProgress(null);
    if (questions.length === 0) {
      await runResolve(trimmed, []);
      return;
    }
    setPendingBasePrompt(trimmed);
    setClarifyQuestions(questions);
    setClarifyStepIndex(0);
    setClarifyAnswers([]);
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
      setConfirmConnect(true);
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

  const currentChoice: ModelChoice | undefined = config
    ? config.defaultProvider === "ollama"
      ? { provider: "ollama", ollamaModel: config.ollamaModel }
      : { provider: "claude-cli", claudeModel: config.claudeModel }
    : undefined;

  const columnWidth = Math.min(72, Math.max(40, width - 4));
  // Short terminals can't fit logo + input + slash menu + status bar at once.
  // Shrink the slash menu and drop the logo so the layout never overflows.
  const slashMaxVisible = height >= 20 ? 3 : height >= 15 ? 2 : 1;
  // Input starts vertically centered; after the first search/album request the
  // layout shifts to the usual top-aligned position with results below.
  const centered =
    screen === "main" &&
    !hasInteracted &&
    !pickerOpen &&
    !backendPickerOpen &&
    !clientIdOpen &&
    !effortPickerOpen &&
    !systemPromptOpen;
  // Clarify Q&A gets the same centered treatment as the initial prompt.
  const clarifyActive =
    screen === "main" &&
    !pickerOpen &&
    !backendPickerOpen &&
    !effortPickerOpen &&
    !systemPromptOpen &&
    clarifyQuestions !== null;

  const playingTrack = resolved?.resolved.find((t) => t.uri === currentlyPlayingUri);
  const nowPlaying = playingTrack ? `${playingTrack.artist} – ${playingTrack.title}` : null;
  // Logo only before the first prompt; frees vertical space afterwards. Also
  // hidden on very short terminals so the input and menu stay on screen.
  const showLogo = (screen !== "main" || !hasInteracted) && height >= 12;

  const inputCluster = (
    <>
      <PromptInput
        placeholder="describe an album… (type / for commands)"
        value={input}
        onChange={(v) => {
          setInput(v);
          setSlashIndex(0);
        }}
        onSubmit={handleSubmit}
        focused={
          !confirmConnect &&
          !awaitingConfirm &&
          !clientIdOpen &&
          !effortPickerOpen &&
          !systemPromptOpen
        }
      />
      {slashMenuOpen && (
        <SlashMenu
          commands={slashCommands}
          selectedIndex={slashIndex}
          maxVisible={slashMaxVisible}
          width={columnWidth}
        />
      )}
      {confirmConnect && <ConnectPrompt pendingPrompt={pendingPrompt} />}
      {memoryText !== null && (
        <box
          title="taste memory (esc to close)"
          style={{ border: true, borderColor: theme.muted, flexDirection: "column", paddingLeft: 1, paddingRight: 1 }}
        >
          {memoryText.split("\n").map((line, i) => (
            <text key={`m${i}`} fg={line.endsWith(":") ? theme.accent : theme.fg}>
              {line}
            </text>
          ))}
        </box>
      )}
      {forgetOpen && (
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
          paddingTop: 1,
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
              if (r.musicBackend === "spotify" && !authedRef.current) setConfirmConnect(true);
              setScreen("main");
            }}
          />
        )}

        {screen === "main" && pickerOpen && (
          <ModelPicker
            ollamaModels={ollamaModels}
            focused
            onPick={applyModelChoice}
            current={currentChoice}
            claudeFamilyOpen={claudeFamilyOpen}
            onOpenClaudeFamily={() => setClaudeFamilyOpen(true)}
          />
        )}

        {screen === "main" && backendPickerOpen && config && (
          <MusicBackendPicker
            focused
            current={config.musicBackend}
            onPick={applyBackendChoice}
          />
        )}

        {screen === "main" && effortPickerOpen && config && (
          <EffortPicker
            focused
            current={config.claudeEffort}
            onPick={applyEffortChoice}
          />
        )}

        {screen === "main" && systemPromptOpen && config && (
          <SystemPromptPrompt
            value={systemPromptText}
            onChange={setSystemPromptText}
            onSubmit={applySystemPrompt}
            focused
          />
        )}

        {screen === "main" && clientIdOpen && config && (
          <ClientIdPrompt
            value={clientIdText}
            onChange={(v) => {
              setClientIdText(v);
              setClientIdError(undefined);
            }}
            onSubmit={handleClientIdSubmit}
            error={clientIdError}
            focused
            currentId={config.spotifyClientId}
            isDefault={config.spotifyClientId === DEFAULT_CLIENT_ID}
          />
        )}

        {screen === "main" && !pickerOpen && clarifyQuestions !== null && (
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
          !pickerOpen &&
          !backendPickerOpen &&
          !clientIdOpen &&
          !effortPickerOpen &&
          !systemPromptOpen &&
          clarifyQuestions === null && (
            <>
              {centered && inputCluster}
              {!centered && (
                <>
                  <ResultsList
                    title={
                      resolved
                        ? `${resolved.name} — ${resolved.resolved.length} tracks`
                        : undefined
                    }
                    lines={lines}
                    selectedIndex={selectedIndex}
                    currentlyPlayingUri={currentlyPlayingUri}
                    isPlaying={isPlaying}
                    loading={loading || connecting}
                  />
                  {awaitingConfirm && (
                    <ConfirmActions focused onAction={handleConfirmAction} />
                  )}
                  {inputCluster}
                </>
              )}
              {nowPlaying && !loading && !connecting ? (
                <box style={{ height: 1, flexShrink: 0, flexDirection: "row" }}>
                  <text fg={theme.accent}>
                    {" "}
                    {isPlaying ? "▶" : "⏸"} {nowPlaying}
                  </text>
                </box>
              ) : null}
              <StatusBar
                model={modelLabel}
                backend={config?.musicBackend ?? "spotify"}
                authed={isSpotifyBackend ? authed : true}
                loading={loading || connecting}
                error={error}
                progress={progress}
                tokenCount={tokenCount}
                spinnerFrame={spinnerFrame}
                elapsed={elapsed}
                cancelHint={escArmed}
                excludedCount={resolved?.unresolved.length}
              />
            </>
          )}
      </box>
    </box>
  );
}
