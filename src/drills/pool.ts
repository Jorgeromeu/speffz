// Shared question-pool helpers for the sticker-based drills (s2l, l2s,
// piece; trace later). Pure, no DOM/three.js — just selection over cube
// state through the one pool rule below.
//
// The pool filter is two orthogonal axes (corner/edge × face — see
// docs/CONVENTIONS.md "Face pool filter"), and every drill has to apply
// both. Keeping the rule here rather than inside the controls widget means
// it's testable without a DOM, and there is exactly one definition of
// "which stickers can be asked about" for all four drills to share.
import { KEYS, type FaceKey } from "../cube/faces";
import type { Cube, Sticker } from "../cube/state";

export interface PoolFilter {
  readonly corners: boolean;
  readonly edges: boolean;
  /** faces the pool may draw from; all six = no face filter */
  readonly faces: ReadonlySet<FaceKey>;
}

export const NO_POOL_FILTER: PoolFilter = { corners: true, edges: true, faces: new Set(KEYS) };

/**
 * Filters on `home`, the sticker's *location*, not `cur`, the colour sitting
 * there: a Speffz letter labels a location (CONVENTIONS.md "Domain
 * conventions"), so "only the F face" has to mean the letter block I-L
 * whether the cube is solved or scrambled.
 */
export function allows(filter: PoolFilter, sticker: Sticker): boolean {
  if (sticker.kind === "center") return false;
  if (sticker.kind === "corner" && !filter.corners) return false;
  if (sticker.kind === "edge" && !filter.edges) return false;
  return filter.faces.has(sticker.home);
}

/** true when the pool is narrower than "every corner and edge, every face" */
export function isFiltered(filter: PoolFilter): boolean {
  return !filter.corners || !filter.edges || KEYS.some((k) => !filter.faces.has(k));
}

export function freshPool(cube: Cube, filter: PoolFilter): Sticker[] {
  return cube.stickers.filter((s) => allows(filter, s));
}

/**
 * Draws uniformly from `pool`, skipping anything in `exclude` unless that
 * would leave nothing to draw (then it falls back to the whole pool —
 * repeating a question beats refusing to ask one).
 *
 * The stateless primitive. Drills should reach for `createPicker` instead,
 * which owns the "what did I just ask" bookkeeping; this stays exported for
 * one-off draws and for tests that need to pin the distribution.
 */
export function pickRandom<T>(pool: readonly T[], exclude: readonly T[] = []): T | null {
  if (!pool.length) return null;
  const eligible = exclude.length ? pool.filter((item) => !exclude.includes(item)) : pool;
  const from = eligible.length ? eligible : pool;
  return from[Math.floor(Math.random() * from.length)];
}

export interface Picker<T> {
  /** draw the next question, avoiding the most recent picks */
  next(pool: readonly T[]): T | null;
  /** forget the history — call when a drill starts a fresh session, so its
   *  first question is drawn unconstrained */
  reset(): void;
}

/**
 * A drill's question sequencer: uniform draws, minus the last `recent`
 * picks.
 *
 * Why a picker and not "pass the last sticker back in": the no-repeat rule
 * then holds by construction, for every drill, including ones not written
 * yet (trace). A call site can't forget to opt in, and selection history
 * stops piggy-backing on whatever variable the drill happens to keep its
 * current question in — that variable is also driving grading, marks and
 * reveal state, and those have different lifetimes.
 *
 * On the rule itself: an immediate repeat isn't a recall rep. The letter is
 * still in working memory and, right after an answer, still on screen — so
 * it grades as a freebie on a hit and as pure echo on a miss. It bites
 * hardest exactly where the drill is worked hardest, since a narrowed pool
 * (one orbit × one face) is 4 stickers, i.e. 1-in-4 questions. Note this
 * deliberately does not special-case a miss into an immediate re-ask:
 * re-asking a missed sticker is worth doing, but with spacing.
 *
 * Identity, not value, decides a repeat — so for stickers, corner A and
 * edge A are different questions and may follow each other.
 *
 * @param recent how many previous picks to avoid; 1 (the default) blocks
 *   only an immediate repeat. Always clamped to `pool.length - 1` at draw
 *   time, so a window wider than the pool degrades to "avoid what I can"
 *   rather than excluding everything and silently falling back to uniform.
 */
export function createPicker<T>(recent = 1): Picker<T> {
  const history: T[] = [];
  return {
    next(pool) {
      const choice = pickRandom(pool, history);
      if (choice === null) return null;
      history.push(choice);
      // Trimmed against the *current* pool, not the one we were built for:
      // the face/orbit filter can narrow under us mid-session.
      const cap = Math.min(recent, Math.max(pool.length - 1, 0));
      if (history.length > cap) history.splice(0, history.length - cap);
      return choice;
    },
    reset() {
      history.length = 0;
    },
  };
}
