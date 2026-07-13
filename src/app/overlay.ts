/**
 * Single-overlay model for the app shell: every modal chrome surface (pickers,
 * prompts, confirms, memory view) is one discriminated union value. At most
 * one overlay exists at a time — opening another structurally replaces it, so
 * modal exclusivity needs no per-pair boolean checks. Pipeline states
 * (clarify, results-confirm, history screen, fullscreen lyrics) are NOT
 * overlays: they belong to their owning hooks.
 */
export type Overlay =
  | { kind: "model-picker" }
  | { kind: "backend-picker" }
  | { kind: "effort-picker" }
  | { kind: "client-id"; text: string; error?: string }
  | { kind: "system-prompt"; text: string }
  | { kind: "forget-confirm" }
  | { kind: "connect-confirm" }
  | { kind: "memory"; text: string };

export type OverlayState = Overlay | null;

/** Overlays that render INSTEAD of the results/input main region. The rest
 * (connect-confirm, forget-confirm, memory) render inside the input cluster. */
const MAIN_REGION_KINDS: ReadonlySet<Overlay["kind"]> = new Set([
  "model-picker",
  "backend-picker",
  "effort-picker",
  "system-prompt",
  "client-id",
]);

/** Overlays that must steal focus from the prompt input. Mirrors the legacy
 * `focused` prop expression: model/backend pickers and the in-cluster boxes
 * (memory, forget-confirm) never took focus away — pickers replace the input's
 * render region entirely, and the in-cluster boxes are read-only. */
const FOCUS_BLOCKING_KINDS: ReadonlySet<Overlay["kind"]> = new Set([
  "connect-confirm",
  "client-id",
  "effort-picker",
  "system-prompt",
]);

export function replacesMainRegion(o: OverlayState): boolean {
  return o !== null && MAIN_REGION_KINDS.has(o.kind);
}

export function blocksPromptFocus(o: OverlayState): boolean {
  return o !== null && FOCUS_BLOCKING_KINDS.has(o.kind);
}
