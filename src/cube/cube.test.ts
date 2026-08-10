import { describe, expect, it } from "vitest";
import { DIRS, FACES, KEYS, type FaceKey, type Vec3 } from "./faces";
import { applyAlg, createCube, invertAlg, isSolved, scramble, turn } from "./state";
import { mulberry32 } from "./rng";

function cellFor(...faces: FaceKey[]): Vec3 {
  const cell: [number, number, number] = [0, 0, 0];
  faces.forEach((k) => {
    const f = FACES[k];
    cell[f.axis] = f.sign;
  });
  return cell;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  const v = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return v.map((x) => x + 0) as unknown as Vec3; // normalize -0 to 0 for deep-equal
}

function axisVec(axis: 0 | 1 | 2, sign: number): Vec3 {
  const v: [number, number, number] = [0, 0, 0];
  v[axis] = sign;
  return v;
}

describe("face geometry", () => {
  it("is right-handed: right x up = normal", () => {
    KEYS.forEach((key) => {
      const f = FACES[key];
      expect(cross(f.rt, f.up)).toEqual(axisVec(f.axis, f.sign));
    });
  });
});

describe("turns", () => {
  it("four quarter turns of any face is the identity", () => {
    const rng = mulberry32(7);
    DIRS.forEach(([axis, sign]) => {
      const cube = createCube();
      scramble(cube, rng); // start from a non-trivial state
      const before = cube.stickers.map((s) => s.cur);
      turn(cube, axis, sign, 4);
      expect(cube.stickers.map((s) => s.cur)).toEqual(before);
    });
  });

  it("(R U R' U') x6 is solved", () => {
    const cube = createCube();
    for (let i = 0; i < 6; i++) applyAlg(cube, "R U R' U'");
    expect(isSolved(cube)).toBe(true);
  });

  it("a specific alg touches exactly the expected cubies", () => {
    // T-perm: swaps corners UFR/UBR and edges UL/UR, nothing else.
    const cube = createCube();
    applyAlg(cube, "R U R' U' R' F R2 U' R' U' R U R' F'");
    const touchedCells = new Set(
      cube.stickers.filter((s) => s.cur !== s.home).map((s) => s.cell.join(",")),
    );
    const expected = new Set(
      [cellFor("U", "Fr", "R"), cellFor("U", "B", "R"), cellFor("U", "L"), cellFor("U", "R")].map((c) =>
        c.join(","),
      ),
    );
    expect(touchedCells).toEqual(expected);
  });
});

describe("scramble + notation", () => {
  it("a scramble followed by its inverse is solved", () => {
    const rng = mulberry32(1);
    for (let trial = 0; trial < 30; trial++) {
      const cube = createCube();
      const alg = scramble(cube, rng, 30);
      applyAlg(cube, invertAlg(alg));
      expect(isSolved(cube)).toBe(true);
    }
  });

  it("printed notation, re-applied from solved, reproduces the scrambled state", () => {
    const rng = mulberry32(2);
    for (let trial = 0; trial < 400; trial++) {
      const scrambled = createCube();
      const alg = scramble(scrambled, rng);

      const replayed = createCube();
      applyAlg(replayed, alg);

      expect(replayed.stickers.map((s) => s.cur)).toEqual(scrambled.stickers.map((s) => s.cur));
    }
  });

  it("never plays two consecutive moves on the same axis", () => {
    const rng = mulberry32(3);
    for (let trial = 0; trial < 200; trial++) {
      const cube = createCube();
      const alg = scramble(cube, rng);
      const axisOf: Record<string, number> = { R: 0, L: 0, U: 1, D: 1, F: 2, B: 2 };
      const tokens = alg.split(" ");
      for (let i = 1; i < tokens.length; i++) {
        expect(axisOf[tokens[i][0]]).not.toBe(axisOf[tokens[i - 1][0]]);
      }
    }
  });
});
