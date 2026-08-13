// App wiring: mode/tab state, the cube view, and (so far) a fully working
// Learn mode. s2l/l2s/piece are placeholders until their shared answer
// input component is designed — see CLAUDE.md and the drill priority
// (Learn, s2l, l2s, piece; trace/memo/pace deferred).
import * as THREE from "three";
import { FACES, KEYS, type FaceKey } from "./cube/faces";
import { createCube, isSolved, solve, type Kind, type Sticker } from "./cube/state";
import { buildLetters, letterAt, LETTER_BLOCK } from "./speffz/letters";
import { H } from "./render/constants";
import { buildCubeMesh } from "./render/geometry";
import { buildGhosts } from "./render/ghosts";
import { buildSoloView } from "./render/solo";
import { buildTiles, paintTile, type Mark } from "./render/tiles";
import { createView } from "./render/view";
import { createControls } from "./ui/controls";
import { createLetterInput, defaultLetterInputMode } from "./ui/letterInput";
import { createNet } from "./ui/net";
import { createPicker, freshPool } from "./drills/pool";
import { createSession } from "./drills/session";

type Mode = "learn" | "s2l" | "l2s" | "piece";

// how long the "correct" / "it is X" feedback sits before auto-advancing
// (s2l, piece — the letter-selection drills). l2s keeps a manual "next"
// since tapping the wrong sticker benefits from a deliberate look-first beat.
//
// Split by outcome: a hit needs only a glance-length confirmation beat, so
// the drill keeps up with fast recall instead of throttling it, while a miss
// keeps the longer pause — that's the one you actually have to read and
// absorb ("you said K — it is N").
const AUTO_ADVANCE_HIT_MS = 350;
const AUTO_ADVANCE_MISS_MS = 1200;
function autoAdvanceMs(correct: boolean): number {
  return correct ? AUTO_ADVANCE_HIT_MS : AUTO_ADVANCE_MISS_MS;
}

const canvas = document.getElementById("view") as HTMLCanvasElement;
const view = createView(canvas);

const cube = createCube();
const letters = buildLetters(cube);

const cubeMesh = buildCubeMesh(cube);
view.scene.add(cubeMesh.mesh);

const tiles = buildTiles(cube, letters.letterOf);
tiles.forEach((t) => view.scene.add(t.mesh));

const ghosts = buildGhosts(cube, tiles, view.scene);
const soloView = buildSoloView(cube, view.scene);

// ---- shared state ----
// Everything the user can toggle across drills — corners/edges, the face
// pool, arrows, peek — lives in the controls dropdown rather than as loose
// module-level flags. main.ts reads it; it never shadows it with a copy.
let mode: Mode = "learn";
const controls = createControls();
document.getElementById("top")!.appendChild(controls.element);
let faceHighlight: FaceKey | null = null;
const marks = new Map<Sticker, Mark>();
const revealed = new Set<Sticker>();

// Three label strengths (CLAUDE.md "Rendering details worth preserving"):
// full, faint (a grid/highlight is showing), and off. Driven by whether
// anything is currently highlighted, recomputed every frame, only
// repainted on an actual change — matches the original's setLabels().
let tilesLit = true;
let tilesFaint = false;
function setLabelState(lit: boolean, faint: boolean): void {
  if (tilesLit === lit && tilesFaint === faint) return;
  tilesLit = lit;
  tilesFaint = faint;
  repaintTiles();
}

// Label painting keys off kind only, never the face pool: dimming labels
// on out-of-pool faces would quietly change what learn and peek show, and
// the pool filter's job is to pick what gets *asked*, not what's legible.
const showKind = (kind: Kind): boolean => controls.showKind(kind);

function repaintTiles(): void {
  tiles.forEach((tile) => {
    const s = tile.sticker;
    const lit = tilesLit ? showKind(s.kind) : revealed.has(s);
    const faint = !lit && tilesFaint && showKind(s.kind);
    paintTile(tile, s.cur, { lit, faint, mark: marks.get(s) ?? null });
  });
}
repaintTiles();

view.onFrame(() => {
  // The face-tint stops showing once an l2s question is answered (even
  // though the net keeps its own selected-button state) — matches the
  // original, which never let a post-answer face change affect a
  // resolved question.
  const showFaceHighlight = mode === "learn" || (mode === "l2s" && !l2sDone);
  const shown = ghosts.update({
    camera: view.camera,
    mark: (s) => marks.get(s) ?? null,
    revealed: (s) => revealed.has(s),
    peek: controls.peek(),
    faceHighlight: showFaceHighlight ? faceHighlight : null,
    showContextLabels: mode === "learn" || controls.peek(),
    showKind,
  });
  const legend = mode === "learn" || controls.peek();
  setLabelState(!shown && legend, shown && legend);
  soloView.tick(view.camera);
});

// ---- controls: pool changes re-ask, display changes only repaint ----
// The old code re-asked on a corners/edges change in s2l alone, which was
// a gap rather than a decision: narrowing the pool in l2s or piece left a
// live question that the new pool might exclude. Every drill re-asks now.
controls.onPoolChange(() => {
  repaintTiles();
  if (mode === "s2l") askS2l();
  else if (mode === "l2s") askL2s();
  else if (mode === "piece") askPiece();
});
controls.onDisplayChange(() => {
  arrowMeshes.forEach((m) => {
    m.visible = controls.arrows();
  });
  // piece draws its answer key into the isolated cubie, so toggling peek
  // mid-question has to redraw it — the per-frame ghost path can't.
  if (mode === "piece" && quizCur && quizLetter && piecePending) {
    soloView.show(quizCur, "ask", controls.peek() ? quizLetter : "");
  }
});

// ---- face net: single-select, isolates + tints a face (learn only for now) ----
const net = createNet("single");
document.getElementById("faces")!.appendChild(net.element);
net.onChange((selection) => {
  faceHighlight = [...selection][0] ?? null;
});

// ---- reference legend rows ----
const REF_TEXT_COLOUR: Readonly<Record<FaceKey, string>> = {
  U: "#f1f2ef", L: "#f0812f", Fr: "#2fc069", R: "#e84a54", B: "#5f8ef2", D: "#f8da33",
};
const refEl = document.getElementById("ref")!;
KEYS.forEach((key) => {
  const row = document.createElement("div");
  const off = LETTER_BLOCK[key];
  row.textContent = [0, 1, 2, 3].map((i) => letterAt(off + i)).join("");
  row.style.color = REF_TEXT_COLOUR[key];
  refEl.appendChild(row);
});

// ---- clockwise-order teaching overlay (learn only) ----
function buildArrowOverlay(): THREE.Mesh[] {
  const T = 512;
  const m = 38;
  const r = 80;
  const gap = 64;
  const canvasEl = document.createElement("canvas");
  canvasEl.width = canvasEl.height = T;
  const c = canvasEl.getContext("2d")!;
  const hi = "#f0b429";
  const halo = "rgba(8,10,14,.45)";
  c.lineCap = "round";
  c.lineJoin = "round";
  function path() {
    c.beginPath();
    c.moveTo(m, m);
    c.arcTo(T - m, m, T - m, T - m, r);
    c.arcTo(T - m, T - m, m, T - m, r);
    c.lineTo(m + gap, T - m);
  }
  function head() {
    c.beginPath();
    c.moveTo(m + 6, T - m);
    c.lineTo(m + gap + 6, T - m - 22);
    c.lineTo(m + gap + 6, T - m + 22);
    c.closePath();
  }
  path();
  c.lineWidth = 25;
  c.strokeStyle = halo;
  c.stroke();
  head();
  c.lineWidth = 16;
  c.strokeStyle = halo;
  c.stroke();
  c.beginPath();
  c.arc(m, m, 21, 0, 6.284);
  c.fillStyle = halo;
  c.fill();
  path();
  c.lineWidth = 12;
  c.strokeStyle = hi;
  c.stroke();
  head();
  c.fillStyle = hi;
  c.fill();
  c.beginPath();
  c.arc(m, m, 14, 0, 6.284);
  c.fill();

  const mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvasEl), transparent: true, depthWrite: false });
  return KEYS.map((key) => {
    const f = FACES[key];
    const nrm: [number, number, number] = [0, 0, 0];
    nrm[f.axis] = f.sign;
    const nv = new THREE.Vector3(...nrm);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), mat);
    mesh.applyMatrix4(
      new THREE.Matrix4()
        .makeBasis(new THREE.Vector3(...f.rt), new THREE.Vector3(...f.up), nv)
        .setPosition(nv.clone().multiplyScalar(1 + H + 0.02)),
    );
    mesh.visible = false;
    view.scene.add(mesh);
    return mesh;
  });
}
const arrowMeshes = buildArrowOverlay();

// ---- shared DOM refs for status/action chrome ----
const elLegend = document.getElementById("legend")!;
const elStatus = document.getElementById("status")!;
const elAct = document.getElementById("act")!;
const elSay = document.getElementById("say")!;
const elGlyph = document.getElementById("glyph")!;
const elScore = document.getElementById("score")!;
const elAnswer = document.getElementById("answer")!;
const bNext = document.getElementById("bNext")!;
const bGiveUp = document.getElementById("bGiveUp")!;

function hideAnswerChrome(): void {
  elAct.classList.add("hide");
  elAnswer.classList.add("hide");
  bNext.classList.add("hide");
  bGiveUp.classList.add("hide");
}

// The controls can't currently produce an empty pool — the last kind toggle
// is sticky and an emptied face net restores no-filter — so this is a guard,
// not a state the UI steers into. Kept (and worded for the filter rather
// than for corners/edges alone) because freshPool's contract allows it.
function sayEmptyPool(): void {
  elGlyph.textContent = "";
  elSay.innerHTML = "nothing in the pool — widen the filter to start";
  hideAnswerChrome();
}

// ---- letter-input widget (s2l, later piece) — mode switch lives in its
// own corner dropdown, nothing to wire up here beyond mounting it ----
const letterInput = createLetterInput(defaultLetterInputMode());
elAnswer.appendChild(letterInput.element);

// ---- shared quiz state (one drill active at a time, reset on every tab
// switch, so s2l/l2s/piece can all reuse the same variables) ----
let quizCur: Sticker | null = null;
let quizLetter: string | null = null;
const session = createSession();
// Owns "what did I just ask" so no drill has to remember to avoid an
// immediate repeat; shared because only one drill is live at a time, and
// reset alongside `session` on every tab switch.
const picker = createPicker<Sticker>();

// ---- s2l: a marked sticker on the cube -> identify its letter ----
function askS2l(): void {
  marks.clear();
  revealed.clear();
  quizCur = picker.next(freshPool(cube, controls.filter()));
  quizLetter = quizCur ? letters.letterOf(quizCur) : null;
  repaintTiles();

  if (!quizCur) {
    sayEmptyPool();
    return;
  }

  const letter = quizLetter!;
  marks.set(quizCur, "ask");
  repaintTiles();
  elGlyph.textContent = "?";
  elSay.innerHTML = `which letter is the ringed <b>${quizCur.kind}</b>?`;
  elScore.textContent = session.scoreText();
  elAct.classList.add("hide");
  elAnswer.classList.remove("hide");
  letterInput.ask(quizCur.kind, letter);
}

letterInput.onAnswer((result) => {
  if (mode !== "s2l" || !quizCur || !quizLetter) return; // guard a stale/late event
  session.record(result.correct);
  marks.set(quizCur, result.correct ? "good" : "bad");
  revealed.add(quizCur);
  repaintTiles();

  elGlyph.textContent = quizLetter;
  elScore.textContent = session.scoreText();
  if (result.correct) {
    elSay.innerHTML = "<b>correct</b>";
  } else if (result.said) {
    elSay.innerHTML = `you said <b>${result.said}</b> — it is <b>${quizLetter}</b>`;
  } else {
    elSay.innerHTML = `it is <b>${quizLetter}</b>`;
  }
  // Auto-advance rather than hiding the widget for a "next" button: that
  // swap between a big keypad and a small button was a jarring layout
  // shift. The widget just stays put and re-asks itself.
  setTimeout(() => {
    if (mode === "s2l") askS2l();
  }, autoAdvanceMs(result.correct));
});
bNext.addEventListener("click", () => {
  // only l2s still uses a manual "next" — s2l/piece auto-advance instead
  if (mode === "l2s") askL2s();
});

// ---- l2s: a letter is shown -> tap the matching sticker on the cube.
// Reuses the same single-select net as learn ("narrow to a face" instead
// of learn's "isolate a face"), and picking is done via view.onTap rather
// than letterInput (the answer is a location, not a letter). ----
let l2sDone = false;

function askL2s(): void {
  marks.clear();
  revealed.clear();
  faceHighlight = null;
  net.setSelection(new Set());
  net.setDisabled(false);
  l2sDone = false;
  quizCur = picker.next(freshPool(cube, controls.filter()));
  quizLetter = quizCur ? letters.letterOf(quizCur) : null;
  repaintTiles();

  if (!quizCur) {
    sayEmptyPool();
    return;
  }

  elGlyph.textContent = quizLetter;
  elSay.innerHTML = `find this <b>${quizCur.kind}</b> — tap it, or pick its face below`;
  elScore.textContent = session.scoreText();
  elAnswer.classList.add("hide");
  elAct.classList.remove("hide");
  bNext.classList.add("hide");
  bGiveUp.classList.remove("hide");
}

function finishL2s(picked: Sticker | null): void {
  if (mode !== "l2s" || !quizCur || !quizLetter || l2sDone) return;
  l2sDone = true;
  net.setDisabled(true);
  session.record(picked === quizCur);
  if (picked) {
    marks.set(picked, picked === quizCur ? "good" : "bad");
    revealed.add(picked);
  }
  if (picked !== quizCur) {
    marks.set(quizCur, "good");
    revealed.add(quizCur);
  }
  repaintTiles();

  elScore.textContent = session.scoreText();
  if (picked === quizCur) {
    elSay.innerHTML = "<b>correct</b>";
  } else if (picked) {
    elSay.innerHTML = `you tapped <b>${letters.letterOf(picked)}</b> · ${picked.kind} — green ring is the answer`;
  } else {
    elSay.innerHTML = `it is <b>${quizLetter}</b>`;
  }
  bGiveUp.classList.add("hide");
  bNext.classList.remove("hide");
}

view.onTap((x, y) => {
  if (mode !== "l2s" || !quizCur || l2sDone) return;
  const candidates = faceHighlight ? tiles.filter((t) => t.sticker.home === faceHighlight) : tiles;
  const hit = view.pick(
    x,
    y,
    candidates.map((t) => t.mesh),
  );
  if (!hit) return;
  const sticker = hit.object.userData.sticker as Sticker;
  if (sticker.kind === "center") return;
  finishL2s(sticker);
});
bGiveUp.addEventListener("click", () => finishL2s(null));

// ---- piece: one isolated corner/edge cubie -> identify its ringed
// sticker's letter. Always runs on a solved cube (never scrambles — see
// render/solo.ts), reuses letterInput exactly like s2l. ----
let piecePending = false;

function askPiece(): void {
  quizCur = picker.next(freshPool(cube, controls.filter()));
  quizLetter = quizCur ? letters.letterOf(quizCur) : null;
  piecePending = true;

  if (!quizCur) {
    soloView.hide();
    sayEmptyPool();
    return;
  }

  const letter = quizLetter!;
  soloView.show(quizCur, "ask", controls.peek() ? letter : "");
  elGlyph.textContent = "?";
  elSay.innerHTML = `one <b>${quizCur.kind}</b>, on its own — which letter is the ringed sticker?`;
  elScore.textContent = session.scoreText();
  elAct.classList.add("hide");
  elAnswer.classList.remove("hide");
  letterInput.ask(quizCur.kind, letter);
}

letterInput.onAnswer((result) => {
  if (mode !== "piece" || !quizCur || !quizLetter) return;
  piecePending = false;
  session.record(result.correct);
  soloView.show(quizCur, result.correct ? "good" : "bad", quizLetter);

  elGlyph.textContent = quizLetter;
  elScore.textContent = session.scoreText();
  if (result.correct) {
    elSay.innerHTML = "<b>correct</b>";
  } else if (result.said) {
    elSay.innerHTML = `you said <b>${result.said}</b> — it is <b>${quizLetter}</b>`;
  } else {
    elSay.innerHTML = `it is <b>${quizLetter}</b>`;
  }
  setTimeout(() => {
    if (mode === "piece") askPiece();
  }, autoAdvanceMs(result.correct));
});

// ---- tabs ----
const TABS: readonly Mode[] = ["learn", "s2l", "l2s", "piece"];

function setMode(next: Mode): void {
  mode = next;
  TABS.forEach((m) => document.getElementById(`tab-${m}`)!.setAttribute("aria-selected", String(m === mode)));
  faceHighlight = null;
  net.setSelection(new Set());
  controls.resetDisplay();
  marks.clear();
  revealed.clear();
  letterInput.cancel();
  net.setDisabled(false);
  l2sDone = false;
  quizCur = null;
  quizLetter = null;
  session.reset();
  picker.reset();
  elScore.textContent = "";

  // legend (ref rows + face net) is shared by learn and l2s, exactly as in
  // the original — l2s reuses the same net for "narrow to a face" that
  // learn uses to isolate one
  elLegend.classList.toggle("hide", mode !== "learn" && mode !== "l2s");
  refEl.classList.toggle("hide", mode !== "learn");
  elStatus.classList.toggle("hide", mode === "learn");
  // What the dropdown offers is per-mode. The face-pool net is hidden in
  // learn (docs/CONVENTIONS.md: the legend's own net already isolates a
  // face there, so a second one would be two nets meaning two things on
  // one screen); arrows are a learn-only teaching overlay; peek only makes
  // sense once there's an answer to peek at.
  controls.setLayout({
    kinds: true,
    faces: mode !== "learn",
    arrows: mode === "learn",
    peek: mode !== "learn",
  });
  arrowMeshes.forEach((mesh) => {
    mesh.visible = false;
  });

  solve(cube);
  cubeMesh.updateColours();
  repaintTiles();

  // piece shows one isolated cubie instead of the whole cube, much closer
  // up (0.95 vs the whole cube's 2.2 fit radius) — matches the original's
  // setScene()
  const solo = mode === "piece";
  cubeMesh.mesh.visible = !solo;
  tiles.forEach((t) => {
    t.mesh.visible = !solo;
  });
  if (!solo) soloView.hide();
  view.setFitRadius(solo ? 0.95 : 2.2);

  if (mode === "learn") {
    hideAnswerChrome();
    return;
  }
  view.goHome();
  if (mode === "s2l") askS2l();
  else if (mode === "l2s") askL2s();
  else if (mode === "piece") askPiece();
}

TABS.forEach((m) => {
  document.getElementById(`tab-${m}`)!.addEventListener("click", () => setMode(m));
});

setMode("learn");
console.log(`speffz: solved=${isSolved(cube)}`);
