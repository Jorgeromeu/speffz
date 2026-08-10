import { describe, expect, it } from "vitest";
import { FACES, type FaceKey, type Vec3 } from "../cube/faces";
import { createCube, scramble, type Cube, type Kind } from "../cube/state";
import { mulberry32, randInt, type Rng } from "../cube/rng";
import { buildLetters, letterIndex, type Letters } from "./letters";
import { OLD_POCHMANN } from "./buffers";
import {
  buildRings,
  computeDest,
  forced,
  inBuffer,
  isSettled,
  judge,
  shoot,
  solveCanonical,
  type Rings,
} from "./memo";

function cellFor(...faces: FaceKey[]): Vec3 {
  const cell: [number, number, number] = [0, 0, 0];
  faces.forEach((k) => {
    const f = FACES[k];
    cell[f.axis] = f.sign;
  });
  return cell;
}

function faceChar(c: string): FaceKey {
  return c === "F" ? "Fr" : (c as FaceKey);
}

function parseTable(table: string): { letter: string; faces: FaceKey[] }[] {
  const out: { letter: string; faces: FaceKey[] }[] = [];
  const re = /([A-X])=([A-Z]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(table))) {
    out.push({ letter: m[1], faces: m[2].split("").map(faceChar) });
  }
  return out;
}

// From CLAUDE.md's "Domain conventions" table.
const CORNER_TABLE = `
  A=UBL B=UBR C=UFR D=UFL
  E=LUB F=LUF G=LDF H=LDB
  I=FUL J=FUR K=FDR L=FDL
  M=RUF N=RUB O=RDB P=RDF
  Q=BUR R=BUL S=BDL T=BDR
  U=DFL V=DFR W=DBR X=DBL
`;
const EDGE_TABLE = `
  A=UB B=UR C=UF D=UL
  E=LU F=LF G=LD H=LB
  I=FU J=FR K=FD L=FL
  M=RU N=RB O=RD P=RF
  Q=BU R=BL S=BD T=BR
  U=DF V=DR W=DB X=DL
`;

describe("Speffz lettering", () => {
  it("matches CLAUDE.md's table for all 48 letters", () => {
    const cube = createCube();
    const letters = buildLetters(cube);

    [
      ["corner", CORNER_TABLE] as const,
      ["edge", EDGE_TABLE] as const,
    ].forEach(([kind, table]) => {
      parseTable(table).forEach(({ letter, faces }) => {
        const [home, ...rest] = faces;
        const cell = cellFor(...faces);
        const sticker = cube.stickers.find(
          (s) => s.kind === kind && s.home === home && s.cell.join(",") === cell.join(","),
        );
        expect(sticker, `${kind} ${letter}=${faces.join("")}`).toBeDefined();
        expect(letters.letterOf(sticker!)).toBe(letter);
        expect(letters.stickerFor(kind, letter)).toBe(sticker);
        expect(rest.length).toBe(kind === "corner" ? 2 : 1);
      });
    });
  });
});

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function scrambledOrbit(rng: Rng): { cube: Cube; letters: Letters } {
  const cube = createCube();
  scramble(cube, rng);
  return { cube, letters: buildLetters(cube) };
}

describe("memo model", () => {
  it("dest is a bijection on 0-23, for either orbit, on any scramble", () => {
    const rng = mulberry32(10);
    (["corner", "edge"] as const).forEach((kind) => {
      for (let trial = 0; trial < 500; trial++) {
        const { cube, letters } = scrambledOrbit(rng);
        const dest = computeDest(cube, letters, kind);
        expect(dest.slice().sort((a, b) => a - b)).toEqual([...Array(24).keys()]);
      }
    });
  });

  it("canonical memo always settles (3000 scrambles per orbit)", () => {
    const rng = mulberry32(11);
    (["corner", "edge"] as const).forEach((kind) => {
      const bufferLetter = OLD_POCHMANN[kind].letter;
      for (let trial = 0; trial < 3000; trial++) {
        const { cube, letters } = scrambledOrbit(rng);
        const rings = buildRings(cube, letters, kind);
        const dest = computeDest(cube, letters, kind);
        const seq = solveCanonical(dest, rings, letterIndex(bufferLetter));
        const replay = dest.slice();
        seq.forEach((t) => shoot(replay, rings, letterIndex(bufferLetter), t));
        expect(isSettled(replay)).toBe(true);
      }
    });
  });

  it("corner and edge target counts always share parity, and the parity rate is ~50% (5000 scrambles)", () => {
    const rng = mulberry32(12);
    let odd = 0;
    const N = 5000;
    for (let trial = 0; trial < N; trial++) {
      const cube = createCube();
      scramble(cube, rng);
      const letters = buildLetters(cube);
      const cornerRings = buildRings(cube, letters, "corner");
      const edgeRings = buildRings(cube, letters, "edge");
      const cornerLen = solveCanonical(
        computeDest(cube, letters, "corner"),
        cornerRings,
        letterIndex(OLD_POCHMANN.corner.letter),
      ).length;
      const edgeLen = solveCanonical(
        computeDest(cube, letters, "edge"),
        edgeRings,
        letterIndex(OLD_POCHMANN.edge.letter),
      ).length;
      expect(cornerLen % 2).toBe(edgeLen % 2);
      if (edgeLen % 2 === 1) odd++;
    }
    const rate = odd / N;
    expect(rate).toBeGreaterThan(0.4);
    expect(rate).toBeLessThan(0.6);
  });

  it("corner target counts: median 8, wide sanity range (3000 scrambles)", () => {
    // Two 20000-trial Monte Carlo runs against the actual frozen
    // original.html (scripts/monte-carlo-original.cjs, unseeded so each run
    // samples differently) saw corner extremes as wide as 3-13, not the
    // "range 4-12" CLAUDE.md documents. Bounds here are a generous
    // regression guard; the median is the tight, real invariant.
    const rng = mulberry32(13);
    const lens: number[] = [];
    for (let trial = 0; trial < 3000; trial++) {
      const { cube, letters } = scrambledOrbit(rng);
      const rings = buildRings(cube, letters, "corner");
      const dest = computeDest(cube, letters, "corner");
      lens.push(solveCanonical(dest, rings, letterIndex(OLD_POCHMANN.corner.letter)).length);
    }
    expect(Math.min(...lens)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...lens)).toBeLessThanOrEqual(15);
    expect(median(lens)).toBeGreaterThanOrEqual(7);
    expect(median(lens)).toBeLessThanOrEqual(9);
  });

  it("edge target counts: median 12, wide sanity range (3000 scrambles)", () => {
    // CLAUDE.md documents "range 7-16", but a 20000-trial Monte Carlo run
    // against the actual frozen original.html (scratchpad/montecarlo.cjs)
    // shows the real range is 5-18 (histogram tapers to single digits past
    // 16) — that line was an imprecise historical observation, not a hard
    // bound. Bounds here are a generous regression guard, not the true
    // range; the median is the real invariant worth pinning down.
    const rng = mulberry32(14);
    const lens: number[] = [];
    for (let trial = 0; trial < 3000; trial++) {
      const { cube, letters } = scrambledOrbit(rng);
      const rings = buildRings(cube, letters, "edge");
      const dest = computeDest(cube, letters, "edge");
      lens.push(solveCanonical(dest, rings, letterIndex(OLD_POCHMANN.edge.letter)).length);
    }
    expect(Math.min(...lens)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...lens)).toBeLessThanOrEqual(20);
    expect(median(lens)).toBeGreaterThanOrEqual(11);
    expect(median(lens)).toBeLessThanOrEqual(13);
  });
});

function pickRandomLegal(rng: Rng, dest: readonly number[], rings: Rings, bufferIndex: number): number {
  const f = forced(dest, rings, bufferIndex);
  if (f >= 0) return f;
  const candidates: number[] = [];
  for (let i = 0; i < 24; i++) {
    if (i === bufferIndex || inBuffer(rings, bufferIndex, i) || dest[i] === i) continue;
    candidates.push(i);
  }
  return candidates[randInt(rng, candidates.length)];
}

describe("memo validator", () => {
  it("accepts and completes on random legal break-ins (3000/3000)", () => {
    const rng = mulberry32(20);
    for (let trial = 0; trial < 3000; trial++) {
      const kind: Kind = trial % 2 === 0 ? "corner" : "edge";
      const { cube, letters } = scrambledOrbit(rng);
      const rings = buildRings(cube, letters, kind as "corner" | "edge");
      const dest = computeDest(cube, letters, kind as "corner" | "edge");
      const bufferIndex = letterIndex(OLD_POCHMANN[kind as "corner" | "edge"].letter);

      let steps = 0;
      while (!isSettled(dest)) {
        expect(steps++).toBeLessThan(30); // costs table: worst case is well under this
        const letter = pickRandomLegal(rng, dest, rings, bufferIndex);
        expect(judge(dest, rings, bufferIndex, letter).verdict).toBe("accept");
        shoot(dest, rings, bufferIndex, letter);
      }
    }
  });

  it("rejects a corrupted letter 100% of the time when the buffer is forced (3000/3000)", () => {
    const rng = mulberry32(21);
    let checked = 0;
    for (let trial = 0; trial < 3000; trial++) {
      const kind: "corner" | "edge" = trial % 2 === 0 ? "corner" : "edge";
      const { cube, letters } = scrambledOrbit(rng);
      const rings = buildRings(cube, letters, kind);
      const dest = computeDest(cube, letters, kind);
      const bufferIndex = letterIndex(OLD_POCHMANN[kind].letter);

      // advance a few random legal steps so forced cycles actually appear
      for (let i = 0; i < 3 && !isSettled(dest); i++) {
        const letter = pickRandomLegal(rng, dest, rings, bufferIndex);
        shoot(dest, rings, bufferIndex, letter);
      }

      const f = forced(dest, rings, bufferIndex);
      if (f < 0) continue; // no forced target this round; covered by the dedicated rule tests below
      const wrong = (f + 1 + randInt(rng, 22)) % 24; // any letter other than f, may land on-buffer too
      if (wrong === f) continue;
      const verdict = judge(dest, rings, bufferIndex, wrong);
      expect(verdict.verdict).toBe("reject");
      checked++;
    }
    expect(checked).toBeGreaterThan(1000); // sanity: the scenario actually occurred plenty
  });

  it("rejects shooting at a letter on the buffer's own piece", () => {
    const rng = mulberry32(22);
    const { cube, letters } = scrambledOrbit(rng);
    const rings = buildRings(cube, letters, "corner");
    const dest = computeDest(cube, letters, "corner");
    const bufferIndex = letterIndex(OLD_POCHMANN.corner.letter);
    rings[bufferIndex].forEach((letter) => {
      expect(judge(dest, rings, bufferIndex, letter)).toEqual({ verdict: "reject", reason: "on-buffer" });
    });
  });

  it("rejects breaking into an already-solved letter when nothing is forced", () => {
    const rng = mulberry32(23);
    // scramble repeatedly until a state with an off-buffer solved letter and
    // no forced target turns up, so the rule is actually exercised
    for (let attempt = 0; attempt < 200; attempt++) {
      const { cube, letters } = scrambledOrbit(rng);
      const rings = buildRings(cube, letters, "edge");
      const dest = computeDest(cube, letters, "edge");
      const bufferIndex = letterIndex(OLD_POCHMANN.edge.letter);
      if (forced(dest, rings, bufferIndex) >= 0) continue;
      const solved = [...Array(24).keys()].find(
        (i) => i !== bufferIndex && !inBuffer(rings, bufferIndex, i) && dest[i] === i,
      );
      if (solved === undefined) continue;
      expect(judge(dest, rings, bufferIndex, solved)).toEqual({ verdict: "reject", reason: "already-solved" });
      return;
    }
    throw new Error("never found a scenario to exercise the already-solved rule");
  });
});
