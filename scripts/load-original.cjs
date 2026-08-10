// Executes the ACTUAL frozen reference/original.html logic in Node, with
// DOM/three.js stubbed to no-ops, so we can Monte-Carlo the real prototype
// directly rather than trust a re-implementation's own self-consistency.
"use strict";
const fs = require("fs");
const vm = require("vm");

module.exports = function loadOriginal(htmlPath) {
const html = fs.readFileSync(htmlPath, "utf8");
const scriptMatch = html.match(/<script>\s*\(function\(\)\{[\s\S]*?\}\)\(\);\s*<\/script>\s*<\/body>/);
if (!scriptMatch) throw new Error("could not locate inline script");
let src = scriptMatch[0].replace(/^<script>/, "").replace(/<\/script>\s*<\/body>$/, "");

// Expose the internals we want to Monte-Carlo by hanging them off a global
// right before the IIFE closes (textual edit of our COPY of the string in
// memory only — reference/original.html on disk is never touched).
src = src.replace(
  /\}\)\(\);\s*$/,
  `
  globalThis.__probe = {
    stickers, F, KEYS, turn, solve, scramble, target,
    bufCorner: null, bufEdge: null,
  };
  stickers.forEach(function(s){
    if (s.kind === "corner" && s.letter === "A") globalThis.__probe.bufCorner = s;
    if (s.kind === "edge" && s.letter === "B") globalThis.__probe.bufEdge = s;
  });
})();
`,
);

// ---- universal "never throws" stub, for THREE.* and all DOM objects ----
function makeChainable() {
  const fn = function () {};
  return new Proxy(fn, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return (hint) => (hint === "string" ? "" : 0);
      if (prop === "then") return undefined;
      if (prop === "classList") return { toggle() {}, add() {}, remove() {}, contains: () => false };
      if (prop === "style") return makeChainable();
      if (prop === "dataset") return {};
      if (prop === "firstElementChild") return makeChainable();
      return makeChainable();
    },
    set() {
      return true;
    },
    construct() {
      return makeChainable();
    },
    apply() {
      return makeChainable();
    },
  });
}

const fakeCanvasCtx = makeChainable();
function fakeElement() {
  const el = makeChainable();
  return el;
}

const documentStub = {
  getElementById: () => fakeElement(),
  createElement: (tag) => {
    const el = fakeElement();
    if (tag === "canvas") {
      // getContext must return something usable as a 2d context
      return new Proxy(el, {
        get(t, prop) {
          if (prop === "getContext") return () => fakeCanvasCtx;
          return el[prop];
        },
        set(t, prop, v) {
          el[prop] = v;
          return true;
        },
      });
    }
    return el;
  },
  addEventListener: () => {},
  documentElement: fakeElement(),
};

const windowStub = {
  devicePixelRatio: 1,
  ResizeObserver: undefined,
  storage: undefined,
  speechSynthesis: undefined,
  addEventListener: () => {},
  innerWidth: 800,
  innerHeight: 600,
};

const context = {
  document: documentStub,
  window: windowStub,
  THREE: makeChainable(),
  requestAnimationFrame: () => {},
  console,
  Math,
  globalThis: undefined, // filled below
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(src, context, { filename: "original.html-inline-script" });

return context.__probe;
};
