import { useEffect, useMemo, useState } from "react";
import { renderDonutFrame } from "./donut";
import { theme } from "./theme";

interface DonutAnimationProps {
  width: number;
  height: number;
  /** Подпись снизу под бубликом (например, текущая фаза генерации). */
  label?: string;
}

// Крутящийся ASCII-бублик. ~30fps (как usleep(30000) в оригинале).
// Цвет — монохром theme.accent, фон прозрачный (терминальный).
export function DonutAnimation({ width, height, label }: DonutAnimationProps) {
  const [A, setA] = useState(0);
  const [B, setB] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setA((a) => a + 0.04);
      setB((b) => b + 0.02);
    }, 33);
    return () => clearInterval(id);
  }, []);

  // Чётные размеры удобнее для центрирования; берём минимум 8×6.
  const w = Math.max(8, Math.floor(width));
  const h = Math.max(6, Math.floor(height) - (label ? 1 : 0));

  const frame = useMemo(
    () => renderDonutFrame(A, B, w, h),
    [A, B, w, h],
  );

  return (
    // Fixed-size block; parent is responsible for centering it on screen.
    // Lines align left: leading spaces from renderDonutFrame already place the
    // sphere at the canvas centre; centering trimmed lines would skew it.
    <box style={{ flexDirection: "column", alignItems: "flex-start" }}>
      {frame.map((line, i) => (
        <text key={i} fg={theme.accent}>{line}</text>
      ))}
      {label ? <text fg={theme.muted}> {label}</text> : null}
    </box>
  );
}