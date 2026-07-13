import { useEffect, useRef, useState } from "react";
import type { AgentEvent, AgentProvider } from "../agent/types";
import type { ClarifyQuestion } from "../agent/parse";
import type { ClarifyAnswer } from "../agent/prompts";
import type { Config } from "../config";
import type { RemotePlaylist } from "../music/types";
import type { HistoryEntry } from "../core/history";
import { createMusicProvider } from "../music/factory";
import { player } from "../music/playback";
import {
  commitPlaylist,
  resolvePlaylist,
  resolveTracks,
  type Progress,
  type ResolvedPlaylist,
} from "../core/generate-playlist";
import { loadTaste, tasteForClarify, tastePromptPrefix } from "../core/taste";
import { reduceEvents } from "../ui/reasoning";
import type { ConfirmAction } from "../ui/ConfirmActions";

/**
 * The generate → clarify → resolve → confirm pipeline state machine. Owns
 * everything between prompt submit and a confirmed/cancelled result: progress,
 * token/spinner/elapsed counters, the reasoning transcript, the resolved list
 * (+ selection), clarify Q&A, double-Esc cancel, and save/commit.
 */
export function useGeneration(
  config: Config | null,
  provider: AgentProvider | null,
  deps: {
    setError: (msg: string | undefined) => void;
    show: (msg: string) => void;
    /** runResolve on spotify implies a valid token was obtained. */
    markAuthed: (v: boolean) => void;
    priorPlaylistRef: { current: string[] | null };
    recordTasteSession: (r: ResolvedPlaylist) => Promise<void>;
    recordHistorySession: (
      prompt: string,
      r: ResolvedPlaylist,
      events: HistoryEntry["events"],
    ) => Promise<void>;
    closeHistory: () => void;
    onInteracted: () => void;
  },
) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [tokenCount, setTokenCount] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [escArmed, setEscArmed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const escTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [resolved, setResolved] = useState<ResolvedPlaylist | null>(null);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [committedPlaylist, setCommittedPlaylist] = useState<RemotePlaylist | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  /** Ordered reasoning/tool transcript, rendered as a chat-style thinking log. */
  const [events, setEvents] = useState<AgentEvent[]>([]);
  // Mirror of `events` readable from runResolve's closure (state var is stale
  // there); used to persist the transcript into session history.
  const eventsRef = useRef<AgentEvent[]>([]);

  const [clarifyQuestions, setClarifyQuestions] = useState<ClarifyQuestion[] | null>(null);
  const [clarifyStepIndex, setClarifyStepIndex] = useState(0);
  const [clarifyAnswers, setClarifyAnswers] = useState<ClarifyAnswer[]>([]);
  const [clarifyCustomMode, setClarifyCustomMode] = useState(false);
  const [clarifyCustomText, setClarifyCustomText] = useState("");
  const [pendingBasePrompt, setPendingBasePrompt] = useState<string | null>(null);
  /** Deferred resolver for the in-loop `clarify` tool: when the agent calls
   * clarify, the loop awaits this promise; we resolve it from `advanceClarify`
   * once the user picks an option / submits a custom answer. */
  const clarifyResolverRef = useRef<((answer: string) => void) | null>(null);

  function disarmEsc() {
    if (escTimerRef.current) clearTimeout(escTimerRef.current);
    escTimerRef.current = null;
    setEscArmed(false);
  }

  /** First Esc while loading: arm the 2s double-Esc window. */
  function armEsc() {
    setEscArmed(true);
    if (escTimerRef.current) clearTimeout(escTimerRef.current);
    escTimerRef.current = setTimeout(() => {
      escTimerRef.current = null;
      setEscArmed(false);
    }, 2000);
  }

  /** Abort the in-flight generation. If the agent loop is parked on the
   * deferred clarify tool call, aborting the controller alone won't unblock
   * it — the loop is awaiting a Promise that only `advanceClarify` resolves.
   * Drain it with an empty answer so dispatchTool returns; the loop's next
   * iteration will see `signal.aborted` and throw, releasing loading. */
  function cancelInFlight() {
    const drain = clarifyResolverRef.current;
    if (drain) {
      clarifyResolverRef.current = null;
      drain("");
    }
    abortRef.current?.abort();
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
    deps.priorPlaylistRef.current = null;
  }

  /** /clear: reset every pipeline-owned piece of session state. Caller is
   * responsible for cancelInFlight() (order: abort → player.stop → resets). */
  function resetSession() {
    setResolved(null);
    setCommittedPlaylist(null);
    setAwaitingConfirm(false);
    setPendingBasePrompt(null);
    setClarifyQuestions(null);
    setClarifyStepIndex(0);
    setClarifyAnswers([]);
    setEvents([]);
    setProgress(null);
    setSelectedIndex(0);
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

  async function runResolve(
    prompt: string,
    qa: ClarifyAnswer[],
  ): Promise<ResolvedPlaylist | null> {
    if (!config || !provider) return null;
    deps.setError(undefined);
    setLoading(true);
    setProgress(null);
    setTokenCount(0);
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
      if (config.musicBackend === "spotify") deps.markAuthed(true);
      const taste = await loadTaste();
      // System-prompt taste prefix carries the full curated+raw digest; the
      // clarify channel carries just artist names grounded in the user's
      // prior taste (decision Q4: only names, not the whole file).
      const tasteFull = tastePromptPrefix(taste) || undefined;
      const tasteArtists = tasteForClarify(taste) || undefined;
      const tasteClarifyChannel = tasteArtists ? `\n\n${tasteArtists}` : "";
      const r = await resolvePlaylist(provider, music, prompt, qa, {
        onProgress: (p) => {
          setProgress(p);
          // Retry after parse-fail restarts the token stream; count only the live attempt.
          if (p.phase === "thinking") setTokenCount(0);
        },
        onToken: (delta) => setTokenCount((n) => n + delta.length),
        onEvent: (e) =>
          setEvents((prev) => {
            const next = reduceEvents(prev, e);
            eventsRef.current = next;
            return next;
          }),
        signal: controller.signal,
        tasteContext: (tasteFull ?? "") + tasteClarifyChannel || undefined,
        priorPlaylistContext: deps.priorPlaylistRef.current ?? undefined,
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
      });
      setResolved(r);
      setCommittedPlaylist(null);
      setAwaitingConfirm(true);
      setSelectedIndex(0);
      // Capture the just-finished playlist as soft seed for the NEXT request.
      // /clear nulls this ref; the next runResolve reads it before overwriting.
      deps.priorPlaylistRef.current = r.resolved.map((t) => `${t.artist} – ${t.title}`);
      void deps.recordTasteSession(r);
      void deps.recordHistorySession(prompt, r, eventsRef.current);
      return r;
    } catch (e) {
      // User-initiated cancel is not an error. But a stuck deferred clarify
      // (cancelled mid-question) must be drained so a future generate call
      // doesn't see a stale resolver. (Cast: TS control-flow pins .current to
      // null from the assignment above; the async callback invalidates that.)
      const drain = clarifyResolverRef.current as ((answer: string) => void) | null;
      if (drain) {
        drain("");
        clarifyResolverRef.current = null;
      }
      if (!(controller.signal.aborted || (e instanceof Error && e.name === "AbortError"))) {
        deps.setError(String(e instanceof Error ? e.message : e));
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

  // /history playback: re-resolve a stored session's tracks against the
  // current backend (stored entries carry no URIs — the backend may have
  // changed since) and load them into the normal resolved list, where the
  // existing playback/save/like flow takes over.
  async function resolveHistoryEntry(entry: HistoryEntry) {
    if (!config || loading) return;
    deps.closeHistory();
    deps.onInteracted();
    deps.setError(undefined);
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
        deps.setError(`no tracks resolved on ${music.name}`);
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
      deps.priorPlaylistRef.current = resolved.map((t) => `${t.artist} – ${t.title}`);
      deps.show(`loaded from history · ${resolved.length} tracks — enter to play`);
    } catch (e) {
      if (!(controller.signal.aborted || (e instanceof Error && e.name === "AbortError"))) {
        deps.setError(String(e instanceof Error ? e.message : e));
      }
    } finally {
      abortRef.current = null;
      disarmEsc();
      setLoading(false);
      setProgress(null);
      setStartTime(null);
    }
  }

  async function savePlaylist() {
    if (!config || !resolved) return;
    deps.setError(undefined);
    try {
      const music = await createMusicProvider(config);
      if (!music.capabilities.remotePlaylists) {
        // No playlists on the service side — the local queue is the playlist.
        await player.queue(resolved.resolved, music);
        setAwaitingConfirm(false);
        deps.show(`queued ${resolved.resolved.length} tracks locally`);
        return;
      }
      deps.markAuthed(true);
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
      deps.show(`saved as playlist · ${playlist.name ?? playlist.uri}`);
    } catch (e) {
      deps.setError(String(e instanceof Error ? e.message : e));
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

  return {
    loading,
    progress,
    tokenCount,
    spinnerFrame,
    elapsed,
    escArmed,
    events,
    eventsRef,
    resolved,
    setResolved,
    awaitingConfirm,
    setAwaitingConfirm,
    committedPlaylist,
    setCommittedPlaylist,
    selectedIndex,
    setSelectedIndex,
    clarifyQuestions,
    clarifyStepIndex,
    clarifyCustomMode,
    setClarifyCustomMode,
    clarifyCustomText,
    setClarifyCustomText,
    pendingBasePrompt,
    disarmEsc,
    armEsc,
    cancelInFlight,
    cancelClarify,
    cancelResult,
    resetSession,
    advanceClarify,
    runResolve,
    resolveHistoryEntry,
    savePlaylist,
    handleConfirmAction,
  };
}
