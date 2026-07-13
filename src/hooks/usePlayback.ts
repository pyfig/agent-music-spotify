import { useEffect, useRef, useState } from "react";
import type { Config } from "../config";
import { getAccessToken } from "../spotify/auth";
import { SpotifyClient } from "../spotify/client";
import { createMusicProvider } from "../music/factory";
import { player } from "../music/playback";
import type { ResolvedPlaylist } from "../core/generate-playlist";
import type { RemotePlaylist } from "../music/types";
import type { TrackMeta } from "./useLyrics";

/**
 * Now-playing state, the 1.5s playback poll, volume/mute, and play/pause.
 * Also primes the mpv singleton with the persisted volume once config loads.
 */
export function usePlayback(
  config: Config | null,
  deps: {
    authed: boolean;
    authedRef: { current: boolean };
    /** Generation in flight — poll pauses to keep the status row calm. */
    loading: boolean;
    isSpotifyBackend: boolean;
    resolved: ResolvedPlaylist | null;
    selectedIndex: number;
    committedPlaylist: RemotePlaylist | null;
    setError: (msg: string | undefined) => void;
    /** Persist the volume into config (env still wins after save). */
    saveVolume: (pct: number) => Promise<unknown>;
    /** Spotify backend without a token: route into the connect confirm. */
    onNeedsConnect: () => void;
  },
) {
  const [currentlyPlayingUri, setCurrentlyPlayingUri] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  // Track progress (ms); durationMs null = unknown → bar hidden.
  const [trackPos, setTrackPos] = useState<{ positionMs: number; durationMs: number | null } | null>(null);
  const [volume, setVolume] = useState<number | null>(null);
  // Mute state: mutedVolume holds the pre-mute level so a second M restores it.
  const [mutedVolume, setMutedVolume] = useState<number | null>(null);
  /** Anchor for position interpolation: updated on each 1.5s poll. */
  const lyricsAnchorRef = useRef<{ positionMs: number; wallClock: number; isPlaying: boolean } | null>(null);
  /** Current track metadata for lyrics lookup — updated on each poll. */
  const [currentTrackMeta, setCurrentTrackMeta] = useState<TrackMeta>({ uri: null, artist: "", title: "", durationMs: 0 });

  // Local backends: prime the mpv singleton with the persisted volume so the
  // first track plays at the right level. Spotify volume is set per playback
  // action since there's no persistent mpv for it. Once — not on every
  // config save, so a volume drifted via another Spotify client isn't
  // snapped back by an unrelated settings edit.
  const volInitRef = useRef(false);
  useEffect(() => {
    if (!config || volInitRef.current) return;
    volInitRef.current = true;
    setVolume(config.volume);
    player.setInitialVolume(config.volume);
  }, [config]);

  // Poll current playback state (which track is playing / paused):
  // spotify — its Web API /me/player; local backends — the mpv-backed player.
  useEffect(() => {
    if (deps.loading || !config) return;
    const isSpotify = config.musicBackend === "spotify";
    if (isSpotify && !deps.authed) return;
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
  }, [deps.authed, deps.loading, config]);

  // Push a new volume to the active backend and persist it. Spotify routes
  // through its Web API; local backends go through the mpv singleton. The
  // polling effect keeps `volume` in sync if the backend changes it on its
  // side (e.g. another Spotify client).
  async function applyVolume(pct: number) {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    setVolume(clamped);
    await deps.saveVolume(clamped);
    try {
      if (deps.isSpotifyBackend && deps.authedRef.current && config) {
        const token = await getAccessToken(config);
        await new SpotifyClient(token).setVolume(clamped);
      } else {
        await player.setVolume(clamped);
      }
    } catch (e) {
      deps.setError(String(e instanceof Error ? e.message : e));
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

  async function handlePlay() {
    if (!config) return;
    // Local backends: play through mpv, queueing the rest of the list so
    // playback continues past the selected track.
    if (!deps.isSpotifyBackend) {
      const track = deps.resolved?.resolved[deps.selectedIndex];
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
        await player.queue(deps.resolved!.resolved.slice(deps.selectedIndex), music);
        setCurrentlyPlayingUri(track.uri);
        setIsPlaying(true);
      } catch (e) {
        deps.setError(String(e instanceof Error ? e.message : e));
      }
      return;
    }
    if (!deps.authedRef.current) {
      deps.onNeedsConnect();
      return;
    }
    // Selected track plays directly (works before any playlist is committed);
    // fall back to the committed playlist context when nothing is selected.
    const track = deps.resolved?.resolved[deps.selectedIndex];
    const target = track?.uri ?? deps.committedPlaylist?.uri;
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
      deps.setError(String(e instanceof Error ? e.message : e));
    }
  }

  /** /clear and backend switches: drop everything now-playing shows. */
  function resetNowPlaying() {
    setCurrentlyPlayingUri(null);
    setIsPlaying(false);
    setTrackPos(null);
    setCurrentTrackMeta({ uri: null, artist: "", title: "", durationMs: 0 });
    lyricsAnchorRef.current = null;
  }

  return {
    currentlyPlayingUri,
    setCurrentlyPlayingUri,
    isPlaying,
    setIsPlaying,
    trackPos,
    setTrackPos,
    volume,
    mutedVolume,
    currentTrackMeta,
    lyricsAnchorRef,
    applyVolume,
    adjustVolume,
    toggleMute,
    handlePlay,
    resetNowPlaying,
  };
}
