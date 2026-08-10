// Reusable "here's a context, the answer is one letter" input widget, for
// the sticker/piece/buffer -> letter question family (s2l, piece; trace
// later). l2s does NOT use this — its answer is a location (tap the cube),
// not a letter.
//
// Three interchangeable modes, switched via a small icon dropdown the
// component renders in its own corner (an in-session preference, not
// persisted — simplicity decision, see project memory):
//   keypad   - tap a letter on an A-X grid
//   keyboard - type the letter (desktop only in practice — no physical
//              keyboard on mobile means the mode is simply unreachable
//              there; no feature-detection needed)
//   reveal   - reveal the answer, then self-report got-it/missed
//
// A "reveal" escape hatch is always available even in keypad/keyboard mode,
// but there it's a give-up (always counts wrong) rather than the primary
// self-grading flow reveal mode uses it for.
import type { Kind } from "../cube/state";

export type LetterInputMode = "keypad" | "keyboard" | "reveal";

export interface AnswerResult {
  readonly correct: boolean;
  /** the letter actually chosen/typed; null for reveal mode or a give-up */
  readonly said: string | null;
  /** true when reveal was used as a give-up outside reveal mode */
  readonly gaveUp: boolean;
}

export interface LetterInput {
  readonly element: HTMLElement;
  /** start a new question; the correct answer is this (kind, letter) */
  ask(kind: Kind, letter: string): void;
  /** clear the current question without emitting an answer — call this
   *  when navigating away from whatever drill owns this instance, so a
   *  stale keyboard listener can't register a phantom answer later */
  cancel(): void;
  /** the one grading check every mode routes through — true iff `letter`
   *  matches the current question. False if nothing is currently asked. */
  isLetterValid(letter: string): boolean;
  onAnswer(cb: (result: AnswerResult) => void): void;
  setMode(mode: LetterInputMode): void;
  getMode(): LetterInputMode;
  destroy(): void;
}

const LETTERS = Array.from({ length: 24 }, (_, i) => String.fromCharCode(65 + i));

/**
 * A sensible starting mode for the current device: desktop (mouse, hover-
 * capable) starts on keyboard since typing is fastest there; touch devices
 * start on reveal+yesno since there's no physical keyboard and a 24-key
 * on-screen grid is a lot to scan before the user even knows the drill.
 * Always overridable — this is just the default, not a lock-in.
 */
export function defaultLetterInputMode(): LetterInputMode {
  if (typeof window === "undefined" || !window.matchMedia) return "keypad";
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches ? "keyboard" : "reveal";
}

// Small line-art icons, same style as the app's existing top-bar icons
// (24x24 viewBox, currentColor). Kept minimal and geometric rather than
// text glyphs, so they scale cleanly at the tiny corner-button size.
const MODE_ICON: Readonly<Record<LetterInputMode, string>> = {
  keypad: `<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/>
    <rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>`,
  keyboard: `<rect x="2" y="5" width="20" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <circle cx="6" cy="9" r="1"/><circle cx="10" cy="9" r="1"/><circle cx="14" cy="9" r="1"/><circle cx="18" cy="9" r="1"/>
    <circle cx="6" cy="13" r="1"/><circle cx="10" cy="13" r="1"/><circle cx="14" cy="13" r="1"/><circle cx="18" cy="13" r="1"/>
    <rect x="6" y="16" width="12" height="1.6" rx="0.8"/>`,
  reveal: `<path d="M5 3h10l4 4v14H5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M15 3v4h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M9 13l2.2 2.2L15 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
};
const MODE_LABEL: Readonly<Record<LetterInputMode, string>> = {
  keypad: "keypad",
  keyboard: "keyboard",
  reveal: "reveal + yes/no",
};
function iconSvg(mode: LetterInputMode): string {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">${MODE_ICON[mode]}</svg>`;
}

export function createLetterInput(initialMode: LetterInputMode = "keypad"): LetterInput {
  // `element` is the permanent outer shell — position:relative anchors the
  // floating corner control, and it is NEVER cleared by render(). Only
  // `card`'s contents get rebuilt per mode/question, so the corner button
  // isn't fighting a full-width row for space; it just floats over it.
  const element = document.createElement("div");
  element.style.position = "relative";
  element.style.maxWidth = "380px";
  element.style.margin = "0 auto";
  element.style.flex = "1 1 auto";
  element.style.minHeight = "0";
  element.style.display = "flex";

  const card = document.createElement("div");
  card.style.display = "flex";
  card.style.flexDirection = "column";
  card.style.flex = "1 1 auto";
  card.style.minHeight = "0";
  card.style.gap = "10px";
  card.style.width = "100%";
  element.appendChild(card);

  let current: { kind: Kind; letter: string } | null = null;
  let answered = false;
  let activeMode = initialMode;
  const listeners: ((result: AnswerResult) => void)[] = [];

  function emit(result: AnswerResult): void {
    answered = true;
    listeners.forEach((cb) => cb(result));
    render();
  }

  // The one grading check every mode with a candidate letter routes
  // through, so "what counts as correct" is defined exactly once.
  function isLetterValid(letter: string): boolean {
    return current !== null && letter === current.letter;
  }

  // ---- corner dropdown: floats over the card, no reserved row for it ----
  const modeBtn = document.createElement("button");
  modeBtn.type = "button";
  // Without the explicit flex override, the global `button { flex: 1 }`
  // rule (style.css) wins over `width` — flex-basis:0 from `flex:1`
  // ignores `width` entirely, stretching this into a bar instead of a
  // small square. Same class of bug the give-up link needed too.
  modeBtn.style.flex = "0 0 auto";
  modeBtn.style.position = "absolute";
  modeBtn.style.top = "0";
  modeBtn.style.right = "0";
  modeBtn.style.zIndex = "4";
  modeBtn.style.minHeight = "0";
  modeBtn.style.width = "24px";
  modeBtn.style.height = "24px";
  modeBtn.style.padding = "0";
  modeBtn.style.display = "flex";
  modeBtn.style.alignItems = "center";
  modeBtn.style.justifyContent = "center";
  modeBtn.style.borderRadius = "7px";
  modeBtn.style.background = "var(--surface)";
  modeBtn.style.opacity = "0.88";
  modeBtn.setAttribute("aria-label", "answer input mode");

  const modeMenu = document.createElement("div");
  modeMenu.style.position = "absolute";
  modeMenu.style.top = "28px";
  modeMenu.style.right = "0";
  modeMenu.style.display = "none";
  modeMenu.style.flexDirection = "column";
  modeMenu.style.gap = "2px";
  modeMenu.style.padding = "4px";
  modeMenu.style.borderRadius = "9px";
  modeMenu.style.background = "var(--surface)";
  modeMenu.style.zIndex = "5";
  modeMenu.style.boxShadow = "0 4px 14px rgba(0,0,0,.4)";

  const modeOptionBtns = new Map<LetterInputMode, HTMLButtonElement>();
  (["keypad", "keyboard", "reveal"] as const).forEach((m) => {
    const opt = document.createElement("button");
    opt.type = "button";
    opt.style.display = "flex";
    opt.style.alignItems = "center";
    opt.style.gap = "6px";
    opt.style.minHeight = "0";
    opt.style.padding = "6px 10px";
    opt.style.whiteSpace = "nowrap";
    opt.style.justifyContent = "flex-start";
    opt.innerHTML = `${iconSvg(m)}<span>${MODE_LABEL[m]}</span>`;
    opt.addEventListener("click", () => {
      activeMode = m;
      closeMenu();
      render();
    });
    modeMenu.appendChild(opt);
    modeOptionBtns.set(m, opt);
  });

  function closeMenu(): void {
    modeMenu.style.display = "none";
    document.removeEventListener("click", onDocClick);
  }
  function onDocClick(e: MouseEvent): void {
    if (!modeBtn.contains(e.target as Node) && !modeMenu.contains(e.target as Node)) closeMenu();
  }
  modeBtn.addEventListener("click", () => {
    const opening = modeMenu.style.display === "none";
    modeMenu.style.display = opening ? "flex" : "none";
    if (opening) document.addEventListener("click", onDocClick);
  });
  element.append(modeBtn, modeMenu);

  // ---- keypad: tap a letter ----
  // Fixed-size keys, centered as a block via justify-content — reflows how
  // many columns fit as the widget resizes, rather than either a rigid 6
  // columns or stretchy 1fr columns that blow keys up on a wide layout.
  const keypadGrid = document.createElement("div");
  keypadGrid.style.display = "grid";
  keypadGrid.style.gridTemplateColumns = "repeat(auto-fit, 38px)";
  keypadGrid.style.justifyContent = "center";
  keypadGrid.style.gap = "6px";
  const keypadButtons = new Map<string, HTMLButtonElement>();
  LETTERS.forEach((letter) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = letter;
    b.style.flex = "0 0 auto";
    b.style.width = "38px";
    b.style.height = "38px";
    b.style.minHeight = "0";
    b.style.padding = "0";
    b.style.fontWeight = "700";
    b.style.borderRadius = "9px";
    b.addEventListener("click", () => {
      if (!current || answered) return;
      emit({ correct: isLetterValid(letter), said: letter, gaveUp: false });
    });
    keypadGrid.appendChild(b);
    keypadButtons.set(letter, b);
  });

  // ---- keyboard: type a letter ----
  // Fills whatever space the widget has (flex:1 + a min-height floor)
  // rather than a fixed-size pill, so the placeholder actually reflects
  // the widget's footprint when it's resized.
  const keyboardHint = document.createElement("div");
  keyboardHint.textContent = "press a letter key (A–X)";
  keyboardHint.style.flex = "1 1 auto";
  keyboardHint.style.minHeight = "80px";
  keyboardHint.style.display = "flex";
  keyboardHint.style.alignItems = "center";
  keyboardHint.style.justifyContent = "center";
  keyboardHint.style.textAlign = "center";
  keyboardHint.style.padding = "18px 12px";
  keyboardHint.style.borderRadius = "var(--radius-md)";
  keyboardHint.style.border = "1px dashed var(--text-faint)";
  keyboardHint.style.color = "var(--text-dim)";
  keyboardHint.style.fontSize = "12px";
  function onKeydown(e: KeyboardEvent): void {
    if (activeMode !== "keyboard" || !current || answered) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const letter = e.key.length === 1 ? e.key.toUpperCase() : "";
    if (!LETTERS.includes(letter)) return;
    e.preventDefault();
    emit({ correct: isLetterValid(letter), said: letter, gaveUp: false });
  }
  window.addEventListener("keydown", onKeydown);

  // ---- reveal + self-report yes/no ----
  // This mode has no keypad/keyboard peer to defer to, so "reveal" IS the
  // primary action here — sized and coloured like one, not like the
  // give-up link the other two modes tuck away in a corner.
  const revealPanel = document.createElement("div");
  revealPanel.style.display = "flex";
  revealPanel.style.flex = "1 1 auto";
  revealPanel.style.flexDirection = "column";
  revealPanel.style.alignItems = "center";
  revealPanel.style.justifyContent = "center";
  revealPanel.style.gap = "12px";
  revealPanel.style.padding = "14px 0";

  const revealBtn = document.createElement("button");
  revealBtn.type = "button";
  revealBtn.textContent = "reveal";
  revealBtn.style.flex = "0 0 auto";
  revealBtn.style.minWidth = "160px";
  revealBtn.style.background = "var(--accent)";
  revealBtn.style.color = "var(--accent-ink)";
  revealBtn.style.fontWeight = "700";

  const answerText = document.createElement("div");
  answerText.style.fontSize = "22px";
  answerText.style.fontWeight = "700";
  answerText.style.color = "var(--text-bright)";

  // wraps to stacked buttons under ~250px instead of squeezing two
  // labels into a sliver each — an actual layout change on resize,
  // not just smaller text
  const yesNoRow = document.createElement("div");
  yesNoRow.style.display = "flex";
  yesNoRow.style.flexWrap = "wrap";
  yesNoRow.style.gap = "8px";
  yesNoRow.style.width = "100%";
  const hitBtn = document.createElement("button");
  hitBtn.type = "button";
  hitBtn.textContent = "✓ got it";
  hitBtn.style.flex = "1 1 120px";
  hitBtn.style.background = "var(--good)";
  hitBtn.style.color = "var(--good-ink)";
  hitBtn.style.fontWeight = "700";
  const missBtn = document.createElement("button");
  missBtn.type = "button";
  missBtn.textContent = "✗ missed";
  missBtn.style.flex = "1 1 120px";
  missBtn.style.background = "var(--bad)";
  missBtn.style.color = "var(--bad-ink)";
  missBtn.style.fontWeight = "700";
  yesNoRow.append(hitBtn, missBtn);

  let revealed = false;
  revealBtn.addEventListener("click", () => {
    if (!current || answered) return;
    revealed = true;
    render();
  });
  // Reveal mode never captures a candidate letter — the user self-reports
  // against the letter we just showed them, so there's nothing to pass
  // through isLetterValid(); correctness here IS the self-report.
  hitBtn.addEventListener("click", () => emit({ correct: true, said: null, gaveUp: false }));
  missBtn.addEventListener("click", () => emit({ correct: false, said: null, gaveUp: false }));

  // ---- give-up escape hatch, shown alongside keypad/keyboard. Visually
  // subdued (a text-style link, not a full button) — it's a fallback for
  // being stuck, not a peer of the primary tap/type interaction. ----
  const giveUpRow = document.createElement("div");
  giveUpRow.style.display = "flex";
  giveUpRow.style.justifyContent = "center";
  const giveUpBtn = document.createElement("button");
  giveUpBtn.type = "button";
  giveUpBtn.textContent = "give up, reveal it";
  giveUpBtn.style.flex = "0 0 auto";
  giveUpBtn.style.minHeight = "0";
  giveUpBtn.style.padding = "4px 2px";
  giveUpBtn.style.background = "transparent";
  giveUpBtn.style.color = "var(--text-dim)";
  giveUpBtn.style.fontSize = "10px";
  giveUpBtn.style.textDecoration = "underline";
  giveUpBtn.addEventListener("click", () => {
    if (!current || answered) return;
    emit({ correct: false, said: null, gaveUp: true });
  });
  giveUpRow.appendChild(giveUpBtn);

  function render(): void {
    card.innerHTML = "";
    // Breathing room so the floating corner button never sits on top of
    // real content (the keypad's top-right key, in particular) — padding
    // on the card, not a dedicated empty row.
    card.style.paddingTop = "30px";
    modeBtn.innerHTML = iconSvg(activeMode);
    modeOptionBtns.forEach((btn, m) => btn.setAttribute("aria-pressed", String(m === activeMode)));
    closeMenu();

    keypadButtons.forEach((b) => {
      b.disabled = answered || !current;
    });
    giveUpBtn.disabled = answered || !current;
    if (activeMode === "keypad") {
      card.append(keypadGrid, giveUpRow);
    } else if (activeMode === "keyboard") {
      card.append(keyboardHint, giveUpRow);
    } else {
      revealPanel.innerHTML = "";
      if (!current || answered) {
        // nothing pending, or already answered — leave panel empty
      } else if (!revealed) {
        revealPanel.append(revealBtn);
      } else {
        answerText.textContent = `it is ${current.letter}`;
        revealPanel.append(answerText, yesNoRow);
      }
      card.append(revealPanel);
    }
  }
  render();

  return {
    element,
    ask(kind, letter) {
      current = { kind, letter };
      answered = false;
      revealed = false;
      render();
    },
    cancel() {
      current = null;
      answered = false;
      revealed = false;
      render();
    },
    isLetterValid,
    onAnswer: (cb) => listeners.push(cb),
    setMode(next) {
      activeMode = next;
      render();
    },
    getMode: () => activeMode,
    destroy() {
      window.removeEventListener("keydown", onKeydown);
      document.removeEventListener("click", onDocClick);
    },
  };
}
