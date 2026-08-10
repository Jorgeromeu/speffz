// Old Pochmann memo validation. An OP shoot is a transposition on the 24
// stickers of one orbit, so a full memo can be simulated without turning
// anything — see CLAUDE.md "Memo validation — the subtle part".
//
// dest[i] = home letter-index of the sticker now sitting at letter i's
// location. Memo is complete when dest is the identity. A shoot swaps
// whole pieces (ring-to-ring, cyclic offset), not single stickers — that
// was bug #1. The buffer can never be shot at, including a twisted buffer
// pointing at its own other stickers — that was bug #2.

import type { Cube, Kind } from "../cube/state";
import { ringOf, target } from "../cube/state";
import { type Letters, letterAt, letterIndex } from "./letters";

/** letter-index rings, one per letter 0-23: ring[i] = that sticker's cubie,
 *  self first, clockwise seen from outside. Static — positions don't move. */
export type Rings = readonly (readonly number[])[];

export function buildRings(cube: Cube, letters: Letters, kind: Exclude<Kind, "center">): Rings {
  const rings: number[][] = [];
  for (let i = 0; i < 24; i++) {
    const sticker = letters.stickerFor(kind, letterAt(i));
    rings[i] = ringOf(cube, sticker).map((m) => letterIndex(letters.letterOf(m)));
  }
  return rings;
}

export function computeDest(cube: Cube, letters: Letters, kind: Exclude<Kind, "center">): number[] {
  const dest: number[] = [];
  for (let i = 0; i < 24; i++) {
    const sticker = letters.stickerFor(kind, letterAt(i));
    dest[i] = letterIndex(letters.letterOf(target(cube, sticker)));
  }
  return dest;
}

export function isSettled(dest: readonly number[]): boolean {
  return dest.every((v, i) => v === i);
}

export function inBuffer(rings: Rings, bufferIndex: number, i: number): boolean {
  return rings[bufferIndex].includes(i);
}

/** the one letter the buffer is forced to shoot to mid-cycle, or -1 to break in */
export function forced(dest: readonly number[], rings: Rings, bufferIndex: number): number {
  const d = dest[bufferIndex];
  return d !== bufferIndex && !inBuffer(rings, bufferIndex, d) ? d : -1;
}

/** shoots buffer -> target: swaps whole pieces, aligning the two targeted
 *  stickers, with the rest of each ring following by cyclic offset */
export function shoot(dest: number[], rings: Rings, bufferIndex: number, targetIndex: number): void {
  const bufferRing = rings[bufferIndex];
  const targetRing = rings[targetIndex];
  for (let k = 0; k < bufferRing.length; k++) {
    const a = bufferRing[k];
    const x = targetRing[k];
    const t = dest[a];
    dest[a] = dest[x];
    dest[x] = t;
  }
}

export type Judgement =
  | { readonly verdict: "accept" }
  | { readonly verdict: "reject"; readonly reason: "on-buffer" | "wrong-target" | "already-solved"; readonly forced?: number };

/** the three rules the validator enforces — judge state, never a stored solution */
export function judge(dest: readonly number[], rings: Rings, bufferIndex: number, letter: number): Judgement {
  if (inBuffer(rings, bufferIndex, letter)) return { verdict: "reject", reason: "on-buffer" };
  const f = forced(dest, rings, bufferIndex);
  if (f >= 0) {
    return letter === f ? { verdict: "accept" } : { verdict: "reject", reason: "wrong-target", forced: f };
  }
  if (dest[letter] === letter) return { verdict: "reject", reason: "already-solved" };
  return { verdict: "accept" };
}

/** always exists (no unique correct memo), used to prove a memo can always
 *  be completed: follow the forced letter when there is one, else break
 *  into the lowest-index unsolved, off-buffer letter. */
export function solveCanonical(
  dest: readonly number[],
  rings: Rings,
  bufferIndex: number,
  maxSteps = 100,
): number[] {
  const d = dest.slice();
  const seq: number[] = [];
  while (!isSettled(d)) {
    if (seq.length > maxSteps) {
      throw new Error("canonical solver did not settle within maxSteps");
    }
    const f = forced(d, rings, bufferIndex);
    let choice = f;
    if (choice < 0) {
      choice = -1;
      for (let i = 0; i < d.length; i++) {
        if (i === bufferIndex || inBuffer(rings, bufferIndex, i) || d[i] === i) continue;
        choice = i;
        break;
      }
      if (choice < 0) break; // nothing left to break into; isSettled should already be true
    }
    shoot(d, rings, bufferIndex, choice);
    seq.push(choice);
  }
  return seq;
}
