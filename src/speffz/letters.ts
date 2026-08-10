// Speffz lettering, built on top of the generic cube in src/cube. A letter
// labels a *location*, not a piece — see CLAUDE.md "Domain conventions".
//
// Per face, letters run clockwise from the top-left sticker seen face-on.
// Faces in order U L F R B D -> letter-block offsets 0, 4, 8, 12, 16, 20.
// Corners and edges are two independent A-X sets: letter A is both a corner
// sticker (UBL) and an edge sticker (UB).

import { FACES, type FaceKey, type Vec3 } from "../cube/faces";
import type { Cube, Kind, Sticker } from "../cube/state";

// Sticker position within a face, by (row, col) with row 0 at top.
// corners (0,0) (0,2) (2,2) (2,0) -> offset + 0,1,2,3
// edges   (0,1) (1,2) (2,1) (1,0) -> offset + 0,1,2,3
export const CORNER: Readonly<Record<string, number>> = { "0,0": 0, "0,2": 1, "2,2": 2, "2,0": 3 };
export const EDGE: Readonly<Record<string, number>> = { "0,1": 0, "1,2": 1, "2,1": 2, "1,0": 3 };

export const LETTER_BLOCK: Readonly<Record<FaceKey, number>> = {
  U: 0, L: 4, Fr: 8, R: 12, B: 16, D: 20,
};

export function letterIndex(letter: string): number {
  return letter.charCodeAt(0) - 65;
}
export function letterAt(index: number): string {
  return String.fromCharCode(65 + index);
}

/** a sticker's (row, col) on its home face, derived from its fixed position */
export function rowColOf(sticker: Sticker): [number, number] {
  const face = FACES[sticker.home];
  const local: Vec3 = [
    sticker.cell[0] - sticker.nrm[0],
    sticker.cell[1] - sticker.nrm[1],
    sticker.cell[2] - sticker.nrm[2],
  ];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return [1 - dot(local, face.up), 1 + dot(local, face.rt)];
}

/** the permanent Speffz letter for a sticker's location, "" for centers */
export function letterOfSticker(sticker: Sticker): string {
  if (sticker.kind === "center") return "";
  const [row, col] = rowColOf(sticker);
  const k = `${row},${col}`;
  const off = LETTER_BLOCK[sticker.home];
  if (k in CORNER) return letterAt(off + CORNER[k]);
  if (k in EDGE) return letterAt(off + EDGE[k]);
  return "";
}

export interface Letters {
  letterOf(sticker: Sticker): string;
  stickerFor(kind: Exclude<Kind, "center">, letter: string): Sticker;
}

/** builds the letter <-> sticker index once for a cube's (fixed) positions */
export function buildLetters(cube: Cube): Letters {
  const byKey = new Map<string, Sticker>();
  const letterOfCache = new Map<Sticker, string>();
  cube.stickers.forEach((s) => {
    if (s.kind === "center") return;
    const letter = letterOfSticker(s);
    letterOfCache.set(s, letter);
    byKey.set(s.kind[0] + letter, s);
  });
  return {
    letterOf: (s) => letterOfCache.get(s) ?? "",
    stickerFor: (kind, letter) => {
      const s = byKey.get(kind[0] + letter);
      if (!s) throw new Error(`no ${kind} sticker for letter ${letter}`);
      return s;
    },
  };
}
