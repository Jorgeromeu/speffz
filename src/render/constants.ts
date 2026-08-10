// Shared rendering measurements. H/C/N are the exact tuning CLAUDE.md warns
// against re-deriving: half-cubie size, chamfer radius, and arc segments.
export const H = 0.487;
export const C = 0.082;
export const N = 6;
export const TEX = 256;
export const TILE = 2 * (H - C);
/** the cube's dark internal plastic, seen through inward-facing chamfer walls */
export const CORE_COLOUR = "#0d1015";
