import type { KeyEvent, ScrollBoxRenderable } from "@opentui/core";
import type { HistoryEntry } from "../core/history";
import type { ResultLine } from "../ui/ResultsList";
import type { Overlay, OverlayState } from "./overlay";

/**
 * Keyboard routing helpers for the app shell. App keeps the single useKeyboard
 * subscription (opentui gives one global key stream) but the handler body
 * becomes a thin ordered router delegating to these pure functions — one per
 * app mode/region, preserving the original if-chain's guard order exactly.
 *
 * Each helper takes the slice of state+actions it needs via `KeyCtx` and
 * returns void (a return = "handled, stop"). The slices are kept narrow: a
 * helper only reads the fields it owns, so the union ctx type stays the
 * single wiring point.
 */
export interface KeyCtx {
  // overlay confirms (in-cluster)
  pendingPrompt: string | null;
  setOverlay: (o: Overlay | null) => void;
  setPendingPrompt: (v: string | null) => void;
  runLoginAndResume: (resume: string | null) => Promise<void>;
  clearSessions: () => Promise<void>;
  clearAll: () => Promise<void>;

  // history screen (list + detail)
  historyDetail: HistoryEntry | null;
  historyScrollRef: { current: ScrollBoxRenderable | null };
  setHistoryDetail: (v: HistoryEntry | null) => void;
  setHistoryEntries: (v: HistoryEntry[] | null) => void;
  resolveHistoryEntry: (e: HistoryEntry) => void;
  show: (msg: string) => void;
  setError: (msg: string | undefined) => void;

  // lyrics fullscreen / clarify / confirm
  setLyricsFullScreen: (v: boolean) => void;
  clarifyCustomMode: boolean;
  setClarifyCustomMode: (v: boolean) => void;
  setClarifyCustomText: (v: string) => void;
  cancelClarify: () => void;
  cancelResult: () => void;

  // client-id overlay (Esc + Ctrl+O dashboard)
  openClientIdDashboard: () => void;

  // slash menu
  slashMenuOpen: boolean;
  slashCommands: { cmd: string }[];
  slashIndex: number;
  setInput: (v: string) => void;
  setSlashIndex: (v: number | ((i: number) => number)) => void;

  // main region
  loading: boolean;
  escArmed: boolean;
  armEsc: () => void;
  disarmEsc: () => void;
  cancelInFlight: () => void;
  quickToggleModel: () => Promise<void>;
  adjustVolume: (delta: number) => Promise<void>;
  toggleMute: () => Promise<void>;
  reasoningScrollRef: { current: ScrollBoxRenderable | null };
  lines: ResultLine[];
  setSelectedIndex: (v: number | ((i: number) => number)) => void;
}

/** connect-confirm: y logs in + resumes the stashed prompt; n/Esc cancels. */
export function handleConnectConfirmKey(key: KeyEvent, ctx: KeyCtx): void {
  if (key.name === "y") {
    const resume = ctx.pendingPrompt;
    ctx.setOverlay(null);
    ctx.setPendingPrompt(null);
    void ctx.runLoginAndResume(resume);
    return;
  }
  if (key.name === "n" || key.name === "escape") {
    ctx.setOverlay(null);
    ctx.setPendingPrompt(null);
  }
}

/** forget-confirm: r clears raw sessions, a clears all, Esc/n cancels. */
export async function handleForgetConfirmKey(key: KeyEvent, ctx: KeyCtx): Promise<void> {
  if (key.name === "r") {
    await ctx.clearSessions();
    ctx.setOverlay(null);
    return;
  }
  if (key.name === "a") {
    await ctx.clearAll();
    ctx.setOverlay(null);
    return;
  }
  if (key.name === "escape" || key.name === "n") ctx.setOverlay(null);
}

/** memory view: Esc closes. */
export function handleMemoryKey(key: KeyEvent, ctx: KeyCtx): void {
  if (key.name === "escape") ctx.setOverlay(null);
}

/**
 * /history screen. Detail level: scroll the stored transcript, c/t copy,
 * Esc back to the list, Enter re-resolves. List level: Esc closes.
 */
export async function handleHistoryScreenKey(key: KeyEvent, ctx: KeyCtx): Promise<void> {
  if (ctx.historyDetail) {
    const box = ctx.historyScrollRef.current;
    if (key.name === "up") box?.scrollBy(-1, "step");
    else if (key.name === "down") box?.scrollBy(1, "step");
    else if (key.name === "pageup") box?.scrollBy(-0.5, "viewport");
    else if (key.name === "pagedown") box?.scrollBy(0.5, "viewport");
    else if (key.name === "escape") ctx.setHistoryDetail(null);
    else if (key.name === "return") void ctx.resolveHistoryEntry(ctx.historyDetail);
    else if (key.name === "c" && !key.ctrl) {
      const entry = ctx.historyDetail;
      void copyToClipboard(historyReasoningToText(entry))
        .then(() => ctx.show("copied reasoning"))
        .catch((e) => ctx.setError(String(e instanceof Error ? e.message : e)));
    } else if (key.name === "t" && !key.ctrl) {
      const entry = ctx.historyDetail;
      void copyToClipboard(historyEntryToText(entry))
        .then(() => ctx.show(`copied ${entry.tracks.length} tracks`))
        .catch((e) => ctx.setError(String(e instanceof Error ? e.message : e)));
    }
    return;
  }
  if (key.name === "escape") ctx.setHistoryEntries(null);
}

/** Full-screen lyrics: Esc returns to compact/off. */
export function handleLyricsFullscreenKey(key: KeyEvent, ctx: KeyCtx): void {
  if (key.name === "escape") ctx.setLyricsFullScreen(false);
}

/** Clarify Q&A: custom-mode Esc exits custom only; otherwise Esc cancels. */
export function handleClarifyKey(key: KeyEvent, ctx: KeyCtx): void {
  if (ctx.clarifyCustomMode) {
    if (key.name === "escape") {
      ctx.setClarifyCustomMode(false);
      ctx.setClarifyCustomText("");
    }
    return;
  }
  if (key.name === "escape") ctx.cancelClarify();
}

/** Results confirm: Esc cancels (drops the playlist). */
export function handleConfirmKey(key: KeyEvent, ctx: KeyCtx): void {
  if (key.name === "escape") ctx.cancelResult();
}

/** client-id overlay: Esc closes; Ctrl+O opens the Spotify dashboard. */
export function handleClientIdKey(key: KeyEvent, ctx: KeyCtx): void {
  if (key.name === "escape") ctx.setOverlay(null);
  if (key.ctrl && key.name === "o") ctx.openClientIdDashboard();
}

/**
 * Slash menu navigation while open. Returns true when the key was consumed
 * (Esc clears the query, ↑/↓ move the highlight, Tab completes). The caller
 * falls through to main-region handling when this returns false so volume /
 * Ctrl+B still work while a slash menu is partially typed.
 */
export function handleSlashMenuKey(key: KeyEvent, ctx: KeyCtx): boolean {
  if (key.name === "escape") {
    ctx.setInput("");
    ctx.setSlashIndex(0);
    return true;
  }
  if (key.name === "down") {
    ctx.setSlashIndex((i) => Math.min(i + 1, ctx.slashCommands.length - 1));
    return true;
  }
  if (key.name === "up") {
    ctx.setSlashIndex((i) => Math.max(i - 1, 0));
    return true;
  }
  if (key.name === "tab") {
    const picked = ctx.slashCommands[Math.min(ctx.slashIndex, ctx.slashCommands.length - 1)];
    if (picked) ctx.setInput(picked.cmd);
    return true;
  }
  return false;
}

/**
 * Main-region keys (no overlay/history/clarify/confirm active). Handles:
 * - Escape: double-Esc cancels an in-flight generation (Claude Code style),
 *   single Esc clears the error line.
 * - Ctrl+B: open the backend picker.
 * - Ctrl+P: quick-toggle between ollama and claude-cli.
 * - ←/→: volume ±5 (suppressed while the slash menu is open so those keys
 *   navigate the menu / edit the query).
 * - Ctrl+U: toggle mute.
 * - While loading with no resolved tracks yet: ↑/↓/PageUp/PageDown/Home/End
 *   scroll the reasoning transcript instead of moving an empty selectedIndex.
 * - Otherwise ↑/↓ move the selected track.
 */
export async function handleMainKey(key: KeyEvent, ctx: KeyCtx): Promise<boolean> {
  if (key.name === "escape") {
    if (ctx.loading) {
      if (ctx.escArmed) {
        ctx.disarmEsc();
        ctx.cancelInFlight();
      } else {
        ctx.armEsc();
      }
      return true;
    }
    ctx.setError(undefined);
    return true;
  }
  if (key.ctrl && key.name === "b") {
    ctx.setOverlay({ kind: "backend-picker" });
    return true;
  }
  if (key.ctrl && key.name === "p") {
    await ctx.quickToggleModel();
    return true;
  }
  if (!ctx.slashMenuOpen && key.name === "left") {
    key.stopPropagation();
    key.preventDefault();
    await ctx.adjustVolume(-5);
    return true;
  }
  if (!ctx.slashMenuOpen && key.name === "right") {
    key.stopPropagation();
    key.preventDefault();
    await ctx.adjustVolume(5);
    return true;
  }
  if (key.ctrl && key.name === "u") {
    key.stopPropagation();
    key.preventDefault();
    await ctx.toggleMute();
    return true;
  }
  if (ctx.loading && ctx.lines.length === 0) {
    const box = ctx.reasoningScrollRef.current;
    if (box && scrollReasoningBox(key, box)) return true;
  }
  if (key.name === "down") {
    ctx.setSelectedIndex((i) => Math.min(i + 1, Math.max(ctx.lines.length - 1, 0)));
    return true;
  }
  if (key.name === "up") {
    ctx.setSelectedIndex((i) => Math.max(i - 1, 0));
    return true;
  }
  return false;
}

/** Build the KeyCtx wiring object from hook returns + chrome setters. */
export function buildKeyCtx(p: {
  auth: {
    pendingPrompt: string | null;
    setPendingPrompt: (v: string | null) => void;
  };
  taste: {
    clearSessions: () => Promise<void>;
    clearAll: () => Promise<void>;
  };
  history: {
    historyDetail: HistoryEntry | null;
    historyScrollRef: { current: ScrollBoxRenderable | null };
    setHistoryDetail: (v: HistoryEntry | null) => void;
    setHistoryEntries: (v: HistoryEntry[] | null) => void;
  };
  gen: {
    resolveHistoryEntry: (e: HistoryEntry) => void;
    clarifyCustomMode: boolean;
    setClarifyCustomMode: (v: boolean) => void;
    setClarifyCustomText: (v: string) => void;
    cancelClarify: () => void;
    cancelResult: () => void;
    loading: boolean;
    escArmed: boolean;
    armEsc: () => void;
    disarmEsc: () => void;
    cancelInFlight: () => void;
    setSelectedIndex: (v: number | ((i: number) => number)) => void;
  };
  pb: {
    adjustVolume: (delta: number) => Promise<void>;
    toggleMute: () => Promise<void>;
  };
  actions: {
    runLoginAndResume: (resume: string | null) => Promise<void>;
    openClientIdDashboard: () => void;
    quickToggleModel: () => Promise<void>;
  };
  setOverlay: (o: Overlay | null) => void;
  setLyricsFullScreen: (v: boolean) => void;
  show: (msg: string) => void;
  setError: (msg: string | undefined) => void;
  slashMenuOpen: boolean;
  slashCommands: { cmd: string }[];
  slashIndex: number;
  setInput: (v: string) => void;
  setSlashIndex: (v: number | ((i: number) => number)) => void;
  reasoningScrollRef: { current: ScrollBoxRenderable | null };
  lines: ResultLine[];
}): KeyCtx {
  return {
    pendingPrompt: p.auth.pendingPrompt,
    setOverlay: p.setOverlay,
    setPendingPrompt: p.auth.setPendingPrompt,
    runLoginAndResume: p.actions.runLoginAndResume,
    clearSessions: p.taste.clearSessions,
    clearAll: p.taste.clearAll,
    historyDetail: p.history.historyDetail,
    historyScrollRef: p.history.historyScrollRef,
    setHistoryDetail: p.history.setHistoryDetail,
    setHistoryEntries: p.history.setHistoryEntries,
    resolveHistoryEntry: p.gen.resolveHistoryEntry,
    show: p.show,
    setError: p.setError,
    setLyricsFullScreen: p.setLyricsFullScreen,
    clarifyCustomMode: p.gen.clarifyCustomMode,
    setClarifyCustomMode: p.gen.setClarifyCustomMode,
    setClarifyCustomText: p.gen.setClarifyCustomText,
    cancelClarify: p.gen.cancelClarify,
    cancelResult: p.gen.cancelResult,
    openClientIdDashboard: p.actions.openClientIdDashboard,
    slashMenuOpen: p.slashMenuOpen,
    slashCommands: p.slashCommands,
    slashIndex: p.slashIndex,
    setInput: p.setInput,
    setSlashIndex: p.setSlashIndex,
    loading: p.gen.loading,
    escArmed: p.gen.escArmed,
    armEsc: p.gen.armEsc,
    disarmEsc: p.gen.disarmEsc,
    cancelInFlight: p.gen.cancelInFlight,
    quickToggleModel: p.actions.quickToggleModel,
    adjustVolume: p.pb.adjustVolume,
    toggleMute: p.pb.toggleMute,
    reasoningScrollRef: p.reasoningScrollRef,
    lines: p.lines,
    setSelectedIndex: p.gen.setSelectedIndex,
  };
}

/**
 * Ordered mode router for the single useKeyboard subscription. Guard order
 * matches the pre-refactor if-chain exactly (overlay confirms → history →
 * lyrics → clarify → confirm → pickers → slash menu → main). One key per
 * region; a return inside a branch means "handled, stop here".
 */
export async function routeAppKey(
  key: KeyEvent,
  mode: {
    screen: string;
    overlay: OverlayState;
    historyOpen: boolean;
    lyricsFullScreen: boolean;
    clarifyActive: boolean;
    awaitingConfirm: boolean;
  },
  ctx: KeyCtx,
): Promise<void> {
  if (key.ctrl && key.name === "c") process.exit(0);
  if (mode.screen !== "main") return;
  if (mode.overlay?.kind === "connect-confirm") return void handleConnectConfirmKey(key, ctx);
  if (mode.overlay?.kind === "forget-confirm") return void handleForgetConfirmKey(key, ctx);
  if (mode.overlay?.kind === "memory") return handleMemoryKey(key, ctx);
  if (mode.historyOpen) return void handleHistoryScreenKey(key, ctx);
  if (mode.lyricsFullScreen) return handleLyricsFullscreenKey(key, ctx);
  if (mode.clarifyActive) return handleClarifyKey(key, ctx);
  if (mode.awaitingConfirm) return handleConfirmKey(key, ctx);
  if (mode.overlay?.kind === "client-id") return handleClientIdKey(key, ctx);
  if (
    mode.overlay?.kind === "effort-picker" ||
    mode.overlay?.kind === "system-prompt" ||
    mode.overlay?.kind === "backend-picker"
  ) {
    if (key.name === "escape") ctx.setOverlay(null);
    return;
  }
  if (mode.overlay?.kind === "model-picker") return; // picker owns its own keys
  if (ctx.slashMenuOpen && handleSlashMenuKey(key, ctx)) return;
  await handleMainKey(key, ctx);
}

/** Reasoning-transcript scroll keys while the agent is still thinking and no
 * resolved tracks exist yet. Returns true when the key was a scroll key.
 * stickyScroll on the box auto-disengages on user scroll-up and re-engages
 * once they reach the tail — scrollBy flips those flags, so no extra
 * bookkeeping is needed here. */
function scrollReasoningBox(key: KeyEvent, box: ScrollBoxRenderable): boolean {
  const stop = () => {
    key.stopPropagation();
    key.preventDefault();
  };
  if (key.name === "up") {
    stop();
    box.scrollBy(-1, "step");
    return true;
  }
  if (key.name === "down") {
    stop();
    box.scrollBy(1, "step");
    return true;
  }
  if (key.name === "pageup") {
    stop();
    box.scrollBy(-0.5, "viewport");
    return true;
  }
  if (key.name === "pagedown") {
    stop();
    box.scrollBy(0.5, "viewport");
    return true;
  }
  if (key.name === "home") {
    stop();
    box.scrollTo(0);
    return true;
  }
  if (key.name === "end") {
    stop();
    box.scrollTo(Number.MAX_SAFE_INTEGER);
    return true;
  }
  return false;
}

// Local imports kept at the bottom to avoid a circular-looking import cycle
// with the UI package (these are pure text helpers, no React).
import { copyToClipboard } from "../core/clipboard";
import { historyEntryToText, historyReasoningToText } from "../core/history";