import { useEffect, useRef, useState } from "react";
import { LyricsCache, type LyricsResult } from "../lyrics/client";
import { currentLineIndex } from "../lyrics/lrc";

export interface TrackMeta {
  uri: string | null;
  artist: string;
  title: string;
  durationMs: number;
}

export interface LyricsAnchor {
  positionMs: number;
  wallClock: number;
  isPlaying: boolean;
}

export interface UseLyricsResult {
  lyricsData: LyricsResult | "none" | null;
  interpolatedPosMs: number;
  lyricsCurrentLine: number;
  clearLyricsCache: () => void;
}

/**
 * Manages lyrics fetching and synced-line interpolation for the currently
 * playing track. Extracted from App so the effect retry behavior can be
 * unit-tested without mounting the whole TUI.
 */
export function useLyrics(
  lyricsMode: boolean,
  currentlyPlayingUri: string | null,
  currentTrackMeta: TrackMeta,
  anchorRef: React.MutableRefObject<LyricsAnchor | null>,
): UseLyricsResult {
  const [lyricsData, setLyricsData] = useState<LyricsResult | "none" | null>(null);
  const [interpolatedPosMs, setInterpolatedPosMs] = useState(0);
  const [lyricsCurrentLine, setLyricsCurrentLine] = useState(-1);
  const lyricsCacheRef = useRef<LyricsCache>(new LyricsCache());

  // Fetch lyrics when the track changes and metadata is available.
  useEffect(() => {
    if (!lyricsMode || !currentlyPlayingUri) {
      setLyricsData(null);
      return;
    }
    const meta = currentTrackMeta;
    if (meta.uri !== currentlyPlayingUri || !meta.artist || !meta.title) {
      // Metadata not yet available for this URI — will retry when deps update.
      return;
    }
    let cancelled = false;
    const cache = lyricsCacheRef.current;
    const cached = cache.getCached(currentlyPlayingUri);
    if (cached !== undefined) {
      if (cached === "none") setLyricsData("none");
      else setLyricsData(cached);
      return;
    }
    cache.fetch(currentlyPlayingUri, meta.artist, meta.title, meta.durationMs).then((result) => {
      if (!cancelled) setLyricsData(result);
    });
    return () => {
      cancelled = true;
    };
  }, [lyricsMode, currentlyPlayingUri, currentTrackMeta]);

  // 250ms interpolation tick: computes interpolated playback position while
  // synced lyrics exist. Reads the mutable anchor ref each tick so it always
  // uses the latest poll result without restarting the interval.
  useEffect(() => {
    if (!lyricsMode || !lyricsData || lyricsData === "none" || !lyricsData.synced || !lyricsData.synced.length) {
      setInterpolatedPosMs(0);
      setLyricsCurrentLine(-1);
      return;
    }
    const tick = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const pos = anchor.isPlaying
        ? anchor.positionMs + (Date.now() - anchor.wallClock)
        : anchor.positionMs;
      setInterpolatedPosMs(pos);
      setLyricsCurrentLine(currentLineIndex(lyricsData.synced!, pos));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [lyricsMode, lyricsData, anchorRef]);

  return {
    lyricsData,
    interpolatedPosMs,
    lyricsCurrentLine,
    clearLyricsCache: () => lyricsCacheRef.current.clear(),
  };
}
