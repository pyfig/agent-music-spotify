## 1. Theme constants

- [x] 1.1 Delete `THINKING_SPINNER` from `src/ui/theme.ts` — all phases share the braille `SPINNER` (revert to pre-PR-#16 behavior)
- [x] 1.2 Add `THINKING_VERBS` const to `src/ui/theme.ts`: `["crate digging…", "tuning…", "riffing…", "mixing…", "cueing up…", "sampling…", "vibing…", "reading notes…"]` with a comment stating the ≤14-char cap and 3 s rotation contract

## 2. StatusBar label

- [x] 2.1 Add an exported `thinkingVerb(elapsed: number): string` helper in `src/ui/StatusBar.tsx` implementing `THINKING_VERBS[Math.floor(elapsed / 3) % THINKING_VERBS.length]` (export-for-tests pattern)
- [x] 2.2 Thread `elapsed` into `progressLabel` and return `thinkingVerb(elapsed)` for both `thinking` and `clarifying` phases, dropping the `n=<tokenCount>` suffix; leave all other phase labels untouched
- [x] 2.3 Remove the now-unused `tokenCount` plumbing end-to-end (`app.tsx` state + `onToken` callback → `StatusBar` prop)
- [x] 2.4 Delete `spinnerGlyph`; StatusBar renders `SPINNER[frame % SPINNER.length]` for every phase; `ReasoningTranscript` header switches to `SPINNER`

## 3. Tests

- [x] 3.1 Update `tests/thinking-spinner.test.ts`: drop `THINKING_SPINNER`/`spinnerGlyph` assertions, keep a single-cell check on `SPINNER`
- [x] 3.2 Add verb tests: every `THINKING_VERBS` entry ≤ 14 chars and ends with `…`; `thinkingVerb` returns `verbs[floor(elapsed/3) % len]` across boundary values (0, 2, 3, 24); `thinking`/`clarifying` labels contain no `n=`; `resolving`/`tool`/`creating`/`adding` labels unchanged
- [x] 3.3 Run `bun test` — full suite green

## 4. Verify in app

- [x] 4.1 Drive the TUI (run-music-agent skill) through a generation; confirm braille spinner animates in StatusBar + ReasoningTranscript header, verbs rotate ~every 3 s, and the narrow layout doesn't clip or shift
