// Единственный источник правды для вертикального бюджета экрана: сколько строк
// съедают компоненты вокруг ResultsList и какие декоративные элементы прятать
// на низких терминалах. Никакой компонент не считает высоту сам — App вызывает
// layoutBudget и раздаёт числа через props (см. design D1/D2 в
// openspec/changes/small-window-ui-hardening).

/** What is actually rendered below/around the results list right now. */
export interface LayoutFlags {
  /** ConfirmActions menu is up (awaiting add/listen/cancel). */
  awaitingConfirm: boolean;
  /** Now-playing footer row is rendered. */
  nowPlaying: boolean;
  /** Toast row is rendered. */
  toast: boolean;
  /** Slash-command menu is open under the input. */
  slashOpen: boolean;
  /** Compact lyrics panel is visible above the now-playing footer. */
  lyricsPanel: boolean;
}

export interface LayoutBudget {
  /** Top padding of the main column; drops to 0 on very short terminals. */
  paddingTop: 0 | 1;
  /** Height allows the logo (App additionally gates on screen/interaction). */
  logoFits: boolean;
  /** Slash menu rows to show: 3 → 2 → 1 as height shrinks. */
  slashMaxVisible: 1 | 2 | 3;
  /** Cap for the ResultsList container (includes its title row); ≥ 5. */
  resultsMaxHeight: number;
}

// Rows consumed by fixed components. Update alongside the components —
// unit tests in tests/layout.test.ts document each number.
const INPUT_ROWS = 3; // PromptInput bordered box, height: 3
const STATUS_ROWS = 1; // StatusBar, height: 1
const CONFIRM_ROWS = 10; // ConfirmActions: 4 options × 2 + 2 border
const NOW_PLAYING_ROWS = 1;
const TOAST_ROWS = 1;
// SlashMenu: visible rows + 2 border + 1 possible ↑/↓ overflow indicator.
const SLASH_CHROME_ROWS = 3;

/** Minimum ResultsList height — keeps ≥4 track rows + title visible. */
export const MIN_RESULTS_HEIGHT = 5;

/** Logo drops first, below this height (existing threshold, now centralized). */
export const LOGO_MIN_HEIGHT = 12;

/** Rows consumed by the compact lyrics panel. */
export const LYRICS_PANEL_ROWS = 3;

/**
 * Rows a text occupies under greedy word wrap at `width` cols — mirrors
 * opentui's wrapMode="word" closely enough to budget list heights. Needed
 * because the scrollbox renderable always stretches to its height bound, so a
 * short list must get an explicit height (content rows, capped by budget) or
 * a void opens between the last row and whatever renders below the list.
 */
export function wrappedRows(text: string, width: number): number {
  if (width <= 0) return 1;
  let rows = 1;
  let col = 0;
  for (const word of text.split(/\s+/)) {
    let len = word.length;
    if (len === 0) continue;
    const need = col === 0 ? len : len + 1;
    if (col + need <= width) {
      col += need;
      continue;
    }
    // Wrap to a fresh row (unless already at line start), then hard-break
    // words wider than the line across full rows.
    if (col > 0) rows++;
    while (len > width) {
      rows++;
      len -= width;
    }
    col = len;
  }
  return rows;
}

export function layoutBudget(height: number, flags: LayoutFlags): LayoutBudget {
  // Degradation order (spec responsive-tui-layout): logo first, then slash
  // rows, then vertical padding — functional rows stay to the end.
  const logoFits = height >= LOGO_MIN_HEIGHT;
  const slashMaxVisible: 1 | 2 | 3 = height >= 20 ? 3 : height >= 15 ? 2 : 1;
  const paddingTop: 0 | 1 = height >= LOGO_MIN_HEIGHT ? 1 : 0;

  const consumed =
    paddingTop +
    INPUT_ROWS +
    STATUS_ROWS +
    (flags.awaitingConfirm ? CONFIRM_ROWS : 0) +
    (flags.nowPlaying ? NOW_PLAYING_ROWS : 0) +
    (flags.toast ? TOAST_ROWS : 0) +
    (flags.slashOpen ? slashMaxVisible + SLASH_CHROME_ROWS : 0);

  // Lyrics panel is lowest priority — hide it first if space is tight.
  // Check if consuming lyrics rows drops results below the floor.
  const lyricsConsumed = flags.lyricsPanel ? LYRICS_PANEL_ROWS : 0;
  const baseResults = height - consumed;
  const lyricsFits = baseResults - lyricsConsumed >= MIN_RESULTS_HEIGHT;

  return {
    paddingTop,
    logoFits,
    slashMaxVisible,
    resultsMaxHeight: Math.max(MIN_RESULTS_HEIGHT, baseResults - (lyricsFits ? lyricsConsumed : 0)),
  };
}
