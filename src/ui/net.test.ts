import { describe, expect, it } from "vitest";
import { KEYS, type FaceKey } from "../cube/faces";
import { nextSelection } from "./net";

// The tap rule only; createNet() itself needs a DOM and isn't exercised here.
function sel(...keys: FaceKey[]): Set<FaceKey> {
  return new Set(keys);
}
function keys(set: ReadonlySet<FaceKey>): string {
  return KEYS.filter((k) => set.has(k)).join(" ");
}

describe("net tap rule — single", () => {
  it("selects exclusively, and re-tapping the selected face clears it", () => {
    expect(keys(nextSelection("single", sel(), "U"))).toBe("U");
    expect(keys(nextSelection("single", sel("U"), "R"))).toBe("R");
    expect(keys(nextSelection("single", sel("U"), "U"))).toBe("");
  });
});

describe("net tap rule — multi", () => {
  it("solos on the first tap of an unfiltered net", () => {
    expect(keys(nextSelection("multi", new Set(KEYS), "Fr"))).toBe("Fr");
  });

  it("plain-toggles once filtered", () => {
    expect(keys(nextSelection("multi", sel("Fr"), "B"))).toBe("Fr B");
    expect(keys(nextSelection("multi", sel("Fr", "B"), "Fr"))).toBe("B");
  });

  it("restores no-filter rather than emptying the pool", () => {
    expect(keys(nextSelection("multi", sel("Fr"), "Fr"))).toBe(KEYS.join(" "));
  });

  it("never mutates the set it was given", () => {
    const before = sel("Fr", "B");
    nextSelection("multi", before, "U");
    expect(keys(before)).toBe("Fr B");
  });
});
