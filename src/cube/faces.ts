// Generic 3x3 cube face geometry. No Speffz, no BLD, no three.js/DOM — a
// trainer for any labelling scheme could build on this file unchanged.

export type FaceKey = "U" | "L" | "Fr" | "R" | "B" | "D";
export type Axis = 0 | 1 | 2;
export type Sign = 1 | -1;
export type Vec3 = readonly [number, number, number];

export interface FaceDef {
  readonly key: FaceKey;
  readonly axis: Axis;
  readonly sign: Sign;
  /** local "up" direction on the face, in cube space */
  readonly up: Vec3;
  /** local "right" direction on the face, in cube space */
  readonly rt: Vec3;
  /** plastic colour, standard Western scheme */
  readonly col: string;
  /** ink colour for markings printed on a lit tile of this face */
  readonly ink: string;
}

// The display label for "Fr" is "F" — it's spelled Fr here only because F
// collides with this table's own identifier space.
export const KEYS: readonly FaceKey[] = ["U", "L", "Fr", "R", "B", "D"];

export function displayLabel(key: FaceKey): string {
  return key === "Fr" ? "F" : key;
}

// right x up = normal, or textures render mirrored.
export const FACES: Readonly<Record<FaceKey, FaceDef>> = {
  U: { key: "U", axis: 1, sign: 1, up: [0, 0, -1], rt: [1, 0, 0], col: "#f1f2ef", ink: "#15171b" },
  L: { key: "L", axis: 0, sign: -1, up: [0, 1, 0], rt: [0, 0, 1], col: "#ec6a1a", ink: "#2b1402" },
  Fr: { key: "Fr", axis: 2, sign: 1, up: [0, 1, 0], rt: [1, 0, 0], col: "#1fa356", ink: "#effaf3" },
  R: { key: "R", axis: 0, sign: 1, up: [0, 1, 0], rt: [0, 0, -1], col: "#d8323c", ink: "#fff0f1" },
  B: { key: "B", axis: 2, sign: -1, up: [0, 1, 0], rt: [-1, 0, 0], col: "#2f66d0", ink: "#eef3ff" },
  D: { key: "D", axis: 1, sign: -1, up: [0, 0, 1], rt: [1, 0, 0], col: "#f8da33", ink: "#2e2705" },
};

export function faceOf(axis: Axis, sign: Sign): FaceDef {
  for (const key of KEYS) {
    const f = FACES[key];
    if (f.axis === axis && f.sign === sign) return f;
  }
  throw new Error(`no face for axis ${axis} sign ${sign}`);
}

// Move notation: DIRS[i] <-> MOVE[i]. A scramble avoids two consecutive
// moves sharing an axis (DIRS[i][0] === DIRS[j][0]).
export const DIRS: readonly (readonly [Axis, Sign])[] = [
  [0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1],
];
export const MOVE: readonly string[] = ["R", "L", "U", "D", "F", "B"];

export function moveIndex(name: string): number {
  const i = MOVE.indexOf(name[0]);
  if (i < 0) throw new Error(`unknown move "${name}"`);
  return i;
}

/** quarter turns for a notation token, e.g. "R"->1, "R2"->2, "R'"->3 */
export function moveTimes(name: string): number {
  if (name.endsWith("2")) return 2;
  if (name.endsWith("'")) return 3;
  return 1;
}

export function moveName(dirIndex: number, times: number): string {
  return MOVE[dirIndex] + (times === 2 ? "2" : times === 3 ? "'" : "");
}
