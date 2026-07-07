import type { ClarifyAnswer } from "./prompts";
import { parsePlaylistResponse, type PlaylistRec } from "./parse";
import { dispatchTool, MUSIC_AGENT_TOOLS, type ToolDispatcherDeps } from "./tools";
import type { AgentEvent, AgentProvider, AgentResult, ToolCall } from "./types";

/**
 * The result of running the agent loop to completion: a parsed playlist
 * recommendation (when the model called `finalize_playlist` or it emitted
 * a valid JSON answer) plus any accumulated clarify Q&A for taste logging.
 */
export interface AgentRunResult {
  playlist: PlaylistRec;
  clarifyAnswers: ClarifyAnswer[];
  /** Number of loop iterations executed (1 = single LLM call). */
  iterations: number;
  /** Names of tools invoked, in order (UI telemetry). */
  toolTrace: string[];
}

export interface AgentLoopCallbacks {
  onToolCall?: (call: ToolCall) => void;
  onToolResult?: (name: string, result: unknown) => void;
}

export interface AgentLoopOptions {
  tools?: typeof MUSIC_AGENT_TOOLS;
  deps: ToolDispatcherDeps;
  /** Cap on loop iterations to bound runaway agents. Default 8. */
  maxIterations?: number;
  onToken?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
  onProgress?: (phase: string) => void;
  /** Ordered transcript sink: reasoning deltas + tool calls/results in call
   * order, for the chat-style reasoning view. */
  onEvent?: (e: AgentEvent) => void;
  signal?: AbortSignal;
  callbacks?: AgentLoopCallbacks;
}

/**
 * Default fallback fallback parser: extract a PlaylistRec from a JSON text
 * answer when the model never called `finalize_playlist`.
 */
function fallbackPlaylist(text: string): PlaylistRec {
  return parsePlaylistResponse(text);
}

/**
 * Pull a `PlaylistRec` out of a `finalize_playlist` tool call. `args` may be
 * either already-parsed (provider emitted parsed tool_calls) or a nested
 * JSON-encoded string (some streaming providers only give the accumulated
 * text and the loop re-parses).
 */
function playlistFromFinalizeArgs(args: Record<string, unknown>): PlaylistRec {
  const name = typeof args.name === "string" ? args.name : "";
  const tracksRaw = Array.isArray(args.tracks) ? args.tracks : [];
  const artistsRaw = Array.isArray(args.artists) ? args.artists : [];
  const tracks = tracksRaw
    .filter((t): t is { artist: string; title: string } => {
      const r = t as Record<string, unknown>;
      return typeof r === "object" && r !== null && typeof r.artist === "string" && typeof r.title === "string";
    })
    .map((t) => ({ artist: t.artist, title: t.title }));
  if (name.length === 0 || tracks.length === 0) {
    throw new Error("finalize_playlist call missing 'name' or non-empty 'tracks'");
  }
  const artists: string[] = artistsRaw
    .filter((a): a is string => typeof a === "string")
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
  return { name, tracks, artists };
}

/**
 * Drive the agent: loop `generate → dispatch tools → feed results back` until
 * either `finalize_playlist` is called or a valid JSON text answer arrives with
 * no tool calls. Bounded by `maxIterations`. All tool dispatch goes through
 * `dispatchTool`; `clarify` blocks here awaiting the UI callback.
 */
export async function runAgentLoop(
  provider: AgentProvider,
  system: string,
  user: string,
  opts: AgentLoopOptions,
): Promise<AgentRunResult> {
  const tools = opts.tools ?? MUSIC_AGENT_TOOLS;
  const maxIterations = opts.maxIterations ?? 8;
  const toolTrace: string[] = [];
  const clarifyAnswers: ClarifyAnswer[] = [];
  let lastText = "";
  // Tracks verified against the backend during the run (searchTrack hits,
  // getArtistTopTracks results). Used as a salvage playlist when the model
  // burns the whole budget without calling finalize_playlist.
  const verifiedTracks: { artist: string; title: string }[] = [];
  const noteVerified = (t: unknown) => {
    const r = t as Record<string, unknown> | null;
    if (r && typeof r === "object" && typeof r.artist === "string" && typeof r.title === "string") {
      if (!verifiedTracks.some((v) => v.artist === r.artist && v.title === r.title)) {
        verifiedTracks.push({ artist: r.artist, title: r.title });
      }
    }
  };

  // Reasoning deltas feed both the legacy tail callback and the ordered
  // transcript stream so the chat view keeps thinking in call order.
  const emitReasoning = (delta: string) => {
    opts.onReasoning?.(delta);
    opts.onEvent?.({ kind: "reasoning", delta });
  };

  for (let i = 0; i < maxIterations; i++) {
    opts.signal?.throwIfAborted();
    opts.onProgress?.("thinking");
    const result: AgentResult = await provider.generate(
      system,
      user,
      opts.onToken,
      opts.signal,
      { tools, onReasoning: emitReasoning },
    );
    lastText = result.text;

    const calls = result.toolCalls ?? [];
    if (calls.length === 0) {
      // No tool calls: assume the text answer is the final JSON playlist.
      if (lastText.length === 0) {
        throw new Error("agent ended with no tool calls and no text answer");
      }
      return { playlist: fallbackPlaylist(lastText), clarifyAnswers, iterations: i + 1, toolTrace };
    }

    // Dispatch each tool call; aggregate results into the next user message
    // is the provider's job when it supports multi-turn — but we still run
    // every call locally for side-effects (searchTrack hits the backend).
    // The loop is single-turn-with-tools in the provider's transport layer;
    // multi-turn dispatch is achieved by emitting tool results as a follow-up
    // user turn appended below.
    let finalizeCall: ToolCall | null = null;
    const resultLines: string[] = [];
    for (const call of calls) {
      opts.callbacks?.onToolCall?.(call);
      opts.onEvent?.({ kind: "tool_call", id: call.id, name: call.name, args: call.args });
      toolTrace.push(call.name);
      opts.onProgress?.(`tool:${call.name}`);

      if (call.name === "finalize_playlist") {
        finalizeCall = call;
        // Still record the call but don't dispatch to the backend.
        opts.callbacks?.onToolResult?.(call.name, call.args);
        opts.onEvent?.({ kind: "tool_result", id: call.id, name: call.name, ok: true, result: call.args });
        continue;
      }

      try {
        const result = await dispatchTool(call.name, call.args, opts.deps, opts.signal);
        if (call.name === "searchTrack") noteVerified(result);
        if (call.name === "getArtistTopTracks" && Array.isArray(result)) result.forEach(noteVerified);
        opts.callbacks?.onToolResult?.(call.name, result);
        opts.onEvent?.({ kind: "tool_result", id: call.id, name: call.name, ok: true, result });
        if (call.name === "clarify" && typeof result === "string") {
          // Find the question text from the call args for taste-log replay.
          const q = typeof call.args.question === "string" ? call.args.question : "";
          clarifyAnswers.push({ question: q, answer: result });
        }
        resultLines.push(
          `Tool ${call.name} result (call_id=${call.id}): ${JSON.stringify(result)}`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        opts.callbacks?.onToolResult?.(call.name, { error: msg });
        opts.onEvent?.({ kind: "tool_result", id: call.id, name: call.name, ok: false, result: { error: msg } });
        resultLines.push(
          `Tool ${call.name} error (call_id=${call.id}): ${msg}`,
        );
      }
    }

    if (finalizeCall) {
      const playlist = playlistFromFinalizeArgs(finalizeCall.args);
      return { playlist, clarifyAnswers, iterations: i + 1, toolTrace };
    }

    if (i === maxIterations - 1) {
      // Budget exhausted without finalize_playlist. Rescue ladder — never die
      // with a maxIterations error if any usable playlist can be produced:
      // 1. One extra generate with ONLY finalize_playlist available.
      // 2. Parse a JSON playlist out of the accumulated text.
      // 3. Salvage playlist from tracks verified during the run.
      try {
        opts.onProgress?.("thinking");
        const finalizeOnly = tools.filter((t) => t.name === "finalize_playlist");
        const rescue = await provider.generate(
          system,
          `${user}\n\nYou are out of research budget. Call finalize_playlist NOW with your best tracklist based on everything above. It is the only tool available.`,
          opts.onToken,
          opts.signal,
          { tools: finalizeOnly, onReasoning: emitReasoning },
        );
        const rescueFinalize = (rescue.toolCalls ?? []).find((c) => c.name === "finalize_playlist");
        if (rescueFinalize) {
          toolTrace.push("finalize_playlist");
          opts.onEvent?.({ kind: "tool_call", id: rescueFinalize.id, name: rescueFinalize.name, args: rescueFinalize.args });
          opts.onEvent?.({ kind: "tool_result", id: rescueFinalize.id, name: rescueFinalize.name, ok: true, result: rescueFinalize.args });
          return { playlist: playlistFromFinalizeArgs(rescueFinalize.args), clarifyAnswers, iterations: i + 2, toolTrace };
        }
        if (rescue.text.length > 0) lastText = rescue.text;
      } catch (e) {
        // Abort must still propagate; other rescue failures fall through.
        if (opts.signal?.aborted) throw e;
      }
      if (lastText.length > 0) {
        try {
          return { playlist: fallbackPlaylist(lastText), clarifyAnswers, iterations: i + 1, toolTrace };
        } catch {
          /* fall through to salvage below */
        }
      }
      if (verifiedTracks.length > 0) {
        return {
          playlist: { name: "Playlist", tracks: verifiedTracks, artists: [] },
          clarifyAnswers,
          iterations: i + 1,
          toolTrace,
        };
      }
      throw new Error(
        `agent loop hit maxIterations=${maxIterations} without finalize_playlist; ` +
          `toolTrace=${toolTrace.join("→") || "(none)"}`,
      );
    }

    // Feed the tool results back to the model as a follow-up turn. Providers
    // that don't natively support multi-turn still gain a best-effort signal:
    // we append the result summary to the user prompt and re-generate.
    // The `user` variable is rebound for the next iteration; `system` stays.
    // On the penultimate iteration, stop nudging and demand finalize — models
    // that keep researching otherwise burn the last slot on another tool call
    // and the loop dies with maxIterations exceeded.
    const continuation = i === maxIterations - 2
      ? "FINAL STEP: you MUST call finalize_playlist NOW with your best tracklist. Do not call any other tool."
      : "Now continue. If you have enough information, call finalize_playlist.";
    user = `${user}\n\n[tool results]\n${resultLines.join("\n")}\n\n${continuation}`;
  }

  // Unreachable: the loop either returns or throws above.
  throw new Error("agent loop exited unexpectedly");
}