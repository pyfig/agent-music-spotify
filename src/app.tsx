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
} from "./spotify/auth";
import { SpotifyClient, type SpotifyPlaylist } from "./spotify/client";
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
import { SlashMenu, filterSlashCommands } from "./ui/SlashMenu";
import { ConnectPrompt } from "./ui/ConnectPrompt";
import { ClarifyPrompt } from "./ui/ClarifyPrompt";
import { ClientIdPrompt } from "./ui/ClientIdPrompt";
import { ConfirmActions, type ConfirmAction } from "./ui/ConfirmActions";
import { theme } from "./ui/theme";

type Screen = "loading" | "wizard" | "main";

export function App() {
  const { width } = useTerminalDimensions();
  const [config, setConfig] = useState<Config | null>(null);
  const [screen, setScreen] = useState<Screen>("loading");
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [clientIdOpen, setClientIdOpen] = useState(false);
  const [clientIdText, setClientIdText] = useState("");
  const [clientIdError, setClientIdError] = useState<string | undefined>(
    undefined,
  );
  const [claudeFamilyOpen, setClaudeFamilyOpen] = useState(false);
  const [input, setInput] = useState("");
  const [authed, setAuthed] = useState(false);
  const authedRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [resolved, setResolved] = useState<ResolvedPlaylist | null>(null);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [committedPlaylist, setCommittedPlaylist] =
    useState<SpotifyPlaylist | null>(null);
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
      if (!a) setConfirmConnect(true);
      setOllamaModels(await listOllamaModels(c.ollamaUrl));
      setScreen(isConfigured(c) ? "main" : "wizard");
    });
  }, []);

  // Poll /me/player for current playback state (which track is playing / paused).
  useEffect(() => {
    if (!authed || loading || !config) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const token = await getAccessToken(config);
        const spotify = new SpotifyClient(token);
        const state = await spotify.getCurrentlyPlaying();
        if (cancelled) return;
        setCurrentlyPlayingUri(state?.uri ?? null);
        setIsPlaying(state?.isPlaying ?? false);
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
    !clientIdOpen &&
    slashCommands.length > 0;

  const provider: AgentProvider | null = useMemo(() => {
    if (!config) return null;
    return config.defaultProvider === "ollama"
      ? new OllamaProvider({ url: config.ollamaUrl, model: config.ollamaModel })
      : new ClaudeCliProvider({ model: config.claudeModel });
  }, [config]);

  const modelLabel = config
    ? config.defaultProvider === "ollama"
      ? `ollama:${config.ollamaModel}`
      : `claude:${config.claudeModel} · effort:low`
    : "";

  const lines: ResultLine[] = useMemo(() => {
    if (!resolved) return [];
    return resolved.resolved.map((t, i) => ({
      key: `r${i}`,
      label: `${t.artist} — ${t.name}`,
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
        Bun.spawn(["open", "https://developer.spotify.com/dashboard"], {
          stdout: "ignore",
          stderr: "ignore",
        });
      }
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
    if (cfg.spotifyClientId.includes("PLACEHOLDER")) {
      setError(
        "built-in client ID not set — edit DEFAULT_CLIENT_ID in src/config.ts",
      );
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
    await runLoginAndResume(null, next);
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
      const token = await getAccessToken(config);
      setAuthed(true);
      const spotify = new SpotifyClient(token);
      const r = await resolvePlaylist(
        provider,
        spotify,
        prompt,
        qa,
        (p) => {
          setProgress(p);
          // Retry after parse-fail restarts the token stream; count only the live attempt.
          if (p.phase === "thinking") setTokenCount(0);
        },
        (delta) => setTokenCount((n) => n + delta.length),
        controller.signal,
      );
      setResolved(r);
      setCommittedPlaylist(null);
      setAwaitingConfirm(true);
      setSelectedIndex(0);
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
      const token = await getAccessToken(config);
      setAuthed(true);
      const spotify = new SpotifyClient(token);
      const playlist = await commitPlaylist(
        spotify,
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
    if (trimmed === "/quit") process.exit(0);
    if (trimmed === "/random") {
      setInput("");
      if (!config || !provider || loading) return;
      if (!authedRef.current) {
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
    if (!authedRef.current) {
      setPendingPrompt(trimmed);
      setConfirmConnect(true);
      return;
    }
    setHasInteracted(true);
    setError(undefined);
    setInput("");
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
      await spotify.play(target);
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
  // Input starts vertically centered; after the first search/album request the
  // layout shifts to the usual top-aligned position with results below.
  const centered =
    screen === "main" && !hasInteracted && !pickerOpen && !clientIdOpen;
  // Clarify Q&A gets the same centered treatment as the initial prompt.
  const clarifyActive =
    screen === "main" && !pickerOpen && clarifyQuestions !== null;
  // Logo only before the first prompt; frees vertical space afterwards.
  const showLogo = screen !== "main" || !hasInteracted;

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
        focused={!confirmConnect && !awaitingConfirm && !clientIdOpen}
      />
      {slashMenuOpen && (
        <SlashMenu commands={slashCommands} selectedIndex={slashIndex} />
      )}
      {confirmConnect && <ConnectPrompt pendingPrompt={pendingPrompt} />}
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
            <ascii-font
              text="music-agent"
              font="tiny"
              style={{ color: theme.accent }}
            />
          </box>
        )}

        {screen === "loading" && <text fg={theme.muted}>loading…</text>}

        {screen === "wizard" && config && (
          <SetupWizard
            ollamaModels={ollamaModels}
            onDone={async (r) => {
              const next = await saveConfig({
                defaultProvider: r.provider,
                ...(r.ollamaModel ? { ollamaModel: r.ollamaModel } : {}),
                ...(r.claudeModel ? { claudeModel: r.claudeModel } : {}),
              });
              setConfig(next);
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
          !clientIdOpen &&
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
              <StatusBar
                model={modelLabel}
                authed={authed}
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
