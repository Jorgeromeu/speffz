import { describe, expect, it } from "vitest";
import { KEYS, type FaceKey } from "../cube/faces";
import { createCube, ringOf, scramble } from "../cube/state";
import { buildLetters } from "../speffz/letters";
import {
  createPicker,
  freshPool,
  isFiltered,
  NO_POOL_FILTER,
  pickRandom,
  poolLetters,
  type PoolFilter,
} from "./pool";

const cube = createCube();
const letters = buildLetters(cube);

function faces(...keys: FaceKey[]): Set<FaceKey> {
  return new Set(keys);
}
/** a filter with the defaults filled in, so a case only states what it varies */
function pool(over: Partial<PoolFilter> = {}): PoolFilter {
  return { ...NO_POOL_FILTER, ...over };
}
function lettersOf(filter: PoolFilter): string {
  return freshPool(cube, filter)
    .map((s) => letters.letterOf(s))
    .sort()
    .join("");
}

const ALL = "ABCDEFGHIJKLMNOPQRSTUVWX";

describe("pool filter", () => {
  it("unfiltered draws every corner and edge sticker, and no centers", () => {
    const pool = freshPool(cube, NO_POOL_FILTER);
    expect(pool).toHaveLength(48);
    expect(pool.some((s) => s.kind === "center")).toBe(false);
    // both orbits are a full A-X, and they are independent letter sets
    expect(lettersOf(NO_POOL_FILTER)).toBe([...ALL].flatMap((l) => [l, l]).join(""));
  });

  it("crosses the two axes: edges-only x {F, B} is exactly IJKL QRST", () => {
    expect(lettersOf(pool({ corners: false, faces: faces("Fr", "B") }))).toBe("IJKLQRST");
  });

  it("keeps the orbits separate: corners-only x {U} is the corner ABCD, not the edge one", () => {
    const drawn = freshPool(cube, pool({ edges: false, faces: faces("U") }));
    expect(drawn.map((s) => letters.letterOf(s)).sort().join("")).toBe("ABCD");
    expect(drawn.every((s) => s.kind === "corner")).toBe(true);
  });

  it("gives each face its own letter block, four letters per kind", () => {
    KEYS.forEach((key) => {
      expect(lettersOf(pool({ faces: faces(key) }))).toHaveLength(8);
    });
  });

  it("filters by location, not by the colour currently sitting there", () => {
    const filter = pool({ faces: faces("Fr") });
    const before = lettersOf(filter);
    const scrambled = createCube();
    scramble(scrambled);
    const after = freshPool(scrambled, filter)
      .map((s) => buildLetters(scrambled).letterOf(s))
      .sort()
      .join("");
    expect(after).toBe(before);
    expect(before).toBe("IIJJKKLL");
  });

  it("reports narrowness on either axis", () => {
    expect(isFiltered(NO_POOL_FILTER)).toBe(false);
    expect(isFiltered(pool())).toBe(false);
    expect(isFiltered(pool({ corners: false }))).toBe(true);
    expect(isFiltered(pool({ faces: faces("U") }))).toBe(true);
  });
});

// The face set selects cubies instead of stickers: every sticker of any piece
// touching a chosen face. See PoolFilter.wholePiece — the point is that UF=C
// and FU=I stop being separable by position within a face.
describe("whole-piece pool", () => {
  const WHOLE_F = pool({ faces: faces("Fr"), wholePiece: true });

  it("adds each edge's partner: F edges go from IJKL to IJKL + CFPU", () => {
    const edgesOnly = { ...WHOLE_F, corners: false };
    expect(lettersOf({ ...edgesOnly, wholePiece: false })).toBe("IJKL");
    expect(lettersOf(edgesOnly)).toBe("CFIJKLPU");
    expect(poolLetters(edgesOnly, "edge")).toEqual({ direct: "IJKL", viaPiece: "CFPU" });
  });

  it("adds both of each corner's partners: four letters become twelve", () => {
    const cornersOnly = { ...WHOLE_F, edges: false };
    expect(lettersOf(cornersOnly)).toBe("CDFGIJKLMPUV");
    expect(poolLetters(cornersOnly, "corner")).toEqual({ direct: "IJKL", viaPiece: "CDFGMPUV" });
    // the surprising number, and the reason the panel prints the letters:
    // one face reaches half of the 24-sticker corner set
    expect(freshPool(cube, cornersOnly)).toHaveLength(12);
  });

  it("is closed — every sticker in the pool brings its whole cubie", () => {
    KEYS.forEach((key) => {
      const drawn = freshPool(cube, pool({ faces: faces(key), wholePiece: true }));
      const inPool = new Set(drawn);
      drawn.forEach((s) => {
        ringOf(cube, s).forEach((mate) => expect(inPool.has(mate)).toBe(true));
      });
    });
  });

  it("is inert with every face selected", () => {
    expect(lettersOf(pool({ wholePiece: true }))).toBe(lettersOf(NO_POOL_FILTER));
    expect(isFiltered(pool({ wholePiece: true }))).toBe(false);
  });

  it("still filters by location, not by the colour sitting there", () => {
    const before = lettersOf(WHOLE_F);
    const scrambled = createCube();
    scramble(scrambled);
    const after = freshPool(scrambled, WHOLE_F)
      .map((s) => buildLetters(scrambled).letterOf(s))
      .sort()
      .join("");
    expect(after).toBe(before);
  });

  it("does not narrow the pool at all until two *adjacent* faces are off", () => {
    // A piece only drops out when all of its faces are deselected, and no
    // cubie lives inside a single face or inside an opposite pair. So these
    // two look filtered on the net and aren't — which is why isFiltered()
    // measures the pool rather than reading the filter's fields.
    const minusU = pool({ faces: faces("L", "Fr", "R", "B", "D"), wholePiece: true });
    const minusUD = pool({ faces: faces("L", "Fr", "R", "B"), wholePiece: true });
    expect(freshPool(cube, minusU)).toHaveLength(48);
    expect(freshPool(cube, minusUD)).toHaveLength(48);
    expect(isFiltered(minusU)).toBe(false);
    expect(isFiltered(minusUD)).toBe(false);

    // U and F together do contain a cubie — the UF edge — so its two
    // stickers, and only those, fall out. The UFL/UFR corners survive on L/R.
    const minusUF = pool({ faces: faces("L", "R", "B", "D"), wholePiece: true });
    expect(freshPool(cube, minusUF)).toHaveLength(46);
    expect(isFiltered(minusUF)).toBe(true);
    expect(lettersOf({ ...minusUF, corners: false })).toBe("ABDEFGHJKLMNOPQRSTUVWX");
  });
});

// the tightest pool the filter can produce (corners-only x one face), and so
// the one where repeat behaviour matters most — 4 stickers means a naive
// uniform draw repeats 1 question in 4
const TIGHT: PoolFilter = pool({ edges: false, faces: faces("U") });

describe("pickRandom", () => {
  it("returns null only for an empty pool", () => {
    expect(pickRandom([])).toBeNull();
    expect(pickRandom([], ["x"])).toBeNull();
  });

  it("skips excluded items but still reaches everything else", () => {
    const pool = freshPool(cube, TIGHT);
    expect(pool).toHaveLength(4);
    const draws = Array.from({ length: 500 }, () => pickRandom(pool, [pool[0], pool[1]])!);
    expect(draws).not.toContain(pool[0]);
    expect(draws).not.toContain(pool[1]);
    expect(new Set(draws).size).toBe(2);
  });

  it("draws the whole pool when nothing is excluded", () => {
    const pool = freshPool(cube, TIGHT);
    expect(new Set(Array.from({ length: 500 }, () => pickRandom(pool))).size).toBe(4);
  });

  it("repeats rather than refusing when exclusion would empty the pool", () => {
    expect(pickRandom(["only"], ["only"])).toBe("only");
  });
});

describe("createPicker", () => {
  it("never asks the same question twice in a row, on the tightest pool", () => {
    const pool = freshPool(cube, TIGHT);
    const picker = createPicker<(typeof pool)[number]>();
    const seen = new Set<unknown>();
    let prev = picker.next(pool)!;
    seen.add(prev);
    for (let i = 0; i < 500; i++) {
      const next = picker.next(pool)!;
      expect(next).not.toBe(prev);
      seen.add(next);
      prev = next;
    }
    // excluding the last pick must not collapse the draw onto a subset
    expect(seen.size).toBe(4);
  });

  it("honours a wider window: avoids the last N, not just the last one", () => {
    const pool = freshPool(cube, NO_POOL_FILTER);
    const picker = createPicker<(typeof pool)[number]>(3);
    const recent: unknown[] = [];
    for (let i = 0; i < 500; i++) {
      const next = picker.next(pool)!;
      expect(recent).not.toContain(next);
      recent.push(next);
      if (recent.length > 3) recent.shift();
    }
  });

  it("degrades instead of stalling when the window is wider than the pool", () => {
    // window 5 over 4 stickers: it can't avoid 5, so it avoids what it can
    // (3, i.e. pool - 1) and keeps asking rather than falling back to uniform
    const pool = freshPool(cube, TIGHT);
    const picker = createPicker<(typeof pool)[number]>(5);
    let prev = picker.next(pool)!;
    for (let i = 0; i < 200; i++) {
      const next = picker.next(pool)!;
      expect(next).not.toBe(prev);
      prev = next;
    }
  });

  it("survives the pool narrowing under it mid-session", () => {
    // a filter change can shrink the pool below the picker's history; the
    // trim is against the current pool, so it must not lock up or repeat
    const picker = createPicker<ReturnType<typeof freshPool>[number]>(3);
    const wide = freshPool(cube, NO_POOL_FILTER);
    for (let i = 0; i < 10; i++) picker.next(wide);
    const narrow = freshPool(cube, TIGHT);
    let prev = picker.next(narrow)!;
    for (let i = 0; i < 200; i++) {
      const next = picker.next(narrow)!;
      expect(narrow).toContain(next);
      expect(next).not.toBe(prev);
      prev = next;
    }
  });

  it("reset() forgets history, so a fresh session draws unconstrained", () => {
    const pool = freshPool(cube, TIGHT);
    const picker = createPicker<(typeof pool)[number]>();
    const first = picker.next(pool)!;
    // without reset the same sticker can't come back immediately; with it,
    // every sticker is eligible again — including that one
    const afterReset = Array.from({ length: 200 }, () => {
      picker.reset();
      return picker.next(pool);
    });
    expect(afterReset).toContain(first);
  });

  it("returns null on an empty pool without poisoning later draws", () => {
    const pool = freshPool(cube, TIGHT);
    const picker = createPicker<(typeof pool)[number]>();
    expect(picker.next([])).toBeNull();
    expect(pool).toContain(picker.next(pool));
  });

  it("excludes by identity, so a same-letter sticker in the other orbit stays askable", () => {
    // corner A and edge A share a letter but are different questions
    const pool = freshPool(cube, NO_POOL_FILTER);
    const cornerA = pool.find((s) => s.kind === "corner" && letters.letterOf(s) === "A")!;
    const edgeA = pool.find((s) => s.kind === "edge" && letters.letterOf(s) === "A")!;
    const draws = Array.from({ length: 2000 }, () => pickRandom(pool, [cornerA]));
    expect(draws).not.toContain(cornerA);
    expect(draws).toContain(edgeA);
  });
});
