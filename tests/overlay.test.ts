import { test, expect } from "bun:test";
import {
  blocksPromptFocus,
  replacesMainRegion,
  type Overlay,
  type OverlayState,
} from "../src/app/overlay";

const ALL_KINDS: Overlay[] = [
  { kind: "model-picker" },
  { kind: "backend-picker" },
  { kind: "effort-picker" },
  { kind: "client-id", text: "" },
  { kind: "system-prompt", text: "" },
  { kind: "forget-confirm" },
  { kind: "connect-confirm" },
  { kind: "memory", text: "" },
];

test("no overlay: main region visible, prompt focused", () => {
  const none: OverlayState = null;
  expect(replacesMainRegion(none)).toBe(false);
  expect(blocksPromptFocus(none)).toBe(false);
});

test("main-region overlays match the legacy render-guard list", () => {
  const expected = new Set(["model-picker", "backend-picker", "effort-picker", "system-prompt", "client-id"]);
  for (const o of ALL_KINDS) {
    expect(replacesMainRegion(o)).toBe(expected.has(o.kind));
  }
});

test("focus-blocking overlays match the legacy PromptInput.focused expression", () => {
  // Legacy: focused = !confirmConnect && !clientIdOpen && !effortPickerOpen && !systemPromptOpen
  const expected = new Set(["connect-confirm", "client-id", "effort-picker", "system-prompt"]);
  for (const o of ALL_KINDS) {
    expect(blocksPromptFocus(o)).toBe(expected.has(o.kind));
  }
});

test("in-cluster overlays (memory, forget-confirm) neither replace main region nor steal focus", () => {
  for (const kind of ["memory", "forget-confirm"] as const) {
    const o = ALL_KINDS.find((x) => x.kind === kind)!;
    expect(replacesMainRegion(o)).toBe(false);
    expect(blocksPromptFocus(o)).toBe(false);
  }
});
