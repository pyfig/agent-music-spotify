import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useMemo, useRef, useState } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useProvider, modelLabelFor } from "./hooks/useProviders";
import { useLyrics } from "./hooks/useLyrics";
import { checkLocalPlaybackDeps } from "./music/playback";
import { SetupWizard } from "./ui/SetupWizard";
import { filterSlashCommands } from "./ui/SlashMenu";
import { MainScreen } from "./ui/MainScreen";
import { Logo } from "./ui/Logo";
import { theme } from "./ui/theme";
import { useToast } from "./hooks/useToast";
import { useAppConfig } from "./hooks/useAppConfig";
import { useAuthFlow } from "./hooks/useAuthFlow";
import { useGeneration } from "./hooks/useGeneration";
import { useTasteActions } from "./hooks/useTasteActions";
import { useHistoryScreen } from "./hooks/useHistoryScreen";
import { usePlayback } from "./hooks/usePlayback";
import { replacesMainRegion, type OverlayState } from "./app/overlay";
import { useAppActions } from "./app/actions";
import { buildKeyCtx, routeAppKey } from "./app/keyboard";
import { useMainScreenRender } from "./app/render";

/**
 * App shell: hook composition + screen routing + prop wiring only.
 * Domain logic lives in src/hooks/; command/keyboard/render math in src/app/.
 */
export function App() {
  const { width, height } = useTerminalDimensions();
  const [overlay, setOverlay] = useState<OverlayState>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [slashIndex, setSlashIndex] = useState(0);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [lyricsMode, setLyricsMode] = useState(false);
  const [lyricsFullScreen, setLyricsFullScreen] = useState(false);
  const { toast, show } = useToast();
  const reasoningScrollRef = useRef<ScrollBoxRenderable | null>(null);

  const auth = useAuthFlow({
    setError,
    show,
    openClientIdPrompt: () => setOverlay({ kind: "client-id", text: "" }),
  });

  const appConfig = useAppConfig({
    onBooted: (c, a) => {
      auth.markAuthed(a);
      if (c.musicBackend === "spotify") {
        if (!a) setOverlay({ kind: "connect-confirm" });
      } else {
        const depError = checkLocalPlaybackDeps(c.musicBackend);
        if (depError) setError(depError);
      }
    },
  });
  const { config, screen, ollamaModels, setOllamaModels, saveAndSet, onSaveField, finishWizard } =
    appConfig;

  const provider = useProvider(config);
  const modelLabel = modelLabelFor(config);
  const taste = useTasteActions(provider, { show });
  const history = useHistoryScreen(config, provider, { setError });
  const gen = useGeneration(config, provider, {
    setError,
    show,
    markAuthed: auth.markAuthed,
    priorPlaylistRef: taste.priorPlaylistRef,
    recordTasteSession: taste.recordTasteSession,
    recordHistorySession: history.recordHistorySession,
    closeHistory: history.closeHistory,
    onInteracted: () => setHasInteracted(true),
  });

  const isSpotifyBackend =
    config?.musicBackend !== "soundcloud" && config?.musicBackend !== "youtube-music";
  const pb = usePlayback(config, {
    authed: auth.authed,
    authedRef: auth.authedRef,
    loading: gen.loading,
    isSpotifyBackend,
    resolved: gen.resolved,
    selectedIndex: gen.selectedIndex,
    committedPlaylist: gen.committedPlaylist,
    setError,
    saveVolume: (pct) => saveAndSet({ volume: pct }),
    onNeedsConnect: () => setOverlay({ kind: "connect-confirm" }),
  });
  const lyrics = useLyrics(
    lyricsMode,
    pb.currentlyPlayingUri,
    pb.currentTrackMeta,
    pb.lyricsAnchorRef,
  );

  // Slash menu known before actions (handleSubmit picks from it); render recomputes for display.
  const slashCommands = useMemo(
    () => (input.trimStart().startsWith("/") ? filterSlashCommands(input) : []),
    [input],
  );
  const slashMenuOpen =
    screen === "main" &&
    !replacesMainRegion(overlay) &&
    history.historyEntries === null &&
    slashCommands.length > 0;

  const actions = useAppActions({
    config,
    saveAndSet,
    setOllamaModels,
    authedRef: auth.authedRef,
    pendingPrompt: auth.pendingPrompt,
    setPendingPrompt: auth.setPendingPrompt,
    login: auth.login,
    provider,
    loading: gen.loading,
    resolved: gen.resolved,
    committedPlaylist: gen.committedPlaylist,
    runResolve: gen.runResolve,
    savePlaylist: gen.savePlaylist,
    cancelInFlight: gen.cancelInFlight,
    resetSession: gen.resetSession,
    setAwaitingConfirm: gen.setAwaitingConfirm,
    setResolved: gen.setResolved,
    setCommittedPlaylist: gen.setCommittedPlaylist,
    setSelectedIndex: gen.setSelectedIndex,
    currentlyPlayingUri: pb.currentlyPlayingUri,
    selectedIndex: gen.selectedIndex,
    handlePlay: pb.handlePlay,
    resetNowPlaying: pb.resetNowPlaying,
    likeTrack: taste.likeTrack,
    buildMemoryText: taste.buildMemoryText,
    priorPlaylistRef: taste.priorPlaylistRef,
    openHistory: history.openHistory,
    lyricsMode,
    lyricsFullScreen,
    setLyricsMode,
    setLyricsFullScreen,
    clearLyricsCache: lyrics.clearLyricsCache,
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
  });

  const { props, columnWidth, showLogo, justify } = useMainScreenRender({
    config,
    provider,
    modelLabel,
    isSpotifyBackend,
    overlay,
    setOverlay,
    input,
    setInput,
    slashIndex,
    setSlashIndex,
    hasInteracted,
    error,
    toast,
    lyricsMode,
    setLyricsMode,
    lyricsFullScreen,
    setLyricsFullScreen,
    lyricsData: lyrics.lyricsData,
    interpolatedPosMs: lyrics.interpolatedPosMs,
    lyricsCurrentLine: lyrics.lyricsCurrentLine,
    authed: auth.authed,
    connecting: auth.connecting,
    generation: {
      loading: gen.loading,
      progress: gen.progress,
      spinnerFrame: gen.spinnerFrame,
      elapsed: gen.elapsed,
      escArmed: gen.escArmed,
      events: gen.events,
      resolved: gen.resolved,
      awaitingConfirm: gen.awaitingConfirm,
      selectedIndex: gen.selectedIndex,
      setSelectedIndex: gen.setSelectedIndex,
      clarifyQuestions: gen.clarifyQuestions,
      clarifyStepIndex: gen.clarifyStepIndex,
      clarifyCustomMode: gen.clarifyCustomMode,
      setClarifyCustomMode: gen.setClarifyCustomMode,
      clarifyCustomText: gen.clarifyCustomText,
      setClarifyCustomText: gen.setClarifyCustomText,
      advanceClarify: gen.advanceClarify,
      handleConfirmAction: gen.handleConfirmAction,
    },
    playback: {
      currentlyPlayingUri: pb.currentlyPlayingUri,
      isPlaying: pb.isPlaying,
      trackPos: pb.trackPos,
      volume: pb.volume,
      mutedVolume: pb.mutedVolume,
      currentTrackMeta: pb.currentTrackMeta,
    },
    history: {
      historyEntries: history.historyEntries,
      historyDetail: history.historyDetail,
      setHistoryDetail: history.setHistoryDetail,
      historyScrollRef: history.historyScrollRef,
    },
    reasoningScrollRef,
    width,
    height,
    ollamaModels,
    pendingPrompt: auth.pendingPrompt,
    actions: {
      onInputSubmit: actions.handleSubmit,
      onUseProvider: actions.onUseProvider,
      onSaveField,
      applyBackendChoice: actions.applyBackendChoice,
      applyEffortChoice: actions.applyEffortChoice,
      applySystemPrompt: actions.applySystemPrompt,
      handleClientIdSubmit: actions.handleClientIdSubmit,
    },
  });

  const keyCtx = buildKeyCtx({
    auth,
    taste,
    history,
    gen,
    pb,
    actions,
    setOverlay,
    setLyricsFullScreen,
    show,
    setError,
    slashMenuOpen,
    slashCommands,
    slashIndex,
    setInput,
    setSlashIndex,
    reasoningScrollRef,
    lines: props.lines,
  });
  useKeyboard((key) =>
    void routeAppKey(
      key,
      {
        screen,
        overlay,
        historyOpen: history.historyEntries !== null,
        lyricsFullScreen,
        clarifyActive: gen.clarifyQuestions !== null,
        awaitingConfirm: gen.awaitingConfirm,
      },
      keyCtx,
    ),
  );

  return (
    <box style={{ flexGrow: 1, alignItems: "center", flexDirection: "column" }}>
      <box
        style={{
          width: columnWidth,
          flexDirection: "column",
          flexGrow: 1,
          paddingTop: props.budget.paddingTop,
          justifyContent: justify,
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
            onDone={(r) =>
              finishWizard(r, {
                needSpotifyConnect: r.musicBackend === "spotify" && !auth.authedRef.current,
                onNeedConnect: () => setOverlay({ kind: "connect-confirm" }),
              })
            }
          />
        )}
        {screen === "main" && <MainScreen {...props} />}
      </box>
    </box>
  );
}
