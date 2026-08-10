"use strict";
// Ground-truth Monte Carlo check, run directly against the frozen
// reference/original.html (not a reimplementation) via load-original.cjs's
// DOM/three.js stub. Usage: node scripts/monte-carlo-original.cjs
const path = require("node:path");
const loadOriginal = require("./load-original.cjs");
const htmlPath = process.argv[2] || path.join(__dirname, "..", "reference", "original.html");
const probe = loadOriginal(htmlPath);
const { stickers, solve, scramble, target, bufCorner, bufEdge } = probe;

// Reimplementation of the ORIGINAL's own memo mechanics (dest/shoot/forced),
// extracted the same way memoDest/memoShoot/memoNext are defined inline in
// the script, so we exercise target() + ring exactly as the app does.
function ringsFor(kind) {
  const locs = [];
  stickers.forEach((s) => {
    if (s.kind === kind) locs[s.letter.charCodeAt(0) - 65] = s;
  });
  return locs;
}

function targetCount(kind, buf) {
  const locs = ringsFor(kind);
  const dest = locs.map((s) => target(s).letter.charCodeAt(0) - 65);
  const bufIdx = buf.letter.charCodeAt(0) - 65;
  function inBuffer(i) {
    return locs[bufIdx].ring.indexOf(i) >= 0;
  }
  function shoot(i) {
    const br = locs[bufIdx].ring, xr = locs[i].ring;
    for (let k = 0; k < br.length; k++) {
      const a = br[k], x = xr[k], t = dest[a];
      dest[a] = dest[x];
      dest[x] = t;
    }
  }
  function settled() {
    return dest.every((v, i) => v === i);
  }
  let steps = 0;
  while (!settled()) {
    if (steps++ > 200) throw new Error("did not settle");
    const forced = dest[bufIdx] !== bufIdx && !inBuffer(dest[bufIdx]) ? dest[bufIdx] : -1;
    let choice = forced;
    if (choice < 0) {
      choice = -1;
      for (let i = 0; i < 24; i++) {
        if (i === bufIdx || inBuffer(i) || dest[i] === i) continue;
        choice = i;
        break;
      }
      if (choice < 0) break;
    }
    shoot(choice);
  }
  return steps;
}

const N = 20000;
const cornerLens = [];
const edgeLens = [];
for (let i = 0; i < N; i++) {
  solve();
  scramble();
  cornerLens.push(targetCount("corner", bufCorner));
  edgeLens.push(targetCount("edge", bufEdge));
}

function stats(name, lens) {
  const sorted = lens.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const counts = {};
  lens.forEach((v) => (counts[v] = (counts[v] || 0) + 1));
  console.log(
    `${name}: n=${lens.length} min=${sorted[0]} max=${sorted[sorted.length - 1]} median=${median}`,
  );
  console.log(
    "  histogram:",
    Object.keys(counts)
      .map(Number)
      .sort((a, b) => a - b)
      .map((k) => `${k}:${counts[k]}`)
      .join(" "),
  );
}
stats("corner", cornerLens);
stats("edge", edgeLens);

let oddAgree = 0;
for (let i = 0; i < N; i++) if (cornerLens[i] % 2 === edgeLens[i] % 2) oddAgree++;
console.log(`parity agreement: ${oddAgree}/${N}`);
