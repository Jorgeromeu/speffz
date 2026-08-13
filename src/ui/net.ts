// Reusable unfolded-cross face-net selector. The original had two
// hand-duplicated copies of this exact grid — "chips" (single-select, learn
// mode / l2s face-narrowing) and "onlyNet" (multi-select pool filter, see
// CLAUDE.md "Face pool filter"). This is the one component both should use.
import { FACES, KEYS, type FaceKey } from "../cube/faces";

const GRID: Readonly<Record<FaceKey, readonly [number, number]>> = {
  U: [1, 2], L: [2, 1], Fr: [2, 2], R: [2, 3], B: [2, 4], D: [3, 2],
};
const RADIUS: Readonly<Record<FaceKey, string>> = {
  U: "7px 7px 0 0", L: "7px 0 0 7px", Fr: "0", R: "0", B: "0 7px 7px 0", D: "0 0 7px 7px",
};

export type NetMode = "single" | "multi";

export interface NetOptions {
  /** square size of one face button, px. The legend's net is compact
   *  because it sits beside the reference rows; a net inside a tap-driven
   *  dropdown wants the ≥34px the touch-target rule asks for. */
  readonly cell?: number;
}

export interface Net {
  readonly element: HTMLElement;
  /** 0-1 faces in single mode, any subset in multi mode — all-selected in
   *  multi mode conventionally means "no filter" */
  getSelection(): ReadonlySet<FaceKey>;
  setSelection(faces: ReadonlySet<FaceKey>): void;
  onChange(cb: (selection: ReadonlySet<FaceKey>) => void): void;
  /** while disabled, taps have no effect at all — not even a visual one.
   *  Used once a quiz question is answered but not yet advanced, so
   *  changing the face filter can't retroactively affect a resolved
   *  question (matches the original's chip click guard). */
  setDisabled(disabled: boolean): void;
}

/**
 * The tap rule, pulled out of the click handler so it can be tested without
 * a DOM (docs/CONVENTIONS.md calls this rule out as verified by test).
 *
 * single: tapping a face selects it exclusively; tapping the selected face
 * clears it. (learn's face chips, l2s's "narrow to a face")
 *
 * multi: starts with every face selected (= no filter). First tap on a
 * still-unfiltered net solos that face, since training one face is the
 * common case and shouldn't cost every-other-face taps. After that, each
 * tap plain-toggles, and emptying the net restores no-filter rather than
 * leaving an empty pool. (the drill pool filter)
 */
export function nextSelection(mode: NetMode, selected: ReadonlySet<FaceKey>, key: FaceKey): Set<FaceKey> {
  if (mode === "single") return selected.has(key) ? new Set() : new Set([key]);
  if (KEYS.every((k) => selected.has(k))) return new Set([key]);
  const next = new Set(selected);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next.size ? next : new Set(KEYS);
}

export function createNet(mode: NetMode, options: NetOptions = {}): Net {
  const cell = options.cell ?? 30;
  const element = document.createElement("div");
  element.style.display = "grid";
  element.style.gridTemplateColumns = `repeat(4, ${cell}px)`;
  element.style.gridAutoRows = `${cell}px`;
  element.style.gap = "0";

  let selected = new Set<FaceKey>(mode === "multi" ? KEYS : []);
  let disabled = false;
  const buttons = new Map<FaceKey, HTMLButtonElement>();
  const listeners: ((selection: ReadonlySet<FaceKey>) => void)[] = [];

  function sync(): void {
    buttons.forEach((b, key) => {
      const on = selected.has(key);
      b.setAttribute("aria-pressed", String(on));
      b.style.boxShadow = on ? "inset 0 0 0 3px var(--accent)" : "inset 0 0 0 1px rgba(13,16,21,.35)";
      // Multi mode additionally dims the faces that are *out*: it's a pool
      // filter, so "which faces am I being asked about" has to read at a
      // glance, and a 3px ring on six saturated squares doesn't. Single
      // mode keeps every face bright — there, nothing-selected is the
      // resting state and dimming five of six would read as broken.
      b.style.opacity = mode === "multi" && !on ? "0.3" : "1";
    });
  }
  function emit(): void {
    sync();
    listeners.forEach((cb) => cb(new Set(selected)));
  }

  KEYS.forEach((key) => {
    const f = FACES[key];
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = key === "Fr" ? "F" : key;
    b.style.background = f.col;
    b.style.color = f.ink;
    b.style.borderRadius = RADIUS[key];
    b.style.gridRow = String(GRID[key][0]);
    b.style.gridColumn = String(GRID[key][1]);
    b.style.border = "0";
    b.style.minHeight = `${cell}px`;
    b.style.padding = "0";
    b.style.fontSize = "11px";
    b.style.fontWeight = "800";
    b.style.cursor = "pointer";
    b.addEventListener("click", () => {
      if (disabled) return;
      selected = nextSelection(mode, selected, key);
      emit();
    });
    element.appendChild(b);
    buttons.set(key, b);
  });
  sync();

  return {
    element,
    getSelection: () => new Set(selected),
    setSelection: (faces) => {
      selected = new Set(faces);
      sync();
    },
    onChange: (cb) => listeners.push(cb),
    setDisabled: (d) => {
      disabled = d;
    },
  };
}
