// Blindfolded-method buffer definitions. Old Pochmann uses corner buffer
// UBL (letter A) and edge buffer UR (letter B) — see CLAUDE.md "Buffers".
// Kept as data rather than constants scattered through the drills, so a
// second method (M2 edge buffer DF, 3-style UFR/UF) is a new BufferSpec,
// not an edit to existing code.

import type { Letters } from "./letters";
import type { Sticker } from "../cube/state";

export interface BufferSpec {
  readonly name: string;
  readonly corner: { readonly letter: string; readonly label: string };
  readonly edge: { readonly letter: string; readonly label: string };
}

export const OLD_POCHMANN: BufferSpec = {
  name: "Old Pochmann",
  corner: { letter: "A", label: "UBL" },
  edge: { letter: "B", label: "UR" },
};

export interface Buffers {
  corner: Sticker;
  edge: Sticker;
}

export function resolveBuffers(letters: Letters, spec: BufferSpec = OLD_POCHMANN): Buffers {
  return {
    corner: letters.stickerFor("corner", spec.corner.letter),
    edge: letters.stickerFor("edge", spec.edge.letter),
  };
}
