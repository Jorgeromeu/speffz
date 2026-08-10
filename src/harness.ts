// Dev-only debugging panel: serves the cube + render layer directly with
// sliders/toggles for every feature, so ghost/render bugs (CLAUDE.md's open
// bugs) can be chased without playing a drill to reach a given state.
import * as THREE from "three";
import { FACES, KEYS, type Axis, type FaceKey, type Sign } from "./cube/faces";
import { applyMove, createCube, isSolved, scramble as scrambleCube, solve as solveCube, type Kind, type Sticker } from "./cube/state";
import { buildLetters } from "./speffz/letters";
import { H } from "./render/constants";
import { buildCubeMesh } from "./render/geometry";
import { buildGhosts } from "./render/ghosts";
import { buildTiles, paintTile, type Mark } from "./render/tiles";
import { createView } from "./render/view";
import { createNet } from "./ui/net";
import { createLetterInput, defaultLetterInputMode } from "./ui/letterInput";

const canvas = document.getElementById("view") as HTMLCanvasElement;
const view = createView(canvas);

const cube = createCube();
const letters = buildLetters(cube);

const cubeMesh = buildCubeMesh(cube);
view.scene.add(cubeMesh.mesh);

const tiles = buildTiles(cube, letters.letterOf);
tiles.forEach((t) => view.scene.add(t.mesh));

const ghosts = buildGhosts(cube, tiles, view.scene);

// ---- ui state ----
const marks = new Map<Sticker, Mark>();
let revealed = false;
let peek = false;
let showCorner = true;
let showEdge = true;
let strength: "full" | "faint" | "off" = "full";
let faceHighlight: FaceKey | null = null;

function showKind(kind: Kind): boolean {
  if (kind === "corner") return showCorner;
  if (kind === "edge") return showEdge;
  return true;
}

function repaintTiles(): void {
  tiles.forEach((tile) => {
    const s = tile.sticker;
    const lit = strength === "full" && showKind(s.kind);
    const faint = strength === "faint" && showKind(s.kind);
    paintTile(tile, s.cur, { lit, faint, mark: marks.get(s) ?? null });
  });
}
repaintTiles();

function afterCubeChange(): void {
  cubeMesh.updateColours();
  repaintTiles();
}

view.onFrame(() => {
  ghosts.update({
    camera: view.camera,
    mark: (s) => marks.get(s) ?? null,
    revealed: () => revealed,
    peek,
    faceHighlight,
    showContextLabels: true,
    showKind,
  });
  syncOrbitUI();
});

// ---- orientation ----
const azInput = document.getElementById("az") as HTMLInputElement;
const polInput = document.getElementById("pol") as HTMLInputElement;
const orbitReadout = document.getElementById("orbitReadout")!;
azInput.addEventListener("input", () => view.setOrbit(Number(azInput.value), Number(polInput.value)));
polInput.addEventListener("input", () => view.setOrbit(Number(azInput.value), Number(polInput.value)));
document.getElementById("home")!.addEventListener("click", () => view.goHome());

function syncOrbitUI(): void {
  const { az, pol } = view.getOrbit();
  const wrapped = ((az % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  azInput.value = String(wrapped);
  polInput.value = String(pol);
  orbitReadout.textContent = `az ${az.toFixed(3)}  pol ${pol.toFixed(3)}${isSolved(cube) ? "  · solved" : ""}`;
}

// ---- labels ----
document.getElementById("showCorner")!.addEventListener("change", (e) => {
  showCorner = (e.target as HTMLInputElement).checked;
  repaintTiles();
});
document.getElementById("showEdge")!.addEventListener("change", (e) => {
  showEdge = (e.target as HTMLInputElement).checked;
  repaintTiles();
});
document.getElementById("peek")!.addEventListener("change", (e) => {
  peek = (e.target as HTMLInputElement).checked;
});
(["full", "faint", "off"] as const).forEach((s) => {
  document.getElementById(`strength-${s}`)!.addEventListener("click", () => {
    strength = s;
    document.querySelectorAll("[data-strength]").forEach((b) => {
      b.classList.toggle("active", (b as HTMLElement).dataset.strength === s);
    });
    repaintTiles();
  });
});

// ---- turns ----
const turnsCW = document.getElementById("turnsCW")!;
const turnsCCW = document.getElementById("turnsCCW")!;
["R", "L", "U", "D", "F", "B"].forEach((name) => {
  const cw = document.createElement("button");
  cw.textContent = name;
  cw.addEventListener("click", () => {
    applyMove(cube, name);
    afterCubeChange();
  });
  turnsCW.appendChild(cw);

  const ccw = document.createElement("button");
  ccw.textContent = name + "'";
  ccw.addEventListener("click", () => {
    applyMove(cube, name + "'");
    afterCubeChange();
  });
  turnsCCW.appendChild(ccw);
});

const scrambleText = document.getElementById("scrambleText")!;
document.getElementById("scramble")!.addEventListener("click", () => {
  scrambleText.textContent = scrambleCube(cube);
  afterCubeChange();
});
document.getElementById("solve")!.addEventListener("click", () => {
  solveCube(cube);
  scrambleText.textContent = "solved";
  afterCubeChange();
});

// ---- face highlight: single-select net ----
const highlightNet = createNet("single");
document.getElementById("faceHighlight")!.appendChild(highlightNet.element);
highlightNet.onChange((selection) => {
  faceHighlight = [...selection][0] ?? null;
});

// ---- pool filter demo: multi-select net, solo-on-first-tap ----
// no drill consumes this yet (trace/memo are deferred) — this is here to
// exercise and visually verify the shared net component's multi-select
// behaviour ahead of that.
const poolNet = createNet("multi");
const poolReadout = document.getElementById("poolReadout")!;
document.getElementById("poolFilter")!.appendChild(poolNet.element);
function renderPoolReadout(selection: ReadonlySet<FaceKey>): void {
  const isAll = KEYS.every((k) => selection.has(k));
  poolReadout.textContent = isAll ? "no filter (all faces)" : `only: ${[...selection].map((k) => (k === "Fr" ? "F" : k)).join(", ")}`;
}
poolNet.onChange(renderPoolReadout);
renderPoolReadout(poolNet.getSelection());

// ---- ghost marks: click a sticker to cycle its mark ----
const MARK_CYCLE: readonly (Mark | null)[] = [null, "ask", "good", "bad"];
view.onTap((x, y) => {
  const hit = view.pick(
    x,
    y,
    tiles.map((t) => t.mesh),
  );
  if (!hit) return;
  const sticker = hit.object.userData.sticker as Sticker;
  if (sticker.kind === "center") return;
  const current = marks.get(sticker) ?? null;
  const next = MARK_CYCLE[(MARK_CYCLE.indexOf(current) + 1) % MARK_CYCLE.length];
  if (next) marks.set(sticker, next);
  else marks.delete(sticker);
  repaintTiles();
  updateMarkList();
});

document.getElementById("revealed")!.addEventListener("change", (e) => {
  revealed = (e.target as HTMLInputElement).checked;
});
document.getElementById("clearMarks")!.addEventListener("click", () => {
  marks.clear();
  repaintTiles();
  updateMarkList();
});

function updateMarkList(): void {
  const list = document.getElementById("markList")!;
  list.innerHTML = "";
  marks.forEach((mark, sticker) => {
    const row = document.createElement("div");
    const label = document.createElement("span");
    label.textContent = `${sticker.kind[0]}${letters.letterOf(sticker)} = ${mark}`;
    const clear = document.createElement("button");
    clear.textContent = "x";
    clear.addEventListener("click", () => {
      marks.delete(sticker);
      updateMarkList();
    });
    row.appendChild(label);
    row.appendChild(clear);
    list.appendChild(row);
  });
}

// ---- clockwise-order teaching overlay ----
function axisVec(axis: Axis, sign: Sign): [number, number, number] {
  const v: [number, number, number] = [0, 0, 0];
  v[axis] = sign;
  return v;
}
function buildArrowOverlay(scene: THREE.Scene): THREE.Mesh[] {
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
    const nv = new THREE.Vector3(...axisVec(f.axis, f.sign));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), mat);
    mesh.applyMatrix4(
      new THREE.Matrix4()
        .makeBasis(new THREE.Vector3(...f.rt), new THREE.Vector3(...f.up), nv)
        .setPosition(nv.clone().multiplyScalar(1 + H + 0.02)),
    );
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  });
}
const arrowMeshes = buildArrowOverlay(view.scene);
document.getElementById("arrows")!.addEventListener("change", (e) => {
  const on = (e.target as HTMLInputElement).checked;
  arrowMeshes.forEach((mesh) => {
    mesh.visible = on;
  });
});

// ---- console capture, so a WebGL/material warning is impossible to miss ----
function logToPanel(kind: "warn" | "error", args: unknown[]): void {
  const el = document.getElementById("consoleLog")!;
  const line = document.createElement("div");
  line.className = kind;
  line.textContent = `[${kind}] ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}
(["warn", "error"] as const).forEach((kind) => {
  const original = console[kind].bind(console);
  console[kind] = (...args: unknown[]) => {
    original(...args);
    logToPanel(kind, args);
  };
});
window.addEventListener("error", (e) => logToPanel("error", [e.message]));

// ---- harness-level tabs: this page is a general UI testing surface, not
// just the cube. Each pane is independently iterable. ----
const HARNESS_TABS = ["cube", "ui"] as const;
HARNESS_TABS.forEach((tab) => {
  document.getElementById(`htab-${tab}`)!.addEventListener("click", () => {
    HARNESS_TABS.forEach((t) => {
      document.getElementById(`htab-${t}`)!.classList.toggle("active", t === tab);
      document.getElementById(`pane-${t}`)!.classList.toggle("hide", t !== tab);
    });
  });
});

// ---- Letter Input testing pane: always has a question ready ----
const letterInput = createLetterInput(defaultLetterInputMode());
document.getElementById("uiAnswerHost")!.appendChild(letterInput.element);
document.getElementById("uiDefaultMode")!.textContent = defaultLetterInputMode();

const uiCurrent = document.getElementById("uiCurrent")!;
const uiLog = document.getElementById("uiLog")!;
let uiQuestion: { kind: Kind; letter: string } | null = null;

function randomLetter(): string {
  return String.fromCharCode(65 + Math.floor(Math.random() * 24));
}
function askUi(): void {
  const kind: Kind = Math.random() < 0.5 ? "corner" : "edge";
  const letter = randomLetter();
  uiQuestion = { kind, letter };
  uiCurrent.textContent = `asked: ${kind} ${letter} (mode=${letterInput.getMode()})`;
  letterInput.ask(kind, letter);
}
letterInput.onAnswer((result) => {
  const row = document.createElement("div");
  row.className = result.correct ? "correct" : "wrong";
  const q = uiQuestion;
  row.textContent = `${q ? `${q.kind} ${q.letter}` : "?"} — mode=${letterInput.getMode()} said=${result.said ?? "(none)"} gaveUp=${result.gaveUp} → ${result.correct ? "correct" : "wrong"}`;
  uiLog.prepend(row);
  setTimeout(askUi, 400);
});
askUi();
