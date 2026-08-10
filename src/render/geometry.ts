// Chamfered cube mesh. Only the cube's outer edges are rounded; walls
// between neighbouring pieces stay square. This is a faithful port of the
// original's `build()` — derived geometry, not tabulated, so it's kept
// line-for-line rather than "cleaned up". See CLAUDE.md "Rendering details
// worth preserving".
import * as THREE from "three";
import { type Axis, type Sign, FACES, type FaceKey } from "../cube/faces";
import { type Cube, type Sticker, stickerAt } from "../cube/state";
import { C, CORE_COLOUR, H, N } from "./constants";

const HALF = Math.PI / 2;
export const DIRS: readonly (readonly [Axis, Sign])[] = [
  [0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1],
];

export type V3 = [number, number, number];

export function axisVec(axis: Axis, sign: Sign): V3 {
  const v: V3 = [0, 0, 0];
  v[axis] = sign;
  return v;
}

/** emits one cubie's chamfered triangles; `tag` maps a visible face to a
 *  colour slot (or -1 for an inward face, which stays dark). Shared by the
 *  whole-cube mesh and the isolated single-piece view (render/solo.ts). */
export function emitCubie(centre: V3, tag: (axis: Axis, sign: Sign) => number, emit: (p: V3, slot: number) => void): void {
  function out(axis: Axis, sign: Sign) {
    return centre[axis] === sign;
  }
  function round2(a: Axis, sa: Sign, b: Axis, sb: Sign) {
    return a !== b && out(a, sa) && out(b, sb);
  }
  function P(triples: readonly (readonly [Axis, number])[]): V3 {
    const p = centre.slice() as V3;
    triples.forEach(([ax, d]) => {
      p[ax] += d;
    });
    return p;
  }
  function tri(a: V3, ca: number, b: V3, cb: number, c: V3, cc: number): void {
    emit(a, ca);
    emit(b, cb);
    emit(c, cc);
  }
  function quad(a: V3, b: V3, c: V3, d: V3, k: number): void {
    tri(a, k, b, k, c, k);
    tri(a, k, c, k, d, k);
  }

  // face patches (chamfered corners folded in as an extra arc on the ring)
  DIRS.forEach(([a, sa]) => {
    const o = ([0, 1, 2] as const).filter((x) => x !== a) as [Axis, Axis];
    const k = tag(a, sa);
    const ring: [number, number][] = [];
    ([[1, 1], [-1, 1], [-1, -1], [1, -1]] as [Sign, Sign][]).forEach(([s0, s1]) => {
      const i0 = round2(a, sa, o[0], s0) ? C : 0;
      const i1 = round2(a, sa, o[1], s1) ? C : 0;
      if (!i0 && !i1 && round2(o[0], s0, o[1], s1)) {
        for (let t = 0; t <= N; t++) {
          const th = ((s0 * s1 > 0 ? t : N - t) / N) * HALF;
          ring.push([s0 * (H - C + C * Math.cos(th)), s1 * (H - C + C * Math.sin(th))]);
        }
      } else {
        ring.push([s0 * (H - i0), s1 * (H - i1)]);
      }
    });
    const mid = P([[a, sa * H]]);
    for (let q = 0; q < ring.length; q++) {
      const u = ring[q];
      const v = ring[(q + 1) % ring.length];
      tri(
        mid, k,
        P([[a, sa * H], [o[0], u[0]], [o[1], u[1]]]), k,
        P([[a, sa * H], [o[0], v[0]], [o[1], v[1]]]), k,
      );
    }
  });

  // edge chamfer strips, split at their midpoint between the two adjoining faces
  DIRS.forEach(([da, sa], i) => {
    DIRS.forEach(([db, sb], j) => {
      if (j <= i || !round2(da, sa, db, sb)) return;
      const a = da, sa2 = sa, b = db, sb2 = sb;
      const e = ([0, 1, 2] as const).find((x) => x !== a && x !== b) as Axis;
      const hi = out(e, 1) ? H - C : H;
      const lo = out(e, -1 as Sign) ? H - C : H;
      const ka = tag(a, sa2);
      const kb = tag(b, sb2);
      function arc(t: number, along: number): V3 {
        const th = (t / N) * HALF;
        return P([
          [a, sa2 * (H - C + C * Math.cos(th))],
          [b, sb2 * (H - C + C * Math.sin(th))],
          [e, along],
        ]);
      }
      for (let t = 0; t < N; t++) {
        quad(arc(t, hi), arc(t + 1, hi), arc(t + 1, -lo), arc(t, -lo), t < N / 2 ? ka : kb);
      }
    });
  });

  // corner patches: each outer cube corner is three single-colour spherical
  // patches meeting on the body diagonal
  const M = 4;
  ([1, -1] as Sign[]).forEach((sx) => {
    ([1, -1] as Sign[]).forEach((sy) => {
      ([1, -1] as Sign[]).forEach((sz) => {
        if (!(out(0, sx) && out(1, sy) && out(2, sz))) return;
        const sg: V3 = [sx, sy, sz];
        function unit(axes: Axis[]): V3 {
          const v: V3 = [0, 0, 0];
          axes.forEach((a) => {
            v[a] += sg[a];
          });
          const m = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
          return [v[0] / m, v[1] / m, v[2] / m];
        }
        ([0, 1, 2] as Axis[]).forEach((a) => {
          const o = ([0, 1, 2] as const).filter((x) => x !== a) as [Axis, Axis];
          const A = unit([a]);
          const Bv = unit([a, o[0]]);
          const Cv = unit([a, o[0], o[1]]);
          const Dv = unit([a, o[1]]);
          const k = tag(a, sg[a] as Sign);
          function at(u: number, v: number): V3 {
            const d: V3 = [0, 0, 0];
            for (let q = 0; q < 3; q++) {
              d[q] = (1 - u) * (1 - v) * A[q] + u * (1 - v) * Bv[q] + u * v * Cv[q] + (1 - u) * v * Dv[q];
            }
            const m = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
            return P([
              [0, sx * (H - C) + (C * d[0]) / m],
              [1, sy * (H - C) + (C * d[1]) / m],
              [2, sz * (H - C) + (C * d[2]) / m],
            ]);
          }
          for (let i2 = 0; i2 < M; i2++) {
            for (let j2 = 0; j2 < M; j2++) {
              quad(
                at(i2 / M, j2 / M),
                at((i2 + 1) / M, j2 / M),
                at((i2 + 1) / M, (j2 + 1) / M),
                at(i2 / M, (j2 + 1) / M),
                k,
              );
            }
          }
        });
      });
    });
  });
}

export interface CubeMesh {
  readonly mesh: THREE.Mesh;
  updateColours(): void;
}

/** the whole chamfered cube, coloured from `cube`'s current sticker state */
export function buildCubeMesh(cube: Cube): CubeMesh {
  const slotOf = new Map<Sticker, number>();
  cube.stickers.forEach((s, i) => slotOf.set(s, i));

  const positions: number[] = [];
  const slots: number[] = [];
  for (let cx = -1; cx <= 1; cx++) {
    for (let cy = -1; cy <= 1; cy++) {
      for (let cz = -1; cz <= 1; cz++) {
        const centre: V3 = [cx, cy, cz];
        emitCubie(
          centre,
          (axis, sign) => {
            if (centre[axis] !== sign) return -1;
            const sticker = stickerAt(cube, centre, axisVec(axis, sign));
            return sticker ? slotOf.get(sticker)! : -1;
          },
          (p, slot) => {
            positions.push(p[0], p[1], p[2]);
            slots.push(slot);
          },
        );
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const colourAttr = new THREE.Float32BufferAttribute(new Float32Array(positions.length), 3);
  geometry.setAttribute("color", colourAttr);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));

  const CORE = new THREE.Color(CORE_COLOUR);
  const faceColour = new Map<FaceKey, THREE.Color>();
  (Object.keys(FACES) as FaceKey[]).forEach((key) => faceColour.set(key, new THREE.Color(FACES[key].col)));

  function updateColours(): void {
    const arr = colourAttr.array as Float32Array;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const colour = slot >= 0 ? faceColour.get(cube.stickers[slot].cur)! : CORE;
      arr[3 * i] = colour.r;
      arr[3 * i + 1] = colour.g;
      arr[3 * i + 2] = colour.b;
    }
    colourAttr.needsUpdate = true;
  }
  updateColours();

  return { mesh, updateColours };
}
