// Letter tiles: one canvas-textured plane per sticker (including centers,
// which just show plastic colour with no letter — matches the original,
// which builds all 54 uniformly rather than special-casing 6 of them).
//
// Position is a closed form, not the original's row/col walk: a tile's
// centre is `cell + normal*(H + 0.002)`, since `cell` already encodes
// `normal + up*(1-row) + rt*(col-1)` for whatever row/col it was built
// from (see speffz/letters.ts's rowColOf, the inverse of this same fact).
import * as THREE from "three";
import { FACES, type FaceKey } from "../cube/faces";
import type { Cube, Sticker } from "../cube/state";
import { H, TEX, TILE } from "./constants";

export type Mark = "ask" | "good" | "bad";
export const RING_COLOUR: Readonly<Record<Mark, string>> = { ask: "#f0b429", good: "#4bc172", bad: "#e05360" };

const SOFT: Record<FaceKey, string> = {} as Record<FaceKey, string>;
(Object.keys(FACES) as FaceKey[]).forEach((key) => {
  const f = FACES[key];
  SOFT[key] = "#" + new THREE.Color(f.col).lerp(new THREE.Color(f.ink), 0.2).getHexString();
});

export interface Tile {
  readonly sticker: Sticker;
  readonly letter: string;
  readonly mesh: THREE.Mesh;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
}

export interface TileVisual {
  /** show the letter at full ink strength */
  lit: boolean;
  /** show the letter faded into the plastic, when not lit (a grid is showing) */
  faint: boolean;
  mark: Mark | null;
}

export function buildTiles(cube: Cube, letterOf: (sticker: Sticker) => string): Tile[] {
  return cube.stickers.map((s) => {
    const home = FACES[s.home];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = TEX;
    const ctx = canvas.getContext("2d")!;
    const texture = new THREE.CanvasTexture(canvas);
    // DoubleSide isn't for visual appearance (the plastic body behind each
    // tile means its backside is never actually seen) — it's so raycasting
    // still hits a tile whose face points away from the camera, which
    // matters for l2s: a face narrowed via the net can be on the far,
    // x-rayed side of the cube, and its tiles must still be tappable there.
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(TILE, TILE),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
    );

    const nv = new THREE.Vector3(...s.nrm);
    const up = new THREE.Vector3(...home.up);
    const rt = new THREE.Vector3(...home.rt);
    mesh.matrix.copy(
      new THREE.Matrix4()
        .makeBasis(rt, up, nv)
        .setPosition(new THREE.Vector3(...s.cell).addScaledVector(nv, H + 0.002)),
    );
    mesh.matrixAutoUpdate = false;
    mesh.userData.sticker = s;

    const tile: Tile = { sticker: s, letter: letterOf(s), mesh, ctx, texture };
    paintTile(tile, s.home, { lit: true, faint: false, mark: null });
    return tile;
  });
}

export function paintTile(tile: Tile, cur: FaceKey, visual: TileVisual): void {
  const { ctx } = tile;
  const face = FACES[cur];
  ctx.fillStyle = face.col;
  ctx.fillRect(0, 0, TEX, TEX);

  if (tile.letter && (visual.lit || visual.faint)) {
    ctx.fillStyle = visual.lit ? face.ink : SOFT[cur];
    ctx.font = '700 176px "Avenir Next","Helvetica Neue",Helvetica,Arial,sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(tile.letter, 128, 140);
  }
  if (visual.mark) {
    const w = 20;
    const o = w / 2 + 2;
    const r = 26;
    ctx.lineWidth = w;
    ctx.strokeStyle = RING_COLOUR[visual.mark];
    ctx.beginPath();
    ctx.moveTo(o + r, o);
    ctx.arcTo(TEX - o, o, TEX - o, TEX - o, r);
    ctx.arcTo(TEX - o, TEX - o, o, TEX - o, r);
    ctx.arcTo(o, TEX - o, o, o, r);
    ctx.arcTo(o, o, TEX - o, o, r);
    ctx.closePath();
    ctx.stroke();
  }
  tile.texture.needsUpdate = true;
}
