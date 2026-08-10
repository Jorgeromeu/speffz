// X-ray markers: a marked sticker on a face turned away from the camera is
// drawn through the cube as a dashed ghost of the same colour, plus dim
// outlines for the rest of that face for spatial context. This is the part
// CLAUDE.md flags as buggy (black-square ghost, desktop/mobile divergence),
// so it's kept as a faithful, careful port rather than a rewrite.
import * as THREE from "three";
import { FACES, type FaceKey } from "../cube/faces";
import type { Cube, Kind, Sticker } from "../cube/state";
import { RING_COLOUR, type Mark, type Tile } from "./tiles";
import { TEX, TILE } from "./constants";

interface GhostVisual {
  readonly mesh: THREE.Mesh;
  readonly ctx: CanvasRenderingContext2D;
  readonly tex: THREE.CanvasTexture;
  readonly label: THREE.Mesh;
  readonly lctx: CanvasRenderingContext2D;
  readonly ltex: THREE.CanvasTexture;
  readonly kind: Mark;
  drawnBare: boolean | null;
  drawnLetter: string | null;
}

function makeGhostVisual(kind: Mark, scene: THREE.Scene): GhostVisual {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TEX;
  const ctx = canvas.getContext("2d")!;
  const tex = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(TILE, TILE),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
  );
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = 20;
  mesh.visible = false;
  scene.add(mesh);

  const lcanvas = document.createElement("canvas");
  lcanvas.width = lcanvas.height = TEX;
  const lctx = lcanvas.getContext("2d")!;
  const ltex = new THREE.CanvasTexture(lcanvas);
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(TILE * 0.86, TILE * 0.86),
    new THREE.MeshBasicMaterial({ map: ltex, transparent: true, depthTest: false, depthWrite: false }),
  );
  label.renderOrder = 22;
  label.visible = false;
  scene.add(label);

  return { mesh, ctx, tex, label, lctx, ltex, kind, drawnBare: null, drawnLetter: null };
}

function paintGhostRing(g: GhostVisual, bare: boolean): void {
  if (g.drawnBare === bare) return;
  g.drawnBare = bare;
  const c = g.ctx;
  const T = TEX;
  const o = 20;
  const r = 30;
  c.clearRect(0, 0, T, T);
  function path() {
    c.beginPath();
    c.moveTo(o + r, o);
    c.arcTo(T - o, o, T - o, T - o, r);
    c.arcTo(T - o, T - o, o, T - o, r);
    c.arcTo(o, T - o, o, o, r);
    c.arcTo(o, o, T - o, o, r);
    c.closePath();
  }
  c.setLineDash([30, 20]);
  path();
  c.lineWidth = 30;
  c.strokeStyle = "rgba(8,10,14,.55)";
  c.stroke();
  path();
  c.lineWidth = 17;
  c.strokeStyle = RING_COLOUR[g.kind];
  c.stroke();
  c.setLineDash([]);
  if (bare) {
    c.beginPath();
    c.arc(T / 2, T / 2, 15, 0, 6.284);
    c.fillStyle = "rgba(8,10,14,.55)";
    c.fill();
    c.beginPath();
    c.arc(T / 2, T / 2, 9, 0, 6.284);
    c.fillStyle = RING_COLOUR[g.kind];
    c.fill();
  }
  g.tex.needsUpdate = true;
}

function paintGhostLabel(g: GhostVisual, letter: string): void {
  if (g.drawnLetter === letter) return;
  g.drawnLetter = letter;
  const c = g.lctx;
  const T = TEX;
  c.clearRect(0, 0, T, T);
  if (letter) {
    c.font = '700 168px "Avenir Next","Helvetica Neue",Helvetica,Arial,sans-serif';
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.lineJoin = "round";
    c.lineWidth = 22;
    c.strokeStyle = "rgba(8,10,14,.78)";
    c.strokeText(letter, T / 2, T / 2 + 6);
    c.fillStyle = RING_COLOUR[g.kind];
    c.fillText(letter, T / 2, T / 2 + 6);
  }
  g.ltex.needsUpdate = true;
}

function outlineTexture(fill: string | null, line: string, weight: number): THREE.CanvasTexture {
  const T = TEX;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = T;
  const c = canvas.getContext("2d")!;
  const o = 22;
  const r = 28;
  function path() {
    c.beginPath();
    c.moveTo(o + r, o);
    c.arcTo(T - o, o, T - o, T - o, r);
    c.arcTo(T - o, T - o, o, T - o, r);
    c.arcTo(o, T - o, o, o, r);
    c.arcTo(o, o, T - o, o, r);
    c.closePath();
  }
  if (fill) {
    path();
    c.fillStyle = fill;
    c.fill();
  }
  path();
  c.lineWidth = weight + 8;
  c.strokeStyle = "rgba(8,10,14,.32)";
  c.stroke();
  path();
  c.lineWidth = weight;
  c.strokeStyle = line;
  c.stroke();
  return new THREE.CanvasTexture(canvas);
}

function ghostMaterial(tex: THREE.CanvasTexture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
}

export interface GhostState {
  camera: THREE.Camera;
  mark(sticker: Sticker): Mark | null;
  revealed(sticker: Sticker): boolean;
  /** true shows every marked sticker's letter regardless of `revealed` */
  peek: boolean;
  /** highlights a whole face with a tinted outline (the "learn" face-select) */
  faceHighlight: FaceKey | null;
  /** whether the dim context squares also show a pale letter label */
  showContextLabels: boolean;
  /** gates dimLabel visibility per corner/edge, matching original's show[kind] */
  showKind(kind: Kind): boolean;
}

export interface Ghosts {
  /** returns true if anything was drawn (a ghost, a highlight, or context squares) */
  update(state: GhostState): boolean;
}

export function buildGhosts(cube: Cube, tiles: readonly Tile[], scene: THREE.Scene): Ghosts {
  const tileOf = new Map<Sticker, Tile>();
  tiles.forEach((t) => tileOf.set(t.sticker, t));

  const kinds: readonly Mark[] = ["ask", "good", "bad"];
  const ghostByKind = new Map<Mark, GhostVisual>();
  kinds.forEach((kind) => ghostByKind.set(kind, makeGhostVisual(kind, scene)));

  const dimGeo = new THREE.PlaneGeometry(TILE, TILE);
  const NEUTRAL = ghostMaterial(outlineTexture(null, "rgba(226,232,242,.30)", 8));
  const TINT = new Map<FaceKey, THREE.MeshBasicMaterial>();
  (Object.keys(FACES) as FaceKey[]).forEach((key) => {
    const c = new THREE.Color(FACES[key].col);
    const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
    TINT.set(key, ghostMaterial(outlineTexture(`rgba(${rgb},.22)`, `rgba(${rgb},.85)`, 10)));
  });

  const dim = new Map<Sticker, THREE.Mesh>();
  const dimLabel = new Map<Sticker, THREE.Mesh>();
  tiles.forEach((tile) => {
    const m = new THREE.Mesh(dimGeo, NEUTRAL);
    m.matrixAutoUpdate = false;
    m.matrix.copy(tile.mesh.matrix);
    m.renderOrder = 15;
    m.visible = false;
    scene.add(m);
    dim.set(tile.sticker, m);

    if (!tile.letter) return;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.font = '700 84px "Avenir Next","Helvetica Neue",Helvetica,Arial,sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 12;
    ctx.strokeStyle = "rgba(8,10,14,.8)";
    ctx.strokeText(tile.letter, 64, 67);
    ctx.fillStyle = "#e6ebf5";
    ctx.fillText(tile.letter, 64, 67);
    const lab = new THREE.Mesh(
      new THREE.PlaneGeometry(TILE * 0.74, TILE * 0.74),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(canvas),
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    lab.position.setFromMatrixPosition(tile.mesh.matrix);
    lab.renderOrder = 21;
    lab.visible = false;
    scene.add(lab);
    dimLabel.set(tile.sticker, lab);
  });

  function update(state: GhostState): boolean {
    kinds.forEach((k) => {
      const g = ghostByKind.get(k)!;
      g.mesh.visible = false;
      g.label.visible = false;
    });
    dim.forEach((m) => {
      m.visible = false;
    });
    dimLabel.forEach((m) => {
      m.visible = false;
    });

    let shown = false;
    const dir = state.camera.position.clone().normalize();
    const touchedFaces = new Set<FaceKey>();

    cube.stickers.forEach((s) => {
      const mark = state.mark(s);
      if (!mark) return;
      const nrm = new THREE.Vector3(...s.nrm);
      if (nrm.dot(dir) >= 0.14) return; // already turned toward us
      const g = ghostByKind.get(mark)!;
      const lit = state.revealed(s) || state.peek;
      paintGhostRing(g, !lit);
      const tile = tileOf.get(s)!;
      g.mesh.matrix.copy(tile.mesh.matrix);
      g.mesh.visible = true;
      shown = true;
      if (lit) {
        paintGhostLabel(g, tile.letter);
        g.label.position.setFromMatrixPosition(tile.mesh.matrix);
        g.label.quaternion.copy(state.camera.quaternion as THREE.Quaternion);
        g.label.visible = true;
      }
      touchedFaces.add(s.home);
    });

    if (state.faceHighlight) {
      const highlight = state.faceHighlight;
      cube.stickers.forEach((s) => {
        if (s.home !== highlight) return;
        const m = dim.get(s)!;
        m.material = TINT.get(highlight)!;
        m.visible = true;
        shown = true;
      });
    }

    if (touchedFaces.size) {
      cube.stickers.forEach((s) => {
        if (!state.mark(s) && touchedFaces.has(s.home)) {
          const m = dim.get(s)!;
          m.material = NEUTRAL;
          m.visible = true;
          shown = true;
        }
      });
    }

    if (state.showContextLabels) {
      cube.stickers.forEach((s) => {
        const lab = dimLabel.get(s);
        const m = dim.get(s)!;
        if (!lab || !m.visible || !state.showKind(s.kind)) return;
        lab.quaternion.copy(state.camera.quaternion as THREE.Quaternion);
        lab.visible = true;
      });
    }

    return shown;
  }

  return { update };
}
