import { barParts } from "./theme";

/** mm:ss (or h:mm:ss past an hour) for track times. */
export function fmtTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const mmss = `${m}:${String(s).padStart(2, "0")}`;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : mmss;
}

export const TRACK_BAR_WIDTH = 20;

/** Same ━─ glyphs as the volume bar so both bars read as one system. */
export function trackBar(positionMs: number, durationMs: number): { filled: string; rest: string } {
  const ratio = durationMs > 0 ? positionMs / durationMs : 0;
  return barParts(ratio, TRACK_BAR_WIDTH);
}
