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
import { createCube, ringOf, type Cube, type Kind, type Sticker } from "../cube/state";
import { letterOfSticker } from "../speffz/letters";

export interface PoolFilter {
  readonly corners: boolean;
  readonly edges: boolean;
  /** faces the pool may draw from; all six = no face filter */
  readonly faces: ReadonlySet<FaceKey>;
  /**
   * What `faces` selects: stickers, or whole cubies.
   *
   * false (default) — a sticker is in when its *own* home face is chosen.
   *   "only F" is the letter block I-L: four stickers laid out in one fixed
   *   clockwise pattern, which you can answer by counting position within
   *   the face without ever knowing the letter.
   *
   * true — a sticker is in when *any* sticker of its home cubie has a chosen
   *   home face. "only F" then also pulls in each piece's other stickers, so
   *   UF=C vs FU=I stops being answerable by position and starts being the
   *   question. That's the distinction that actually bites mid-solve.
   *
   * Widens more than it looks: one face goes from 4 to 8 edge stickers and
   * from 4 to *12* corner stickers, half the corner set. See poolLetters().
   */
  readonly wholePiece: boolean;
}

export const NO_POOL_FILTER: PoolFilter = {
  corners: true,
  edges: true,
  faces: new Set(KEYS),
  wholePiece: false,
};

/** every corner and edge sticker, both orbits — what an unfiltered pool holds */
const TOTAL_STICKERS = 48;

// A solved cube kept purely as a geometry oracle, for the two questions that
// are about the *filter* rather than about any particular cube: how wide is
// this pool, and which letters does it contain. Both are static — positions
// are fixed and Speffz letters label positions — so a solved cube answers
// them exactly as a scrambled one would, and callers that only have a filter
// in hand (the settings panel) don't have to be handed a cube to ask.
let oracle: Cube | null = null;
function reference(): Cube {
  return (oracle ??= createCube());
}

/**
 * Filters on `home`, the sticker's *location*, not `cur`, the colour sitting
 * there: a Speffz letter labels a location (CONVENTIONS.md "Domain
 * conventions"), so "only the F face" has to mean the letter block I-L
 * whether the cube is solved or scrambled.
 *
 * `wholePiece` keeps that property: `ringOf` is keyed on the sticker's cell,
 * which is a fixed position, so a cubie's stickers are the same three (or
 * two) locations on a solved and a scrambled cube alike.
 */
export function allows(cube: Cube, filter: PoolFilter, sticker: Sticker): boolean {
  if (sticker.kind === "center") return false;
  if (sticker.kind === "corner" && !filter.corners) return false;
  if (sticker.kind === "edge" && !filter.edges) return false;
  if (filter.faces.has(sticker.home)) return true;
  return filter.wholePiece && ringOf(cube, sticker).some((mate) => filter.faces.has(mate.home));
}

/**
 * true when the pool is narrower than "every corner and edge, every face".
 *
 * Measured against the actual pool rather than read off the filter's fields,
 * because `wholePiece` breaks the syntactic shortcut: a piece only falls out
 * of the pool when *all* of its faces are deselected, so deselecting a single
 * face — or an opposite pair like U and D — still leaves every cubie touching
 * something selected, and the pool is quietly still the full 48. Reporting
 * that as "filtered" would light the settings trigger over nothing.
 */
export function isFiltered(filter: PoolFilter): boolean {
  return freshPool(reference(), filter).length < TOTAL_STICKERS;
}

export function freshPool(cube: Cube, filter: PoolFilter): Sticker[] {
  return cube.stickers.filter((s) => allows(cube, filter, s));
}

/**
 * The pool's letters for one orbit, split by how they got in — what the
 * settings panel prints under the net.
 *
 * The split is the point. `wholePiece` reaches stickers on faces the net
 * shows as deselected, so no amount of highlighting on a six-square net can
 * describe the result honestly: picking F lights three of U's eight stickers,
 * not U. Naming the letters sidesteps the geometry entirely and is exact at
 * any granularity.
 */
export function poolLetters(filter: PoolFilter, kind: Exclude<Kind, "center">): {
  /** letters whose own home face is selected */
  readonly direct: string;
  /** letters reached only through `wholePiece`; empty when it's off */
  readonly viaPiece: string;
} {
  const cube = reference();
  const direct: string[] = [];
  const viaPiece: string[] = [];
  cube.stickers.forEach((s) => {
    if (s.kind !== kind) return;
    if (filter.faces.has(s.home)) direct.push(letterOfSticker(s));
    else if (filter.wholePiece && ringOf(cube, s).some((mate) => filter.faces.has(mate.home))) {
      viaPiece.push(letterOfSticker(s));
    }
  });
  return { direct: direct.sort().join(""), viaPiece: viaPiece.sort().join("") };
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
