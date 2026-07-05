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

  // Surfaces
  surface1: "#313244", // selected row bg (ResultsList)
} as const;

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
