import { useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { ResultLine } from "../ui/ResultsList";
import type { SlashCommand } from "../ui/SlashMenu";
import { filterSlashCommands } from "../ui/SlashMenu";
import { replacesMainRegion, type Overlay, type OverlayState } from "./overlay";
import { layoutBudget, type LayoutBudget } from "../ui/layout";
import type { MainScreenProps } from "../ui/MainScreen";
import type { Config } from "../config";
import type { AgentProvider } from "../agent/types";
import type { ResolvedPlaylist } from "../core/generate-playlist";
import type { RemotePlaylist } from "../music/types";
import type { Toast } from "../hooks/useToast";
import type { TrackMeta } from "../hooks/useLyrics";
import type { LyricsResult } from "../lyrics/client";

/**
 * Derived render-state assembly for the main screen. App passes whole hook
 * returns (config/auth/generation/playback/taste/history/lyrics) + the few raw
 * React setters/actions App itself owns (overlay, input, toast,…) and this
 * hook computes all the derived values MainScreen needs: the filtered result
 * lines, slash-menu commands, column width, layout budget, now-playing label,
 * compact/fullscreen lyrics flags. Keeps App free of inline render math so it
 * stays under the ~300-line wiring-only budget.
 *
 * Returns a single flat `MainScreenProps`-shaped object plus the few chrome
 * values App's outer box still needs (showLogo, center/justify, columnWidth).
 */

export interface RenderDeps {
  config: Config | null;
  provider: AgentProvider | null;
  modelLabel: string;
  isSpotifyBackend: boolean;

  // raw chrome state (owned by App)
  overlay: OverlayState;
  setOverlay: Dispatch<SetStateAction<Overlay | null>>;
  input: string;
  setInput: (v: string) => void;
  slashIndex: number;
  setSlashIndex: (v: number | ((i: number) => number)) => void;
  hasInteracted: boolean;
  error: string | undefined;
  toast: Toast | null;

  // lyrics
  lyricsMode: boolean;
  setLyricsMode: (v: boolean) => void;
  lyricsFullScreen: boolean;
  setLyricsFullScreen: (v: boolean) => void;
  lyricsData: LyricsResult | "none" | null;
  interpolatedPosMs: number;
  lyricsCurrentLine: number;

  // auth (for StatusBar + main-region busy)
  authed: boolean;
  connecting: boolean;

  // generation hook (slice we render)
  generation: {
    loading: boolean;
    progress: import("../core/generate-playlist").Progress | null;
    spinnerFrame: number;
    elapsed: number;
    escArmed: boolean;
    events: import("../agent/types").AgentEvent[];
    resolved: ResolvedPlaylist | null;
    awaitingConfirm: boolean;
    selectedIndex: number;
    setSelectedIndex: (v: number | ((i: number) => number)) => void;
    clarifyQuestions: { text: string; options: string[] }[] | null;
    clarifyStepIndex: number;
    clarifyCustomMode: boolean;
    setClarifyCustomMode: (v: boolean) => void;
    clarifyCustomText: string;
    setClarifyCustomText: (v: string) => void;
    advanceClarify: (v: string) => void;
    handleConfirmAction: (action: import("../ui/ConfirmActions").ConfirmAction) => void;
  };

  // playback hook (slice we render)
  playback: {
    currentlyPlayingUri: string | null;
    isPlaying: boolean;
    trackPos: { positionMs: number; durationMs: number | null } | null;
    volume: number | null;
    mutedVolume: number | null;
    currentTrackMeta: TrackMeta;
  };

  // history hook (entries for screen-routing + pick callback)
  history: {
    historyEntries: import("../core/history").HistoryEntry[] | null;
    historyDetail: import("../core/history").HistoryEntry | null;
    setHistoryDetail: (v: import("../core/history").HistoryEntry | null) => void;
    historyScrollRef: { current: ScrollBoxRenderable | null };
  };

  // reasoning scroll handle (App-owned ref the transcript reads into)
  reasoningScrollRef: { current: ScrollBoxRenderable | null };

  // external dimensions
  width: number;
  height: number;

  // odds and ends App owns / config owns that MainScreen reads verbatim
  ollamaModels: string[];
  pendingPrompt: string | null;

  // the app-facing wiring actions (from src/app/actions.ts) MainScreen invokes
  actions: {
    onInputSubmit: (v: string) => void;
    onUseProvider: (provider: string, opts?: { closePicker?: boolean }) => Promise<string | null>;
    onSaveField: (partial: import("../config").FileConfig) => Promise<void> | void;
    applyBackendChoice: (backend: import("../music/types").MusicBackend) => Promise<void>;
    applyEffortChoice: (effort: string) => Promise<void>;
    applySystemPrompt: (value: string) => Promise<void>;
    handleClientIdSubmit: (value: string) => Promise<void>;
  };
}

export interface RenderOut {
  props: MainScreenProps;
  columnWidth: number;
  showLogo: boolean;
  centered: boolean;
  clarifyActive: boolean;
  justify: "center" | "flex-start";
}

export function useMainScreenRender(d: RenderDeps): RenderOut {
  const {
    config,
    overlay,
    hasInteracted,
    history: historySlice,
    generation: gen,
    playback: pb,
    authed,
    connecting,
    modelLabel,
    isSpotifyBackend,
    toast,
    error,
    actions,
    setOverlay,
    input,
    setInput,
    slashIndex,
    setSlashIndex,
    lyricsMode,
    setLyricsMode,
    lyricsFullScreen,
    setLyricsFullScreen,
    lyricsData,
    interpolatedPosMs,
    lyricsCurrentLine,
    reasoningScrollRef,
    width,
    height,
  } = d;

  // Drop duplicates where SoundCloud/YT titles re-embed the artist. Mirrors
  // the inline map that lived in App before the refactor.
  const lines: ResultLine[] = useMemo(() => {
    if (!gen.resolved) return [];
    return gen.resolved.resolved.map((t, i) => {
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
  }, [gen.resolved]);

  const slashCommands: SlashCommand[] = useMemo(
    () => (input.trimStart().startsWith("/") ? filterSlashCommands(input) : []),
    [input],
  );
  const slashMenuOpen =
    d.config !== null &&
    !replacesMainRegion(overlay) &&
    historySlice.historyEntries === null &&
    slashCommands.length > 0;

  const columnWidth = Math.min(72, Math.max(40, width - 4));
  const centered = !hasInteracted && !replacesMainRegion(overlay) && historySlice.historyEntries === null;
  const clarifyActive = !replacesMainRegion(overlay) && gen.clarifyQuestions !== null;

  const playingTrackIndex =
    gen.resolved?.resolved.findIndex((t) => t.uri === pb.currentlyPlayingUri) ?? -1;
  const playingTrack = playingTrackIndex >= 0 ? gen.resolved!.resolved[playingTrackIndex] : undefined;
  const playingPosition =
    playingTrackIndex >= 0 && gen.resolved ? `${playingTrackIndex + 1}/${gen.resolved.resolved.length}` : null;
  const nowPlaying = playingTrack ? `${playingTrack.artist} – ${playingTrack.title}` : null;
  const trackDurationMs = pb.trackPos?.durationMs ?? playingTrack?.durationMs ?? null;
  const lyricsResult = lyricsData !== null && lyricsData !== "none" ? lyricsData : null;
  const hasSyncedLyrics = !!lyricsResult?.synced?.length;
  const busy = gen.loading || connecting;
  const showCompactLyrics = !lyricsFullScreen && hasSyncedLyrics && nowPlaying !== null && !busy;
  const fullscreenLyricsActive = lyricsFullScreen && lyricsResult !== null;

  const budget: LayoutBudget = layoutBudget(height, {
    awaitingConfirm: gen.awaitingConfirm,
    nowPlaying: nowPlaying !== null && !busy,
    toast: toast !== null && !busy,
    slashOpen: slashMenuOpen,
    lyricsPanel: showCompactLyrics,
  });
  const showLogo = !hasInteracted && budget.logoFits;
  const justify: "center" | "flex-start" = centered || clarifyActive ? "center" : "flex-start";

  const props: MainScreenProps = {
    config,
    overlay,
    setOverlay,
    columnWidth,
    budget,
    centered,
    fullscreenLyricsActive,
    lyricsFullScreen,
    showCompactLyrics,
    lyricsResult,
    lyricsCurrentLine,
    interpolatedPosMs,
    ollamaModels: d.ollamaModels,
    onUseProvider: actions.onUseProvider,
    onSaveField: actions.onSaveField,
    applyBackendChoice: actions.applyBackendChoice,
    applyEffortChoice: actions.applyEffortChoice,
    applySystemPrompt: actions.applySystemPrompt,
    handleClientIdSubmit: actions.handleClientIdSubmit,
    historyEntries: historySlice.historyEntries,
    historyDetail: historySlice.historyDetail,
    setHistoryDetail: historySlice.setHistoryDetail,
    historyScrollRef: historySlice.historyScrollRef,
    clarifyQuestions: gen.clarifyQuestions,
    clarifyStepIndex: gen.clarifyStepIndex,
    clarifyCustomMode: gen.clarifyCustomMode,
    clarifyCustomText: gen.clarifyCustomText,
    setClarifyCustomMode: gen.setClarifyCustomMode,
    setClarifyCustomText: gen.setClarifyCustomText,
    advanceClarify: gen.advanceClarify,
    lines,
    resolved: gen.resolved,
    selectedIndex: gen.selectedIndex,
    events: gen.events,
    spinnerFrame: gen.spinnerFrame,
    reasoningScrollRef,
    busy,
    awaitingConfirm: gen.awaitingConfirm,
    onConfirmAction: gen.handleConfirmAction,
    isSpotifyBackend,
    input,
    setInput,
    setSlashIndex,
    onInputSubmit: actions.onInputSubmit,
    pendingPrompt: d.pendingPrompt,
    slashMenuOpen,
    slashCommands,
    slashIndex,
    currentlyPlayingUri: pb.currentlyPlayingUri,
    isPlaying: pb.isPlaying,
    nowPlaying,
    playingPosition,
    trackPos: pb.trackPos,
    trackDurationMs,
    toast,
    model: modelLabel,
    authed,
    error,
    progress: gen.progress,
    elapsed: gen.elapsed,
    escArmed: gen.escArmed,
    volume: pb.volume,
    muted: pb.mutedVolume !== null,
  };

  return { props, columnWidth, showLogo, centered, clarifyActive, justify };
}