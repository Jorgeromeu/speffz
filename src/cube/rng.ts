// Seedable PRNG, so a scramble or drill draw is reproducible from a URL seed
// (see CLAUDE.md "Two things to build early, before touching the view").
// mulberry32 — small, fast, good enough statistical quality for this use.

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** seeded Math.random()-shaped source for callers that don't need reproducibility */
export const defaultRng: Rng = Math.random;

export function randInt(rng: Rng, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive);
}

/** Fisher-Yates, in place */
export function shuffle<T>(list: T[], rng: Rng): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    const t = list[i];
    list[i] = list[j];
    list[j] = t;
  }
  return list;
}
