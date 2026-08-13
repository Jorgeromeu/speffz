import { describe, expect, it } from "vitest";
import { KEYS, type FaceKey } from "../cube/faces";
import { createCube, scramble } from "../cube/state";
import { buildLetters } from "../speffz/letters";
import { createPicker, freshPool, isFiltered, NO_POOL_FILTER, pickRandom, type PoolFilter } from "./pool";

const cube = createCube();
const letters = buildLetters(cube);

function faces(...keys: FaceKey[]): Set<FaceKey> {
  return new Set(keys);
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
    expect(lettersOf({ corners: false, edges: true, faces: faces("Fr", "B") })).toBe("IJKLQRST");
  });

  it("keeps the orbits separate: corners-only x {U} is the corner ABCD, not the edge one", () => {
    const pool = freshPool(cube, { corners: true, edges: false, faces: faces("U") });
    expect(pool.map((s) => letters.letterOf(s)).sort().join("")).toBe("ABCD");
    expect(pool.every((s) => s.kind === "corner")).toBe(true);
  });

  it("gives each face its own letter block, four letters per kind", () => {
    KEYS.forEach((key) => {
      expect(lettersOf({ corners: true, edges: true, faces: faces(key) })).toHaveLength(8);
    });
  });

  it("filters by location, not by the colour currently sitting there", () => {
    const filter: PoolFilter = { corners: true, edges: true, faces: faces("Fr") };
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
    expect(isFiltered({ corners: true, edges: true, faces: new Set(KEYS) })).toBe(false);
    expect(isFiltered({ corners: false, edges: true, faces: new Set(KEYS) })).toBe(true);
    expect(isFiltered({ corners: true, edges: true, faces: faces("U") })).toBe(true);
  });
});

// the tightest pool the filter can produce (corners-only x one face), and so
// the one where repeat behaviour matters most — 4 stickers means a naive
// uniform draw repeats 1 question in 4
const TIGHT: PoolFilter = { corners: true, edges: false, faces: faces("U") };

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
