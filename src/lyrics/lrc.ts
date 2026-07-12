export interface LrcLine {
  timeMs: number;
  text: string;
}

const LRC_LINE_RE = /^\[(\d{1,3}):(\d{2})\.(\d{2,3})\]\s*(.*?)\s*$/;
const TAG_RE = /^\[(ti|ar|al|by|offset|re|ve|la):.*\]$/;

export function parseLrc(input: string): LrcLine[] {
  const lines: LrcLine[] = [];
  for (const raw of input.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (TAG_RE.test(line)) continue;
    const m = LRC_LINE_RE.exec(line);
    if (!m) continue;
    const minutes = Number(m[1]!);
    const seconds = Number(m[2]!);
    let centiseconds = Number(m[3]!);
    if (m[3]!.length === 2) centiseconds *= 10;
    const timeMs = minutes * 60_000 + seconds * 1000 + centiseconds;
    const text = m[4]!.trim();
    if (!text) continue;
    lines.push({ timeMs, text });
  }
  lines.sort((a, b) => a.timeMs - b.timeMs);
  return lines;
}

export function currentLineIndex(lines: LrcLine[], positionMs: number): number {
  if (lines.length === 0) return -1;
  if (positionMs < lines[0]!.timeMs) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (lines[mid]!.timeMs <= positionMs) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}
