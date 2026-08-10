// Generic 3x3 cube state engine. Positions are fixed; colours move — a
// sticker's (cell, normal) never changes, only which face's colour (`cur`)
// currently sits there. This is the dual of the usual piece-permutation
// cube model, chosen because it's what lets a labelling scheme (Speffz or
// otherwise) say "letter A labels this location" rather than "letter A
// labels this piece". See CLAUDE.md "Cube state model".
//
// Nothing here knows about letters, buffers, or BLD — see src/speffz for
// that layer.

import { type Axis, type FaceKey, type Sign, type Vec3, DIRS, faceOf, moveIndex, moveTimes, moveName } from "./faces";
import { type Rng, defaultRng, randInt } from "./rng";

export type Kind = "corner" | "edge" | "center";

export interface Sticker {
  /** fixed cubie position, entries in {-1,0,1}; never changes */
  readonly cell: Vec3;
  /** fixed outward normal at this position; never changes */
  readonly nrm: Vec3;
  /** the face this position was cut from; never changes */
  readonly home: FaceKey;
  /** corner | edge | center, derived from cell; never changes */
  readonly kind: Kind;
  /** which face's colour currently sits here — this is what a turn moves */
  cur: FaceKey;
}

export interface Cube {
  readonly stickers: readonly Sticker[];
  /** "cell|normal" -> sticker, for turn lookups */
  readonly byPos: ReadonlyMap<string, Sticker>;
  /** "cell" -> that cubie's stickers, for piece-tracing and ring order */
  readonly cubieAt: ReadonlyMap<string, readonly Sticker[]>;
  /** sorted home-colour-set key -> cell key, static regardless of scramble state */
  readonly cubieByColourSet: ReadonlyMap<string, string>;
}

function cellKey(cell: Vec3): string {
  return cell.join(",");
}
function posKey(cell: Vec3, nrm: Vec3): string {
  return `${cellKey(cell)}|${nrm.join(",")}`;
}
function kindOf(cell: Vec3): Kind {
  const nonzero = cell.filter((c) => c !== 0).length;
  return nonzero === 3 ? "corner" : nonzero === 2 ? "edge" : "center";
}
function colourSetKey(faces: readonly FaceKey[]): string {
  return faces.slice().sort().join("");
}

export function createCube(): Cube {
  const stickers: Sticker[] = [];
  for (let cx = -1; cx <= 1; cx++) {
    for (let cy = -1; cy <= 1; cy++) {
      for (let cz = -1; cz <= 1; cz++) {
        const cell: Vec3 = [cx, cy, cz];
        if (cx === 0 && cy === 0 && cz === 0) continue; // core, no stickers
        const kind = kindOf(cell);
        ([0, 1, 2] as const).forEach((axis) => {
          if (cell[axis] === 0) return;
          const sign = cell[axis] as Sign;
          const nrm: Vec3 = axis === 0 ? [sign, 0, 0] : axis === 1 ? [0, sign, 0] : [0, 0, sign];
          const home = faceOf(axis, sign).key;
          stickers.push({ cell, nrm, home, kind, cur: home });
        });
      }
    }
  }

  const byPos = new Map<string, Sticker>();
  stickers.forEach((s) => byPos.set(posKey(s.cell, s.nrm), s));

  const cubieAt = new Map<string, Sticker[]>();
  stickers.forEach((s) => {
    if (s.kind === "center") return;
    const k = cellKey(s.cell);
    let list = cubieAt.get(k);
    if (!list) {
      list = [];
      cubieAt.set(k, list);
    }
    list.push(s);
  });

  const cubieByColourSet = new Map<string, string>();
  cubieAt.forEach((mates, k) => {
    cubieByColourSet.set(colourSetKey(mates.map((s) => s.home)), k);
  });

  return { stickers, byPos, cubieAt, cubieByColourSet };
}

function spin(v: Vec3, n: Vec3): Vec3 {
  const dot = n[0] * v[0] + n[1] * v[1] + n[2] * v[2];
  return [
    n[0] * dot - (n[1] * v[2] - n[2] * v[1]),
    n[1] * dot - (n[2] * v[0] - n[0] * v[2]),
    n[2] * dot - (n[0] * v[1] - n[1] * v[0]),
  ];
}

/** one quarter turn of the layer at cell[axis] === sign, clockwise viewed from outside */
function quarterTurn(cube: Cube, axis: Axis, sign: Sign): void {
  const n: Vec3 = axis === 0 ? [sign, 0, 0] : axis === 1 ? [0, sign, 0] : [0, 0, sign];
  const moved: [Sticker, FaceKey][] = [];
  cube.stickers.forEach((s) => {
    if (s.cell[axis] !== sign) return;
    const dest = cube.byPos.get(posKey(spin(s.cell, n), spin(s.nrm, n)));
    if (dest) moved.push([dest, s.cur]);
  });
  moved.forEach(([dest, cur]) => {
    dest.cur = cur;
  });
}

export function turn(cube: Cube, axis: Axis, sign: Sign, times = 1): void {
  for (let t = 0; t < times; t++) quarterTurn(cube, axis, sign);
}

export function applyMove(cube: Cube, name: string): void {
  const i = moveIndex(name);
  turn(cube, DIRS[i][0], DIRS[i][1], moveTimes(name));
}

export function applyAlg(cube: Cube, alg: string): void {
  alg.split(/\s+/).filter(Boolean).forEach((tok) => applyMove(cube, tok));
}

export function invertAlg(alg: string): string {
  return alg
    .split(/\s+/)
    .filter(Boolean)
    .reverse()
    .map((tok) => moveName(moveIndex(tok), 4 - moveTimes(tok)))
    .join(" ");
}

export function solve(cube: Cube): void {
  cube.stickers.forEach((s) => {
    s.cur = s.home;
  });
}

export function isSolved(cube: Cube): boolean {
  return cube.stickers.every((s) => s.cur === s.home);
}

/** 20 random turns, no two consecutive moves sharing an axis */
export function scramble(cube: Cube, rng: Rng = defaultRng, count = 20): string {
  let last = -1;
  const moves: string[] = [];
  for (let i = 0; i < count; i++) {
    let d: number;
    do {
      d = randInt(rng, DIRS.length);
    } while (d >> 1 === last >> 1);
    last = d;
    const times = 1 + randInt(rng, 3);
    turn(cube, DIRS[d][0], DIRS[d][1], times);
    moves.push(moveName(d, times));
  }
  return moves.join(" ");
}

/** the cubie's stickers, self first, in clockwise order seen from outside */
export function ringOf(cube: Cube, sticker: Sticker): Sticker[] {
  const mates = cube.cubieAt.get(cellKey(sticker.cell)) ?? [];
  const rest = mates.filter((m) => m !== sticker);
  if (rest.length === 2 && det3(sticker.nrm, rest[0].nrm, rest[1].nrm) > 0) {
    return [sticker, rest[1], rest[0]];
  }
  return [sticker, ...rest];
}

function det3(a: Vec3, b: Vec3, c: Vec3): number {
  return (
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0])
  );
}

/** the sticker at an exact (cell, normal), if that position exists */
export function stickerAt(cube: Cube, cell: Vec3, nrm: Vec3): Sticker | undefined {
  return cube.byPos.get(posKey(cell, nrm));
}

/** where does the piece sitting at `buffer`'s location need to go? */
export function target(cube: Cube, buffer: Sticker): Sticker {
  const here = cube.cubieAt.get(cellKey(buffer.cell)) ?? [];
  const home = cube.cubieByColourSet.get(colourSetKey(here.map((s) => s.cur)));
  const homeStickers = home ? cube.cubieAt.get(home) ?? [] : [];
  const dest = homeStickers.find((s) => s.home === buffer.cur);
  if (!dest) throw new Error("target(): cube state has no matching home cubie — is it a valid permutation?");
  return dest;
}
