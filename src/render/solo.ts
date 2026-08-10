// Isolated single-piece view for the "piece" drill: one corner or edge
// cubie shown alone, reoriented so the asked sticker always faces "up" in
// a consistent canonical pose, with a mark ring + letter label overlaid.
//
// The piece drill never scrambles (see CLAUDE.md / original: every tab
// switch calls solve() first, and piece never calls scramble()), so a
// cubie's colours are fixed by which direction each face points — this is
// why geometry can be built once per cell and cached, using direction
// colours rather than tracking current sticker.cur.
import * as THREE from "three";
import { FACES, faceOf, type Axis, type Sign } from "../cube/faces";
import { ringOf, type Cube, type Sticker } from "../cube/state";
import { CORE_COLOUR, H, TEX, TILE } from "./constants";
import { DIRS, emitCubie, type V3 } from "./geometry";
import { RING_COLOUR, type Mark } from "./tiles";

const DIR_COLOUR: readonly THREE.Color[] = DIRS.map(([axis, sign]) => new THREE.Color(faceOf(axis, sign).col));
const CORE = new THREE.Color(CORE_COLOUR);

function toV3(v: readonly [number, number, number]): V3 {
  return [v[0], v[1], v[2]];
}

function buildPieceGeometry(cell: V3): THREE.BufferGeometry {
  const positions: number[] = [];
  const colours: number[] = [];
  function soloTag(axis: Axis, sign: Sign): number {
    if (cell[axis] !== sign) return -1;
    return DIRS.findIndex(([a, s]) => a === axis && s === sign);
  }
  emitCubie(cell, soloTag, (p, slot) => {
    positions.push(p[0] - cell[0], p[1] - cell[1], p[2] - cell[2]);
    const c = slot >= 0 ? DIR_COLOUR[slot] : CORE;
    colours.push(c.r, c.g, c.b);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  return geometry;
}

function ringTexture(mark: Mark): THREE.CanvasTexture {
  const T = TEX;
  const o = 16;
  const r = 30;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = T;
  const c = canvas.getContext("2d")!;
  function path() {
    c.beginPath();
    c.moveTo(o + r, o);
    c.arcTo(T - o, o, T - o, T - o, r);
    c.arcTo(T - o, T - o, o, T - o, r);
    c.arcTo(o, T - o, o, o, r);
    c.arcTo(o, o, T - o, o, r);
    c.closePath();
  }
  path();
  c.lineWidth = 30;
  c.strokeStyle = "rgba(8,10,14,.5)";
  c.stroke();
  path();
  c.lineWidth = 17;
  c.strokeStyle = RING_COLOUR[mark];
  c.stroke();
  return new THREE.CanvasTexture(canvas);
}

export interface SoloView {
  readonly group: THREE.Group;
  show(sticker: Sticker, mark: Mark, letter: string): void;
  hide(): void;
  /** billboards the label toward the camera; call once per frame */
  tick(camera: THREE.Camera): void;
}

export function buildSoloView(cube: Cube, scene: THREE.Scene): SoloView {
  const geometryCache = new Map<string, THREE.BufferGeometry>();
  function geometryFor(cell: V3): THREE.BufferGeometry {
    const key = cell.join(",");
    let g = geometryCache.get(key);
    if (!g) {
      g = buildPieceGeometry(cell);
      geometryCache.set(key, g);
    }
    return g;
  }

  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const mesh = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  );
  group.add(mesh);

  const ringMaterials = new Map<Mark, THREE.MeshBasicMaterial>();
  (["ask", "good", "bad"] as const).forEach((m) => {
    ringMaterials.set(m, new THREE.MeshBasicMaterial({ map: ringTexture(m), transparent: true, depthWrite: false }));
  });
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(TILE, TILE), ringMaterials.get("ask")!);
  ring.renderOrder = 6;
  ring.matrixAutoUpdate = false;
  group.add(ring);

  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = labelCanvas.height = TEX;
  const labelCtx = labelCanvas.getContext("2d")!;
  const labelTex = new THREE.CanvasTexture(labelCanvas);
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(TILE * 0.8, TILE * 0.8),
    new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, depthTest: false, depthWrite: false }),
  );
  label.renderOrder = 24;
  label.visible = false;
  scene.add(label);

  let labelAnchor = new THREE.Vector3();
  let drawnLabel: string | null = null;
  function paintLabel(letter: string, mark: Mark): void {
    const tag = `${letter}|${mark}`;
    if (drawnLabel === tag) return;
    drawnLabel = tag;
    const c = labelCtx;
    const T = TEX;
    c.clearRect(0, 0, T, T);
    if (letter) {
      c.font = '700 168px "Avenir Next","Helvetica Neue",Helvetica,Arial,sans-serif';
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.lineJoin = "round";
      c.lineWidth = 22;
      c.strokeStyle = "rgba(8,10,14,.8)";
      c.strokeText(letter, T / 2, T / 2 + 6);
      c.fillStyle = RING_COLOUR[mark];
      c.fillText(letter, T / 2, T / 2 + 6);
    }
    labelTex.needsUpdate = true;
  }

  const AX = new THREE.Vector3(1, 0, 0);
  const AY = new THREE.Vector3(0, 1, 0);
  const AZ = new THREE.Vector3(0, 0, 1);

  function show(sticker: Sticker, mark: Mark, letter: string): void {
    mesh.geometry = geometryFor(toV3(sticker.cell));

    // Whole-piece rotation taking the ringed sticker's normal to world +Y
    // and the next ring member to +X, so it always reads like looking at
    // the URF corner of a solved cube, regardless of which cell it's from.
    const ringStickers = ringOf(cube, sticker);
    const a = new THREE.Vector3(...sticker.nrm);
    const b = new THREE.Vector3(...ringStickers[1].nrm);
    const c = sticker.kind === "corner" ? new THREE.Vector3(...ringStickers[2].nrm) : a.clone().cross(b);
    const src = new THREE.Matrix4().makeBasis(a, b, c).transpose();
    const dst = new THREE.Matrix4().makeBasis(AY, AX, sticker.kind === "corner" ? AZ : AZ.clone().negate());
    group.quaternion.setFromRotationMatrix(dst.multiply(src));

    const home = FACES[sticker.home];
    const n = new THREE.Vector3(...sticker.nrm);
    const up = new THREE.Vector3(...home.up);
    const rt = new THREE.Vector3(...home.rt);
    ring.matrix.copy(new THREE.Matrix4().makeBasis(rt, up, n).setPosition(n.clone().multiplyScalar(H + 0.004)));
    ring.material = ringMaterials.get(mark)!;

    labelAnchor = n.clone().multiplyScalar(H + 0.06);
    paintLabel(letter, mark);
    label.visible = !!letter;
    group.visible = true;
  }

  function hide(): void {
    group.visible = false;
    label.visible = false;
  }

  function tick(camera: THREE.Camera): void {
    if (!label.visible) return;
    label.position.copy(labelAnchor).applyQuaternion(group.quaternion);
    label.quaternion.copy(camera.quaternion);
  }

  return { group, show, hide, tick };
}
