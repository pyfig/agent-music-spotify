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
  /** Force this tool on the FIRST iteration only (e.g. clarify for vague
   * requests). Subsequent iterations run unforced; providers without native
   * tool-choice support ignore it. */
  firstTurnToolChoice?: string;
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
 * Stable dedup key for a tool call: name + args JSON with object keys sorted,
 * so `{a,b}` and `{b,a}` collide as intended.
 */
function callKey(name: string, args: Record<string, unknown>): string {
  const sorted = Object.keys(args)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = args[k];
      return acc;
    }, {});
  return `${name}:${JSON.stringify(sorted)}`;
}

const DUPLICATE_CALL_WARNING =
  "[duplicate call — you already called this tool with the same arguments; the result is unchanged and repeated below. Do NOT repeat tool calls; use the results you already have or call finalize_playlist.]";

/** Provider errors worth retrying: rate limits, server errors, network flakes. */
const TRANSIENT_ERROR_RE = /\b(429|5\d\d)\b|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed/i;
/** Backoff schedule between generate retries (a little jitter is added). */
const RETRY_DELAYS_MS = [500, 1500];

/** Abortable sleep: resolves after ms or rejects as soon as the signal fires. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * provider.generate with retry+backoff on transient errors (429/5xx/network),
 * so one rate-limit blip doesn't kill an otherwise healthy run. Abort and
 * non-transient errors rethrow immediately.
 */
async function generateWithRetry(
  provider: AgentProvider,
  system: string,
  user: string,
  onToken: ((delta: string) => void) | undefined,
  signal: AbortSignal | undefined,
  genOpts: Parameters<AgentProvider["generate"]>[4],
): Promise<AgentResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await provider.generate(system, user, onToken, signal, genOpts);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (signal?.aborted || attempt >= RETRY_DELAYS_MS.length || !TRANSIENT_ERROR_RE.test(msg)) {
        throw e;
      }
      await sleep(RETRY_DELAYS_MS[attempt]! + Math.random() * 250, signal);
    }
  }
}

/** Cap on a serialized tool result fed back into the prompt. The UI event
 * stream still gets the full result; only the model-visible line is clipped. */
const MAX_RESULT_CHARS = 2000;

function clipResult(s: string): string {
  return s.length <= MAX_RESULT_CHARS ? s : `${s.slice(0, MAX_RESULT_CHARS)}…[truncated]`;
}

/**
 * Deep-copy a tool result dropping `artwork` keys (long image URLs): they are
 * useless to the model but dominate the byte budget — with them a 15-track
 * top-tracks list gets clipped mid-array and the model guesses at the rest.
 * UI events keep the full result; only the model-visible line is slimmed.
 */
function slimResult(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(slimResult);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === "artwork") continue;
      out[k] = slimResult(val);
    }
    return out;
  }
  return v;
}

/** Accumulated [tool results] blocks larger than this get compacted into a
 * deterministic digest (codex-style /compact, but without an LLM call). */
const COMPACT_THRESHOLD = 12_000;

/** Verified-track target when the request doesn't name a count: once reached,
 * the loop demands finalize instead of nudging "continue". */
const DEFAULT_TARGET_TRACKS = 10;
/** Clarify-only turns extend the research budget, but at most this many times. */
const MAX_CLARIFY_EXTENSIONS = 2;
/** Consecutive progressless turns before the loop demands finalize early. */
const STALL_LIMIT = 2;

/** Requested track count from the prompt (EN+RU), clamped to sanity. */
function targetTrackCount(prompt: string): number {
  const m = prompt.match(/(\d+)\s*(tracks?|songs?|треков|трека|песен|песни)/iu);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 100 ? n : DEFAULT_TARGET_TRACKS;
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
  // Successful tool results keyed by call signature. A repeated identical call
  // is not re-dispatched: the cached result is replayed with a warning so the
  // model stops looping on the same query. clarify/finalize_playlist exempt.
  const seenCalls = new Map<string, unknown>();
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

  // The initial request stays verbatim; per-turn tool-result blocks accumulate
  // separately so they can be compacted once they outgrow the threshold.
  const baseUser = user;
  let blocks: string[] = [];

  // Dynamic budget: starts at maxIterations, extended by clarify-only turns
  // (they gather requirements, not research) up to a hard cap, and effectively
  // shortened by the sufficiency/stall demands below.
  let budget = maxIterations;
  const hardCap = maxIterations + MAX_CLARIFY_EXTENSIONS;
  const target = targetTrackCount(baseUser);
  let stalledTurns = 0;
  // One-shot guard: a finalize_playlist whose tracks are mostly unverified is
  // bounced back once with instructions to verify — hallucinated titles would
  // otherwise silently drop at resolve time and shrink the playlist.
  let finalizeBounced = false;

  for (let i = 0; i < budget; i++) {
    opts.signal?.throwIfAborted();
    opts.onProgress?.("thinking");
    const result: AgentResult = await generateWithRetry(
      provider,
      system,
      user,
      opts.onToken,
      opts.signal,
      {
        tools,
        onReasoning: emitReasoning,
        ...(i === 0 && opts.firstTurnToolChoice
          ? { toolChoice: { name: opts.firstTurnToolChoice } }
          : {}),
      },
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
    const finalizeCall: ToolCall | null = calls.find((c) => c.name === "finalize_playlist") ?? null;
    const resultLines: string[] = [];
    const verifiedBefore = verifiedTracks.length;
    const clarifyBefore = clarifyAnswers.length;

    // Phase 1: announce every call in emitted order (transcript + telemetry).
    const traceStart = toolTrace.length;
    for (const call of calls) {
      opts.callbacks?.onToolCall?.(call);
      opts.onEvent?.({ kind: "tool_call", id: call.id, name: call.name, args: call.args });
      toolTrace.push(call.name);
      opts.onProgress?.(`tool:${call.name}`);
    }

    // Phase 2: dispatch. Independent calls run concurrently; clarify calls are
    // chained (each blocks on the UI, so two in one turn must not overlap);
    // finalize_playlist is captured, never dispatched. Duplicates — cross-turn
    // (seenCalls) or within the batch (inBatch) — reuse the first result.
    type Outcome =
      | { kind: "ok"; result: unknown; duplicate: boolean }
      | { kind: "error"; message: string };
    const outcomes: (Outcome | null)[] = new Array(calls.length).fill(null);
    const inBatch = new Map<string, Promise<Outcome>>();
    let clarifyChain: Promise<unknown> = Promise.resolve();
    const pending: Promise<void>[] = [];

    calls.forEach((call, idx) => {
      if (call.name === "finalize_playlist") return; // captured above, never dispatched
      const key = call.name === "clarify" ? null : callKey(call.name, call.args);
      if (key !== null && seenCalls.has(key)) {
        outcomes[idx] = { kind: "ok", result: seenCalls.get(key), duplicate: true };
        return;
      }
      let p: Promise<Outcome>;
      if (key !== null && inBatch.has(key)) {
        p = inBatch.get(key)!.then((o) => (o.kind === "ok" ? { ...o, duplicate: true } : o));
      } else {
        const dispatch = (): Promise<Outcome> =>
          dispatchTool(call.name, call.args, opts.deps, opts.signal).then(
            (result): Outcome => ({ kind: "ok", result, duplicate: false }),
            (e): Outcome => ({ kind: "error", message: e instanceof Error ? e.message : String(e) }),
          );
        if (call.name === "clarify") {
          p = clarifyChain.then(dispatch);
          clarifyChain = p;
        } else {
          p = dispatch();
          inBatch.set(key!, p);
        }
      }
      pending.push(p.then((o) => void (outcomes[idx] = o)));
    });
    await Promise.all(pending);

    // Phase 3: emit results and prompt lines in the original call order so the
    // transcript stays deterministic regardless of completion order.
    calls.forEach((call, idx) => {
      if (call.name === "finalize_playlist") {
        // Record the call but don't dispatch to the backend.
        opts.callbacks?.onToolResult?.(call.name, call.args);
        opts.onEvent?.({ kind: "tool_result", id: call.id, name: call.name, ok: true, result: call.args });
        return;
      }
      const outcome = outcomes[idx]!;
      if (outcome.kind === "error") {
        opts.callbacks?.onToolResult?.(call.name, { error: outcome.message });
        opts.onEvent?.({ kind: "tool_result", id: call.id, name: call.name, ok: false, result: { error: outcome.message } });
        resultLines.push(`Tool ${call.name} error (call_id=${call.id}): ${clipResult(outcome.message)}`);
        return;
      }
      const { result, duplicate } = outcome;
      opts.callbacks?.onToolResult?.(call.name, result);
      opts.onEvent?.({ kind: "tool_result", id: call.id, name: call.name, ok: true, result });
      if (duplicate) {
        toolTrace[traceStart + idx] = `${call.name} (duplicate)`;
        resultLines.push(
          `Tool ${call.name} result (call_id=${call.id}): ${DUPLICATE_CALL_WARNING} ${clipResult(JSON.stringify(slimResult(result)))}`,
        );
        return;
      }
      const key = call.name === "clarify" ? null : callKey(call.name, call.args);
      if (key !== null) seenCalls.set(key, result);
      if (call.name === "searchTrack") noteVerified(result);
      if (call.name === "getArtistTopTracks" && Array.isArray(result)) result.forEach(noteVerified);
      if (call.name === "clarify" && typeof result === "string") {
        // Find the question text from the call args for taste-log replay.
        const q = typeof call.args.question === "string" ? call.args.question : "";
        clarifyAnswers.push({ question: q, answer: result });
      }
      resultLines.push(
        `Tool ${call.name} result (call_id=${call.id}): ${clipResult(JSON.stringify(slimResult(result)))}`,
      );
    });

    let bouncedThisTurn = false;
    if (finalizeCall) {
      const playlist = playlistFromFinalizeArgs(finalizeCall.args);
      const verifiedSet = new Set(
        verifiedTracks.map((t) => `${t.artist.toLowerCase()}|${t.title.toLowerCase()}`),
      );
      const unverified = playlist.tracks.filter(
        (t) => !verifiedSet.has(`${t.artist.toLowerCase()}|${t.title.toLowerCase()}`),
      );
      const budgetLeft = i < budget - 1;
      // Only bounce substantial lists — the guard targets mass hallucination;
      // a handful of unverified tracks is cheap to resolve/drop downstream.
      if (!finalizeBounced && budgetLeft && playlist.tracks.length >= 5 && unverified.length * 2 > playlist.tracks.length) {
        finalizeBounced = true;
        bouncedThisTurn = true;
        stalledTurns = 0; // explicit new instruction — not a stall
        resultLines.push(
          `[finalize rejected: ${unverified.length} of ${playlist.tracks.length} tracks are unverified and will be dropped if they don't exist. ` +
            `Verify them with searchTrack — batch ALL of them in ONE turn — or replace them with verified tracks, then call finalize_playlist again. ` +
            `Unverified: ${unverified.slice(0, 30).map((t) => `${t.artist} – ${t.title}`).join("; ")}]`,
        );
      } else {
        return { playlist, clarifyAnswers, iterations: i + 1, toolTrace };
      }
    }

    // Clarify-only turn: requirements gathering, not research — give the
    // budget back (bounded by the hard cap) so a forced first-turn clarify
    // doesn't shrink the actual research window.
    if (calls.every((c) => c.name === "clarify") && budget < hardCap) {
      budget++;
    }
    // Progress accounting for stall detection: a turn that verified nothing
    // and answered nothing produced no new information. A bounced finalize is
    // exempt — the model just received an explicit instruction to act on.
    if (bouncedThisTurn) {
      stalledTurns = 0;
    } else if (verifiedTracks.length === verifiedBefore && clarifyAnswers.length === clarifyBefore) {
      stalledTurns++;
    } else {
      stalledTurns = 0;
    }

    if (i === budget - 1) {
      // Budget exhausted without finalize_playlist. Rescue ladder — never die
      // with a maxIterations error if any usable playlist can be produced:
      // 1. One extra generate with ONLY finalize_playlist available.
      // 2. Parse a JSON playlist out of the accumulated text.
      // 3. Salvage playlist from tracks verified during the run.
      try {
        opts.onProgress?.("thinking");
        const finalizeOnly = tools.filter((t) => t.name === "finalize_playlist");
        const rescue = await generateWithRetry(
          provider,
          system,
          `${user}\n\nYou are out of research budget. Call finalize_playlist NOW with your best tracklist based on everything above. It is the only tool available.`,
          opts.onToken,
          opts.signal,
          { tools: finalizeOnly, onReasoning: emitReasoning, toolChoice: { name: "finalize_playlist" } },
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
        `agent loop hit maxIterations (budget=${budget}) without finalize_playlist; ` +
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
    // Demand finalize when the budget is nearly spent, when enough tracks are
    // already verified (sufficiency cut), or when the model has stalled for
    // STALL_LIMIT turns without new information — all three end runs early
    // instead of burning the remaining turns on more research.
    // Demand tiers (observed in real transcripts): the hard "no other tool"
    // text is reserved for the true end of budget — using it for sufficiency
    // or stall made models finalize unverified picks (then bounce) and spend
    // long reasoning arguing with the constraint. Soft demand allows one last
    // verification batch. Anti-restate: without it models re-analyze the whole
    // request from scratch every turn.
    const hardDemand = i === budget - 2;
    const softDemand = verifiedTracks.length >= target || stalledTurns >= STALL_LIMIT;
    const continuation = bouncedThisTurn
      ? "Verify the rejected tracks NOW in ONE batched turn (or swap in verified ones), then call finalize_playlist. Do not restate your analysis of the request."
      : hardDemand
        ? "FINAL STEP: you MUST call finalize_playlist NOW with your best tracklist. Do not call any other tool."
        : softDemand
          ? "You already have enough verified tracks. Call finalize_playlist next — at most ONE final batched verification turn before it if some picks are still unverified. Do not restate your analysis of the request."
          : "Now continue. If you have enough information, call finalize_playlist. Do not restate your analysis of the request — continue from your previous reasoning; only new thoughts.";
    blocks.push(`[tool results]\n${resultLines.join("\n")}`);
    // Compaction: when the accumulated research history outgrows the budget,
    // fold everything but the newest block into a deterministic digest —
    // verified tracks + tools already called + clarify answers cover what the
    // model needs to keep going without re-reading full tool output.
    const historyLen = blocks.reduce((n, b) => n + b.length, 0);
    if (historyLen > COMPACT_THRESHOLD && blocks.length > 1) {
      // The digest itself must stay bounded: cap the track list and clip each
      // line (a pathological backend title must not defeat compaction), and
      // summarize tool usage as name×count instead of the full trace.
      const trackLines = verifiedTracks
        .slice(-100)
        .map((t) => {
          const line = `- ${t.artist} – ${t.title}`;
          return line.length <= 120 ? line : `${line.slice(0, 119)}…`;
        });
      const toolCounts = new Map<string, number>();
      for (const name of toolTrace) toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
      const toolSummary = [...toolCounts.entries()].map(([n, c]) => `${n}×${c}`).join(", ");
      const digest = [
        "[compacted research digest — earlier tool results were summarized]",
        trackLines.length > 0
          ? `Verified tracks so far:\n${trackLines.join("\n")}`
          : "No tracks verified yet.",
        `Tools already called: ${toolSummary}. Do not repeat these calls.`,
        ...(clarifyAnswers.length > 0
          ? [`Clarify answers: ${clarifyAnswers.map((a) => `${a.question} → ${a.answer}`).join("; ")}`]
          : []),
      ].join("\n");
      blocks = [digest, blocks[blocks.length - 1]!];
    }
    user = [baseUser, ...blocks, continuation].join("\n\n");
  }

  // Unreachable: the loop either returns or throws above.
  throw new Error("agent loop exited unexpectedly");
}