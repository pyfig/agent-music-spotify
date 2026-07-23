import type { Dispatch, SetStateAction } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { AgentEvent } from "../agent/types";
import type { LyricsResult } from "../lyrics/client";
import type { MusicBackend } from "../music/types";
import type { Progress } from "../core/generate-playlist";
import type { Overlay, OverlayState } from "../app/overlay";
import type { Toast } from "../hooks/useToast";
import { DEFAULT_CLIENT_ID, type Config, type FileConfig } from "../config";
import type { ResolvedPlaylist } from "../core/generate-playlist";
import type { HistoryEntry } from "../core/history";
import { PromptInput } from "./PromptInput";
import { ResultsList, type ResultLine } from "./ResultsList";
import { SlashMenu, type SlashCommand } from "./SlashMenu";
import { ConnectPrompt } from "./ConnectPrompt";
import { ClarifyPrompt } from "./ClarifyPrompt";
import { ConfirmActions, type ConfirmAction } from "./ConfirmActions";
import { StatusBar } from "./StatusBar";
import { LyricsPanel, type LyricsPanelState } from "./LyricsPanel";
import { LyricsScreen } from "./LyricsScreen";
import { HistoryScreen } from "./HistoryScreen";
import { ModelPicker } from "./ModelPicker";
import { MusicBackendPicker } from "./MusicBackendPicker";
import { EffortPicker } from "./EffortPicker";
import { ClientIdPrompt } from "./ClientIdPrompt";
import { SystemPromptPrompt } from "./SystemPromptPrompt";
import { blocksPromptFocus, replacesMainRegion } from "../app/overlay";
import { theme, truncateLabel } from "./theme";
import { fmtTime, trackBar } from "./format";
import { LYRICS_PANEL_ROWS, type LayoutBudget } from "./layout";

export interface MainScreenProps {
  // chrome
  config: Config | null;
  overlay: OverlayState;
  setOverlay: Dispatch<SetStateAction<Overlay | null>>;
  columnWidth: number;
  budget: LayoutBudget;
  centered: boolean;
  fullscreenLyricsActive: boolean;
  lyricsFullScreen: boolean;
  showCompactLyrics: boolean;
  lyricsPanelState: LyricsPanelState;
  lyricsResult: LyricsResult | null;
  lyricsCurrentLine: number;
  interpolatedPosMs: number;

  // provider pickers
  ollamaModels: string[];
  onUseProvider: (provider: string, opts?: { closePicker?: boolean }) => Promise<string | null>;
  onSaveField: (partial: FileConfig) => Promise<void> | void;
  applyBackendChoice: (backend: MusicBackend) => Promise<void>;
  applyEffortChoice: (effort: string) => Promise<void>;
  applySystemPrompt: (value: string) => Promise<void>;
  handleClientIdSubmit: (value: string) => Promise<void>;

  // history screen
  historyEntries: HistoryEntry[] | null;
  historyDetail: HistoryEntry | null;
  setHistoryDetail: (v: HistoryEntry | null) => void;
  historyScrollRef: { current: ScrollBoxRenderable | null };

  // clarify
  clarifyQuestions: { text: string; options: string[] }[] | null;
  clarifyStepIndex: number;
  clarifyCustomMode: boolean;
  clarifyCustomText: string;
  setClarifyCustomMode: (v: boolean) => void;
  setClarifyCustomText: (v: string) => void;
  advanceClarify: (v: string) => void;

  // results / generation
  lines: ResultLine[];
  resolved: ResolvedPlaylist | null;
  selectedIndex: number;
  events: AgentEvent[];
  spinnerFrame: number;
  reasoningScrollRef: { current: ScrollBoxRenderable | null };
  busy: boolean;
  awaitingConfirm: boolean;
  onConfirmAction: (action: ConfirmAction) => void;
  isSpotifyBackend: boolean;

  // prompt input + slash menu
  input: string;
  setInput: (v: string) => void;
  setSlashIndex: (v: number | ((i: number) => number)) => void;
  onInputSubmit: (v: string) => void;
  pendingPrompt: string | null;
  slashMenuOpen: boolean;
  slashCommands: SlashCommand[];
  slashIndex: number;

  // playback footer
  currentlyPlayingUri: string | null;
  isPlaying: boolean;
  nowPlaying: string | null;
  playingPosition: string | null;
  trackPos: { positionMs: number; durationMs: number | null } | null;
  trackDurationMs: number | null;
  toast: Toast | null;

  // status bar
  model: string;
  authed: boolean;
  error?: string;
  progress: Progress | null;
  elapsed: number;
  escArmed: boolean;
  volume: number | null;
  muted: boolean;
}

/**
 * The entire `screen === "main"` render subtree: modal overlays (pickers,
 * prompts, confirms), the full-screen lyrics view, the history browser, the
 * clarify Q&A, and the default results/input/footer layout. Dumb — every
 * value and callback arrives via props; App owns the state and decides when
 * this component renders at all (screen === "main").
 *
 * Mode switching mirrors the original App's render guards verbatim, preserving
 * the same exclusivity (one of these regions is on screen at a time):
 *   overlay replaces main-region → picker alone;
 *   historyEntries !== null → history screen (+ toast row);
 *   clarifyQuestions !== null (and not model-picker) → clarify prompt;
 *   otherwise → results/input/confirm + footer + status bar (with an inline
 *   slot for the full-screen lyrics box when fullscreenLyricsActive).
 */
export function MainScreen(p: MainScreenProps) {
  const overlay: Overlay | null = p.overlay;
  const config = p.config;

  const inputCluster = (
    <>
      <PromptInput
        placeholder="Describe a playlist…  (/ for commands)"
        value={p.input}
        onChange={(v) => {
          p.setInput(v);
          p.setSlashIndex(0);
        }}
        onSubmit={p.onInputSubmit}
        focused={!blocksPromptFocus(overlay) && !p.awaitingConfirm}
      />
      {p.slashMenuOpen && (
        <SlashMenu
          commands={p.slashCommands}
          selectedIndex={p.slashIndex}
          maxVisible={p.budget.slashMaxVisible}
          width={p.columnWidth}
        />
      )}
      {overlay?.kind === "connect-confirm" && <ConnectPrompt pendingPrompt={p.pendingPrompt} />}
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
    <>
      {/* Picker overlays — replace the main region entirely (one at a time). */}
      {config && overlay?.kind === "model-picker" && (
        <ModelPicker
          ollamaModels={p.ollamaModels}
          config={config}
          focused
          onUseProvider={p.onUseProvider}
          onSaveField={p.onSaveField}
          onClose={() => p.setOverlay(null)}
        />
      )}
      {config && overlay?.kind === "backend-picker" && (
        <MusicBackendPicker focused current={config.musicBackend} onPick={p.applyBackendChoice} />
      )}
      {config && overlay?.kind === "effort-picker" && (
        <EffortPicker focused current={config.claudeEffort} onPick={p.applyEffortChoice} />
      )}
      {config && overlay?.kind === "system-prompt" && (
        <SystemPromptPrompt
          value={overlay.text}
          onChange={(v) => p.setOverlay(o => (o?.kind === "system-prompt" ? { ...o, text: v } : o))}
          onSubmit={p.applySystemPrompt}
          focused
        />
      )}
      {config && overlay?.kind === "client-id" && (
        <ClientIdPrompt
          value={overlay.text}
          onChange={(v) => p.setOverlay(o => (o?.kind === "client-id" ? { kind: "client-id", text: v } : o))}
          onSubmit={p.handleClientIdSubmit}
          error={overlay.error}
          focused
          currentId={config.spotifyClientId}
          isDefault={config.spotifyClientId === DEFAULT_CLIENT_ID}
        />
      )}

      {/* Full-screen lyrics view — renders above the main block, which then
          shows only its footer + status bar (the results slot is suppressed
          by the `fullscreenLyricsActive` checks below). */}
      {p.lyricsFullScreen && p.lyricsResult && (
        <LyricsScreen
          lyrics={p.lyricsResult}
          currentLine={p.lyricsCurrentLine}
          interpolatedPosMs={p.interpolatedPosMs}
          maxLines={p.budget.lyricsScreenRows}
        />
      )}

      {/* History browser — owns its own layout; only a toast row rides along
          so copy actions give visible confirmation. */}
      {p.historyEntries !== null && (
        <>
          <HistoryScreen
            entries={p.historyEntries}
            detail={p.historyDetail}
            focused
            onPick={(entry) => p.setHistoryDetail(entry)}
            scrollRef={p.historyScrollRef}
          />
          {p.toast && (
            <box style={{ height: 1, flexShrink: 0, flexDirection: "row" }}>
              <text fg={theme.green}> ✓ {p.toast.msg}</text>
            </box>
          )}
        </>
      )}

      {/* Clarify Q&A — replaces the results region (main block suppressed by
          the `clarifyQuestions === null` guard). Skipped while the model
          picker is open so the picker keeps the screen. */}
      {overlay?.kind !== "model-picker" && p.clarifyQuestions !== null && (
        <ClarifyPrompt
          questionText={p.clarifyQuestions[p.clarifyStepIndex]!.text}
          options={p.clarifyQuestions[p.clarifyStepIndex]!.options}
          stepLabel={`${p.clarifyStepIndex + 1}/${p.clarifyQuestions.length}`}
          focused
          customMode={p.clarifyCustomMode}
          customValue={p.clarifyCustomText}
          onChangeCustom={p.setClarifyCustomText}
          onSubmitCustom={(v) => {
            if (v.trim()) p.advanceClarify(v.trim());
          }}
          onPickOption={p.advanceClarify}
          onPickCustom={() => p.setClarifyCustomMode(true)}
        />
      )}

      {/* Default main region: results, confirm actions, prompt input, lyrics
          panel, now-playing footer, toast, status bar. Suppressed while an
          overlay replaces the region, history is open, or clarify is active. */}
      {!replacesMainRegion(overlay) && p.historyEntries === null && p.clarifyQuestions === null && (
        <>
          {p.centered && !p.fullscreenLyricsActive && inputCluster}
          {!p.centered && !p.fullscreenLyricsActive && (
            <>
              <ResultsList
                title={p.resolved ? p.resolved.name : undefined}
                count={p.resolved ? p.resolved.resolved.length : undefined}
                lines={p.lines}
                selectedIndex={p.selectedIndex}
                currentlyPlayingUri={p.currentlyPlayingUri}
                isPlaying={p.isPlaying}
                loading={p.busy}
                events={p.events}
                spinnerFrame={p.spinnerFrame}
                reasoningScrollRef={p.reasoningScrollRef}
                maxHeight={p.budget.resultsMaxHeight}
                width={p.columnWidth}
              />
              {p.awaitingConfirm && (
                <ConfirmActions
                  focused
                  onAction={p.onConfirmAction}
                  backend={config?.musicBackend}
                  remotePlaylists={p.isSpotifyBackend}
                />
              )}
              {inputCluster}
            </>
          )}
          {p.showCompactLyrics && p.budget.lyricsPanelVisible && (
            <box style={{ height: LYRICS_PANEL_ROWS, flexShrink: 0, flexDirection: "column", alignItems: "center" }}>
              <LyricsPanel state={p.lyricsPanelState} lyrics={p.lyricsResult} currentLine={p.lyricsCurrentLine} />
            </box>
          )}
          {p.nowPlaying && !p.busy ? (
            <box style={{ height: 1, flexShrink: 0, flexDirection: "row" }}>
              <box style={{ flexDirection: "row", flexGrow: 1, flexShrink: 1, overflow: "hidden" }}>
                <text>
                  <span fg={theme.subtext}> {p.isPlaying ? "▶" : "⏸"} </span>
                  {p.playingPosition && <span fg={theme.muted}>{p.playingPosition} </span>}
                  <span fg={theme.muted}>
                    {truncateLabel(
                      p.nowPlaying,
                      Math.max(
                        10,
                        p.columnWidth - (p.trackPos && p.trackDurationMs ? 40 : 5) - (p.playingPosition ? p.playingPosition.length + 1 : 0),
                      ),
                    )}
                  </span>
                </text>
              </box>
              {p.trackPos && p.trackDurationMs ? (
                <text fg={theme.subtext}>
                  {" "}
                  {fmtTime(p.trackPos.positionMs)}{" "}
                  <span fg={theme.accent}>{trackBar(p.trackPos.positionMs, p.trackDurationMs).filled}</span>
                  <span fg={theme.muted}>{trackBar(p.trackPos.positionMs, p.trackDurationMs).rest}</span>{" "}
                  {fmtTime(p.trackDurationMs)}
                </text>
              ) : null}
            </box>
          ) : null}
          {p.toast && !p.busy && !p.fullscreenLyricsActive ? (
            <box style={{ height: 1, flexShrink: 0, flexDirection: "row" }}>
              <text fg={theme.green}> ✓ {p.toast.msg}</text>
            </box>
          ) : null}
          <StatusBar
            model={p.model}
            backend={config?.musicBackend ?? "spotify"}
            authed={p.isSpotifyBackend ? p.authed : true}
            loading={p.busy}
            error={p.error}
            progress={p.progress}
            spinnerFrame={p.spinnerFrame}
            elapsed={p.elapsed}
            cancelHint={p.escArmed}
            excludedCount={p.resolved?.unresolved.length}
            volume={p.volume}
            muted={p.muted}
            width={p.columnWidth}
          />
        </>
      )}
    </>
  );
}