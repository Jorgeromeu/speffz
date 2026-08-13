// The app's one settings surface: a floating top-right dropdown holding
// every cross-drill control. Replaces the four loose buttons that used to
// sit in #top (corners/edges/arrows/peek) and folds in the face-pool filter
// described in docs/CONVENTIONS.md ("Face pool filter").
//
// Two groups, and the split is load-bearing rather than cosmetic:
//
//   POOL  (corners, edges, faces) — changes *what gets asked*, so the host
//         has to re-ask the current question. Emits onPoolChange.
//   SHOW  (arrows, peek)          — changes *what you see*, repaint only.
//         Emits onDisplayChange.
//
// Conflating those two is what made the old `showKind` do double duty
// (label visibility in learn, question filter everywhere else). Keeping
// them as separate callbacks means neither host handler has to guess.
//
// This component owns no drill vocabulary — it takes a layout describing
// which groups are relevant and reports state back. Deciding that `learn`
// hides the pool net, or that `peek` is quiz-only, stays in main.ts.
import { KEYS, type FaceKey } from "../cube/faces";
import type { Kind } from "../cube/state";
import { isFiltered as filterIsNarrow, poolLetters, type PoolFilter } from "../drills/pool";
import { createNet, type Net } from "./net";

/** Which groups are relevant right now. All-false is legal (hides the
 *  trigger entirely) — the host decides, this component just obeys. */
export interface ControlsLayout {
  /** corners/edges toggles */
  readonly kinds: boolean;
  /** the multi-select face-pool net */
  readonly faces: boolean;
  readonly arrows: boolean;
  readonly peek: boolean;
}

export interface Controls {
  readonly element: HTMLElement;
  /** The pool filter every drill draws its questions through — hand it
   *  straight to freshPool(), which owns the kind × face rule itself. */
  filter(): PoolFilter;
  /** Kind-only visibility, for label painting. Deliberately ignores the
   *  face filter: the pool filter picks what gets *asked*, and dimming
   *  labels on unfiltered faces would silently change learn/peek. */
  showKind(kind: Kind): boolean;
  arrows(): boolean;
  peek(): boolean;
  onPoolChange(cb: () => void): void;
  onDisplayChange(cb: () => void): void;
  setLayout(layout: ControlsLayout): void;
  /** Clear arrows/peek and close the panel, for a tab switch. Deliberately
   *  leaves the pool alone: corners/edges already survived a tab switch
   *  before this component existed, and a face filter is a "what am I
   *  training today" choice that would be infuriating to re-pick every
   *  time you move between s2l and piece. */
  resetDisplay(): void;
  destroy(): void;
}

// Icons lifted verbatim from the old index.html buttons, so the corner /
// edge glyphs stay the ones users already learned to tell apart.
const ICON: Readonly<Record<string, string>> = {
  corners: `<g fill="currentColor"><rect x="2" y="2" width="6" height="6" rx="1.6"/><rect x="16" y="2" width="6" height="6" rx="1.6"/><rect x="2" y="16" width="6" height="6" rx="1.6"/><rect x="16" y="16" width="6" height="6" rx="1.6"/></g>
    <g fill="currentColor" opacity=".22"><rect x="9" y="2" width="6" height="6" rx="1.6"/><rect x="2" y="9" width="6" height="6" rx="1.6"/><rect x="9" y="9" width="6" height="6" rx="1.6"/><rect x="16" y="9" width="6" height="6" rx="1.6"/><rect x="9" y="16" width="6" height="6" rx="1.6"/></g>`,
  edges: `<g fill="currentColor"><rect x="9" y="2" width="6" height="6" rx="1.6"/><rect x="2" y="9" width="6" height="6" rx="1.6"/><rect x="16" y="9" width="6" height="6" rx="1.6"/><rect x="9" y="16" width="6" height="6" rx="1.6"/></g>
    <g fill="currentColor" opacity=".22"><rect x="2" y="2" width="6" height="6" rx="1.6"/><rect x="16" y="2" width="6" height="6" rx="1.6"/><rect x="9" y="9" width="6" height="6" rx="1.6"/><rect x="2" y="16" width="6" height="6" rx="1.6"/><rect x="16" y="16" width="6" height="6" rx="1.6"/></g>`,
  arrows: `<path d="M4 12a8 8 0 1 1 3.2 6.4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M3 6.5 L4.4 12.6 L10.2 10.4 Z" fill="currentColor"/>`,
  peek: `<path d="M1.6 12S5.6 5.2 12 5.2 22.4 12 22.4 12 18.4 18.8 12 18.8 1.6 12 1.6 12Z" fill="none" stroke="currentColor" stroke-width="2.1"/>
    <circle cx="12" cy="12" r="3.1" fill="currentColor"/>`,
  // whole pieces: one selected sticker plus the two it shares a cubie with,
  // drawn in the same solid + ghosted idiom as the corners/edges glyphs
  whole: `<g fill="currentColor"><rect x="2" y="2" width="9" height="9" rx="2"/></g>
    <g fill="currentColor" opacity=".3"><rect x="13" y="2" width="9" height="9" rx="2"/><rect x="2" y="13" width="9" height="9" rx="2"/></g>`,
  // trigger: a funnel, the one icon here that isn't reused from #top
  filter: `<path d="M3 5h18l-7 8v6l-4 2v-8Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`,
};

function svg(name: string, size = 13): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${ICON[name]}</svg>`;
}

function faceLabel(key: FaceKey): string {
  return key === "Fr" ? "F" : key;
}

export function createControls(): Controls {
  let corners = true;
  let edges = true;
  let wholePiece = false;
  let arrows = false;
  let peek = false;
  let pinned = false;
  let layout: ControlsLayout = { kinds: true, faces: true, arrows: true, peek: true };

  const poolListeners: (() => void)[] = [];
  const displayListeners: (() => void)[] = [];

  const element = document.createElement("div");
  element.style.position = "relative";
  element.style.display = "flex";

  // ---- collapsed vs. pinned ----
  // Collapsing is a concession to a phone, not the intended design: the
  // panel is small, and on any screen with room beside the cube it simply
  // stays open, no tap to reach a toggle. Below that it becomes a dropdown.
  // The width floor is the panel's own footprint plus a cube's worth of
  // canvas; the height floor keeps it off the drill chrome on a short
  // laptop window.
  const roomy = window.matchMedia("(min-width: 760px) and (min-height: 560px)");

  // ---- trigger ----
  // The label doubles as a state summary ("edges · F B · peek"). A dropdown
  // that hides an active question-pool filter behind a neutral icon is a
  // trap: you'd wonder why only eight letters ever come up. Summarising on
  // the face of the button — accent-lit exactly when something is non-
  // default — is what makes tucking the panel away safe at all.
  const trigger = document.createElement("button");
  trigger.type = "button";
  // The one button style.css's #top rule targets. Everything inside the
  // panel styles itself, so the compact 30px-tall top-bar look can't leak
  // in and squash the panel's toggles or the net's cells.
  trigger.className = "settings-trigger";
  trigger.setAttribute("aria-haspopup", "true");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", "drill settings");

  const panel = document.createElement("div");
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-label", "drill settings");
  panel.style.position = "absolute";
  panel.style.top = "36px";
  panel.style.right = "0";
  panel.style.display = "none";
  panel.style.flexDirection = "column";
  panel.style.gap = "12px";
  panel.style.padding = "12px";
  panel.style.borderRadius = "var(--radius-lg)";
  panel.style.background = "var(--surface)";
  panel.style.boxShadow = "0 6px 20px rgba(0,0,0,.5)";
  panel.style.zIndex = "6";

  function group(title: string): { wrap: HTMLElement; body: HTMLElement } {
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.gap = "7px";
    const head = document.createElement("div");
    head.textContent = title;
    head.style.fontSize = "9px";
    head.style.letterSpacing = "0.18em";
    head.style.color = "var(--text-faint)";
    const body = document.createElement("div");
    body.style.display = "flex";
    body.style.flexDirection = "column";
    body.style.gap = "7px";
    wrap.append(head, body);
    return { wrap, body };
  }

  // `button { flex: 1 }` in style.css beats an explicit width, so every
  // button in here needs the flex override — same trap letterInput hit.
  function toggle(name: string, label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = `${svg(name)}<span>${label}</span>`;
    b.style.flex = "1 1 0";
    b.style.display = "flex";
    b.style.alignItems = "center";
    b.style.justifyContent = "flex-start";
    b.style.gap = "6px";
    b.style.minHeight = "36px";
    b.style.padding = "0 10px";
    b.style.borderRadius = "var(--radius-md)";
    b.style.fontSize = "10px";
    b.style.whiteSpace = "nowrap";
    b.addEventListener("click", onClick);
    return b;
  }

  function row(...kids: HTMLElement[]): HTMLElement {
    const r = document.createElement("div");
    r.style.display = "flex";
    r.style.gap = "6px";
    r.append(...kids);
    return r;
  }

  // ---- pool group ----
  const poolGroup = group("pool");
  const bCorners = toggle("corners", "corners", () => {
    // Refuse to empty the pool from here. Turning off the last kind would
    // leave every drill with nothing to ask, and the old code's answer was
    // a "turn on corners or edges to start" dead end. Making the last one
    // sticky is a cheaper fix than a state no drill can render.
    if (corners && !edges) return;
    corners = !corners;
    emitPool();
  });
  const bEdges = toggle("edges", "edges", () => {
    if (edges && !corners) return;
    edges = !edges;
    emitPool();
  });
  const kindRow = row(bCorners, bEdges);

  // The generic face selector, in multi mode: first tap solos a face, then
  // plain toggles, and emptying restores no-filter. Same component the
  // legend uses in single mode for a completely different job.
  const net: Net = createNet("multi", { cell: 34 });
  const netWrap = document.createElement("div");
  netWrap.style.display = "flex";
  netWrap.style.justifyContent = "center";
  netWrap.appendChild(net.element);
  net.onChange(() => emitPool());

  /** is the net actually narrowing anything right now */
  function faceFiltered(): boolean {
    const on = net.getSelection();
    return KEYS.some((k) => !on.has(k));
  }

  // Whole-piece mode: the net selects cubies rather than stickers (see
  // PoolFilter.wholePiece). It is inert with every face selected — a piece
  // can't be pulled in by a face that already covered it — so it disables
  // itself there rather than sitting live and doing nothing. Disabled, not
  // hidden: it lives directly under the net and every net tap would
  // otherwise shift the rows below it.
  const bWhole = toggle("whole", "whole pieces", () => {
    if (!faceFiltered()) return;
    wholePiece = !wholePiece;
    emitPool();
  });
  const wholeRow = row(bWhole);

  // The pool, spelled out — because the net can't spell it. Whole-piece mode
  // reaches stickers on faces the net draws as deselected (picking F lights
  // three of U's eight stickers, not U), so no highlight on a six-square net
  // describes the result honestly. Naming the letters is exact, costs one
  // element, and reads the same whatever granularity the net ever grows.
  //
  // Only shown while a face filter is active: unfiltered, this is the whole
  // alphabet twice and the kind toggles already say the rest.
  const poolList = document.createElement("div");
  poolList.style.display = "flex";
  poolList.style.flexDirection = "column";
  poolList.style.gap = "2px";
  poolList.style.maxWidth = "176px";
  poolList.style.fontSize = "10px";
  poolList.style.lineHeight = "1.4";
  poolList.style.letterSpacing = "0.07em";

  function poolRow(label: string, kind: Exclude<Kind, "center">): HTMLElement {
    const { direct, viaPiece } = poolLetters(filter(), kind);
    const r = document.createElement("div");
    const tag = document.createElement("span");
    tag.textContent = label;
    tag.style.color = "var(--text-faint)";
    tag.style.marginRight = "6px";
    const head = document.createElement("span");
    head.textContent = direct;
    head.style.color = "var(--text-bright)";
    r.append(tag, head);
    if (viaPiece) {
      // accent-tinted, so what the toggle just bought you is visible at a
      // glance rather than buried in a longer run of letters
      const extra = document.createElement("span");
      extra.textContent = ` + ${viaPiece}`;
      extra.style.color = "var(--accent)";
      r.appendChild(extra);
    }
    return r;
  }

  poolGroup.body.append(kindRow, netWrap, wholeRow, poolList);

  // ---- show group ----
  const showGroup = group("show");
  const bArrows = toggle("arrows", "arrows", () => {
    arrows = !arrows;
    emitDisplay();
  });
  const bPeek = toggle("peek", "peek", () => {
    peek = !peek;
    emitDisplay();
  });
  const showRow = row(bArrows, bPeek);
  showGroup.body.append(showRow);

  panel.append(poolGroup.wrap, showGroup.wrap);

  function filter(): PoolFilter {
    return { corners, edges, faces: net.getSelection(), wholePiece };
  }

  // What the trigger reports is what the *visible* groups control. A face
  // filter carried over from a drill still applies in learn — but learn
  // hides the net, so advertising a filter the user can neither see nor
  // change there would be noise, and learn asks no questions anyway.
  function visibleFilter(): PoolFilter {
    return {
      corners: layout.kinds ? corners : true,
      edges: layout.kinds ? edges : true,
      faces: layout.faces ? net.getSelection() : new Set(KEYS),
      wholePiece: layout.faces && wholePiece,
    };
  }

  /** every non-default thing the collapsed trigger has to account for, in
   *  the panel's own order: kinds, faces, then the show toggles */
  function activeParts(): string[] {
    const shown = visibleFilter();
    const parts: string[] = [];
    if (shown.corners !== shown.edges) parts.push(shown.corners ? "corners" : "edges");
    const on = KEYS.filter((k) => shown.faces.has(k));
    // "F" vs "F+": the plus is the whole difference between four stickers and
    // twenty, so the collapsed trigger has to carry it for the same reason it
    // carries the face list at all.
    if (on.length !== KEYS.length) {
      parts.push(on.map(faceLabel).join("") + (shown.wholePiece ? "+" : ""));
    }
    // Show toggles belong on the trigger too, not just the pool: peek left
    // on is the difference between practising and reading the answers off
    // the cube, and a collapsed panel is exactly where you'd forget it.
    if (layout.arrows && arrows) parts.push("arrows");
    if (layout.peek && peek) parts.push("peek");
    return parts;
  }

  function sync(): void {
    bCorners.setAttribute("aria-pressed", String(corners));
    bEdges.setAttribute("aria-pressed", String(edges));
    bArrows.setAttribute("aria-pressed", String(arrows));
    bPeek.setAttribute("aria-pressed", String(peek));

    // Whole-piece only means anything against a narrowed net, so it follows
    // the net's visibility and greys out until a face is actually deselected.
    const netNarrow = faceFiltered();
    bWhole.setAttribute("aria-pressed", String(wholePiece && netNarrow));
    bWhole.setAttribute("aria-disabled", String(!netNarrow));
    bWhole.style.opacity = netNarrow ? "1" : "0.4";
    bWhole.style.cursor = netNarrow ? "pointer" : "default";

    // Rebuilt rather than patched: it's two short rows, and the kind toggles
    // change how many there are.
    poolList.textContent = "";
    if (layout.faces && netNarrow) {
      if (corners) poolList.appendChild(poolRow("corners", "corner"));
      if (edges) poolList.appendChild(poolRow("edges", "edge"));
    }

    kindRow.style.display = layout.kinds ? "flex" : "none";
    netWrap.style.display = layout.faces ? "flex" : "none";
    wholeRow.style.display = layout.faces ? "flex" : "none";
    poolList.style.display = poolList.childElementCount ? "flex" : "none";
    poolGroup.wrap.style.display = layout.kinds || layout.faces ? "flex" : "none";
    bArrows.style.display = layout.arrows ? "flex" : "none";
    bPeek.style.display = layout.peek ? "flex" : "none";
    showGroup.wrap.style.display = layout.arrows || layout.peek ? "flex" : "none";

    const parts = activeParts();
    trigger.innerHTML = `${svg("filter")}<span>${parts.join(" · ") || "settings"}</span>`;
    // Lit whenever anything is off-default — the pool being narrowed is the
    // important one (filterIsNarrow covers the case where corners *and*
    // edges are on but the net isn't), a stray peek is worth flagging too.
    trigger.setAttribute("aria-pressed", String(parts.length > 0 || filterIsNarrow(visibleFilter())));
  }

  function emitPool(): void {
    sync();
    poolListeners.forEach((cb) => cb());
  }
  function emitDisplay(): void {
    sync();
    displayListeners.forEach((cb) => cb());
  }

  function close(): void {
    if (pinned) return; // nothing to close — the panel is the UI
    panel.style.display = "none";
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onKeydown);
  }
  function onDocClick(e: MouseEvent): void {
    if (!element.contains(e.target as Node)) close();
  }
  // Escape closes too. The dropdown floats over the canvas and swallows
  // orbit drags where it sits, so leaving it open by accident is worth an
  // easy out. Listener only exists while open, so it can't shadow a drill's
  // own keys (letterInput's keyboard mode listens on window for A-X).
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
  }
  function open(): void {
    panel.style.display = "flex";
    trigger.setAttribute("aria-expanded", "true");
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKeydown);
  }
  trigger.addEventListener("click", () => {
    if (panel.style.display === "none") open();
    else close();
  });

  // Pinned: no trigger, panel in normal flow, no drop shadow (it isn't
  // floating over anything it needs to lift off). Collapsed: trigger plus
  // an absolutely-positioned panel hanging under it, closed to start.
  function applyPresentation(): void {
    pinned = roomy.matches;
    if (pinned) {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKeydown);
      trigger.style.display = "none";
      panel.style.position = "static";
      panel.style.display = "flex";
      panel.style.boxShadow = "none";
    } else {
      trigger.style.display = "flex";
      panel.style.position = "absolute";
      panel.style.display = "none";
      panel.style.boxShadow = "0 6px 20px rgba(0,0,0,.5)";
      trigger.setAttribute("aria-expanded", "false");
    }
  }
  roomy.addEventListener("change", applyPresentation);

  element.append(trigger, panel);
  applyPresentation();
  sync();

  return {
    element,
    filter,
    showKind(kind) {
      if (kind === "corner") return corners;
      if (kind === "edge") return edges;
      return true;
    },
    arrows: () => arrows,
    peek: () => peek,
    onPoolChange: (cb) => poolListeners.push(cb),
    onDisplayChange: (cb) => displayListeners.push(cb),
    setLayout(next) {
      layout = next;
      sync();
    },
    resetDisplay() {
      arrows = false;
      peek = false;
      close();
      sync();
    },
    destroy() {
      close();
      roomy.removeEventListener("change", applyPresentation);
    },
  };
}
