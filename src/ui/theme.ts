// Catppuccin Mocha — единый источник истины для всех цветов UI.
// Никакой компонент не должен использовать inline-hex или именованные цвета
// (cyan/gray/etc) — только токены отсюда.
export const theme = {
  // Foreground
  fg: "#cdd6f4", // text
  subtext: "#a6adc8", // subtext0
  muted: "#585b70", // overlay2

  // Accents
  accent: "#1DB954", // blue — brand / selected / primary accent
  yellow: "#f9e2af", // pastel yellow — selected text in pickers
  red: "#f38ba8", // errors / "not found" 
  green: "#a6e3a1", // success / "yes" / currently playing
  maroon: "#eba0ac", // excluded count etc.

  // Logo gradient — spotify green → mint, per-character colors for <ascii-font>.
  logoGradient: ["#1DB954", "#3DC468", "#5CCE7D", "#7CD991", "#A6E3A1"],

  // Surfaces
  surface1: "#313244", // selected row bg (ResultsList)
} as const;

// Braille spinner frames — shared by StatusBar and the reasoning transcript
// header so the "thinking" motif stays consistent across the UI.
export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

// LLM-reasoning spinner (thinking/clarifying phases + transcript header).
// Every frame MUST be a single-cell BMP glyph — a wide frame would shift the
// status row as the animation advances.
export const THINKING_SPINNER = ["♪", "♫", "♬", "♩"] as const;

// Единый рендер ━ баров: filled/rest раздельно, чтобы красить их разными
// цветами (accent vs muted) — целиком accent-бар читается как 100% при любом
// реальном значении. Оба сегмента из одного глифа: разный вес (━ vs ─)
// разрывал бар на два визуально несвязанных куска.
export function barParts(ratio: number, width: number): { filled: string; rest: string } {
  const r = Math.max(0, Math.min(1, ratio));
  const n = Math.round(r * width);
  return { filled: "━".repeat(n), rest: "━".repeat(width - n) };
}

// Дисплейная нормализация имени исполнителя: ALL CAPS → Title Case
// («МЭЙБИ БЭЙБИ» → «Мэйби Бэйби»). Только для отображения — данные
// resolve/queue не трогаем. Смешанный регистр и транслит не меняем.
export function displayArtist(s: string): string {
  const hasLetters = /\p{L}/u.test(s);
  const hasLower = /\p{Ll}/u.test(s);
  if (!hasLetters || hasLower) return s;
  // Слово = токен по пробелам, чтобы «IC3PEAK» не дробилось цифрой на два слова.
  return s.replace(/\S+/gu, (w) => w.charAt(0) + w.slice(1).toLocaleLowerCase());
}

// Обрезка длинных лейблов с многоточием вместо flexbox hard-clip посреди
// слова (model id, now-playing).
export function truncateLabel(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

// Готовый пресет для <select> из @opentui/core.
// Важно: никакого чёрного/тёмного фона — фон всегда прозрачный
// (терминальный), подсветка выбранной строки только через fg-акцент.
// Это убирает дефолт OpenTUI (#1a1a1a focused bg, #FFFF00 selected text).
export const selectTheme = {
  backgroundColor: "transparent",
  focusedBackgroundColor: "transparent",
  selectedBackgroundColor: "transparent",
  textColor: theme.fg,
  focusedTextColor: theme.fg,
  selectedTextColor: theme.yellow,
  descriptionColor: theme.subtext,
  selectedDescriptionColor: theme.fg,
} as const;
