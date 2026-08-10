// Shared question-pool helpers for the sticker-based drills (s2l, l2s;
// trace later). Pure, no DOM/three.js — just selection over cube state,
// filtered by whichever corner/edge visibility rule the caller supplies.
import type { Cube, Kind, Sticker } from "../cube/state";

export function freshPool(cube: Cube, showKind: (kind: Kind) => boolean): Sticker[] {
  return cube.stickers.filter((s) => s.kind !== "center" && showKind(s.kind));
}

export function pickRandom<T>(pool: readonly T[]): T | null {
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}
