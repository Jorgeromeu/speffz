# Speffz cube trainer — conventions, invariants, open bugs

Detailed reference material moved out of `CLAUDE.md` to keep that file short.
Read this before touching cube logic, rendering, or drill/UI state — it
records conventions that are easy to get subtly wrong and two bugs that were
already found and fixed the hard way.

---

## Non-negotiable constraints

Two product constraints outrank every technical preference below. If a proposed
change breaks either, the change is wrong.

### 1. Fully static

The app must run from a dumb file server — GitHub Pages, an S3 bucket, a USB stick.
No backend, no server-side rendering, no build step at request time, no API keys, no
runtime network call to anything but its own assets.

What this rules out, so nobody proposes it later:

- **No server-side routing.** Pages returns 404 on unknown deep paths. Keep app
  state in the query string or hash, and serve everything from one `index.html`.
  (If path routing is ever wanted, copy `index.html` to `404.html` at build.)
- **No environment variables at runtime.** Anything baked in at build time is public
  — treat the bundle as world-readable and never put a secret in it.
- **No database.** All persistence is client-side; see the Storage note and its
  known cross-device regression.
- **Relative asset paths only** (`base: '/<repo>/'`), or the deployed subpath 404s.

The upside worth claiming: a fully static bundle is trivially installable and can be
made offline-capable with a service worker. Nothing here needs a server, so nothing
here should ever acquire one.

### 2. Works properly on desktop *and* mobile

Not "mobile-first with a desktop fallback" — both are first-class. The prototype was
built on a phone and desktop is visibly the weaker of the two today. Requirements:

**Three input paths, all live at once.** Never assume which one is in use:

- *Touch* — orbit, tap to answer. Must stay on `touchstart/move/end`, **not** pointer
  events, and must `preventDefault`; see the Rendering section for why iOS forced
  this.
- *Mouse* — orbit via `mousedown` + window-level `mousemove`/`mouseup` (already
  wired). Hover affordances belong behind `@media (hover: hover)` so phones don't
  inherit sticky states.
- *Keyboard* — **does not exist yet and is required.** Letters A–X to answer, space
  for next, digits for tabs, arrows to orbit. A desktop user reaching for a mouse to
  tap a 24-letter keypad is a broken experience, and it's also the cheapest way to
  make the drills fast on a laptop.

**Layout must adapt, not just scale.** The prototype is a single narrow column, and
the camera fits the cube to the *narrower* canvas axis. On a short wide desktop
window that is the height, so the cube renders small — very likely the root cause of
open bug 2. A desktop layout should either cap the column width or move controls
beside the canvas rather than under it, and the fit logic should be revisited once it
does.

**Measure the canvas, never the window.** `clientWidth`/`clientHeight` via
`ResizeObserver`. `window.innerWidth` lies inside an iframe and once produced a
badly framed cube; the lesson generalises to any embed.

**Touch targets stay ≥44 px** even when a desktop layout has room to shrink them.

**No capability assumed present.** `speechSynthesis` (the `pace` drill) is absent or
gesture-locked in places, notably iOS Safari, which needs a user gesture to unlock
audio. Feature-detect and degrade to showing the letter rather than failing.

**CI runs both.** Every Playwright spec at a desktop viewport (1440×900) and a phone
viewport (390×844). A bug that only appears on one of them is the exact class of
problem this repo exists to catch.

---

## Target structure

The boundary that matters most: **`src/cube/` imports nothing.** No three.js, no
DOM — and no Speffz vocabulary either. It's a generic 3x3 sticker-position engine
(faces, turns, notation, scramble, generic piece-tracing) that any labelling scheme
could sit on top of. `src/speffz/` is the Speffz/Old-Pochmann layer built on it —
A-X lettering, buffers, ring/shoot mechanics, memo validation — and is itself still
pure (no three.js/DOM), just not generic. Only `render/`, `drills/`, and `ui/` touch
the browser. This is a tighter split than earlier drafts of this doc, which lumped
lettering and memo logic into `src/cube/` directly; separating "how a 3x3 cube
works" from "how Speffz labels it" means either half can be reused or replaced
without touching the other.

```
index.html                  markup only
src/
  main.ts                    wiring, mode state
  style.css
  cube/                      ← pure, zero deps, no Speffz vocabulary
    faces.ts                 face table (axis/sign/up/rt/colours), move notation
    state.ts                 sticker model, turns, scramble, target(), ringOf()
    rng.ts                   seedable PRNG (mulberry32)
    cube.test.ts
  speffz/                    ← pure, built on cube/, no three.js/DOM
    letters.ts               Speffz A-X lettering, derived from cube/ positions
    buffers.ts               buffer spec (Old Pochmann corner A / edge B), parameterized
    memo.ts                  rings, shoot, validator, canonical solver
    speffz.test.ts
  render/
    geometry.ts              chamfered cubies, colour slots, recolour
    tiles.ts                 letter tiles, marker rings
    ghosts.ts                x-ray overlays, billboarded labels
    view.ts                  ortho fit, orbit, picking
  drills/                    s2l, l2s, trace, memo, weighting
  ui/                        keypad, net, progress, status
.github/workflows/deploy.yml
```

Toolchain: **Vite + TypeScript + Vitest**, Playwright for the view. Set
`base: '/<repo>/'` in `vite.config.ts`; the site lives at a subpath, so an absolute
`/assets/…` will 404. Vite does not typecheck during build — run `tsc --noEmit` as a
separate CI step. Deploy with `actions/upload-pages-artifact@v3` +
`actions/deploy-pages@v4`, Pages source set to "GitHub Actions", and
`permissions: {pages: write, id-token: write}`. Playwright runs as its own job on PRs
only; it needs `--with-deps` and is slow.

A second Vite entry, `dev/harness.html` / `src/harness.ts`, exists alongside the real
app purely for visually driving `src/cube` + `src/render` directly — sliders for
orientation, corners/edges/peek toggles, face-turn buttons, scramble/solve, and a
way to force any sticker to `ask`/`good`/`bad` — without having to play a drill to
reach a given state. It is dev-only: `vite.config.ts` excludes it from
`build.rollupOptions.input`, so it is served under `npm run dev` but never lands in
`dist/` or gets deployed to Pages. This is where the ghost/render bugs below get
chased once `src/render/` exists.

We evaluated adopting an existing cube library (`cubing.js`'s `KPuzzle`/`Alg`,
`cubejs`, etc.) instead of hand-rolling `src/cube/`, and rejected it: every option
found models pieces moving through fixed positions, which is the *opposite* of this
app's "positions fixed, colours move" model that Speffz and the memo math both
depend on (see "Cube state model" below) — adapting one would reintroduce exactly
the piece-vs-position translation risk that caused bugs #1 and #2. `src/cube/` is
deliberately small and homegrown as a result.

**Pin three.js at r128.** Bundling unpins what the CDN pinned. r155+ changes colour
management and lighting defaults, and the six face hues were tuned by eye — orange
and yellow were deliberately pushed to 28° apart. Treat any upgrade as its own PR
with screenshot diffs.

### Two things to build early, before touching the view

Neither exists yet, and together they turn "it looks wrong on desktop" into a
failing test:

1. **Seedable RNG.** Replace `Math.random` in scramble and drill selection with an
   injected seeded generator, so a scramble is reproducible.
2. **State in the URL** — `?mode=l2s&seed=42&az=0.62&pol=1.0`. Then any bug is a
   link, and Playwright can go straight to it.

Fail Playwright tests on WebGL console warnings (`page.on('console')`). The black
square bug below is plausibly a material or texture warning nobody has ever seen.

---

## Domain conventions — do not change these

### Speffz lettering

Per face, letters run clockwise from the top-left sticker seen face-on. Faces in
order **U L F R B D** → offsets 0, 4, 8, 12, 16, 20. Corners and edges are two
independent A–X sets, so letter A is both a corner sticker and an edge sticker.

Sticker position within a face, by (row, col) with row 0 at top:

- corners `(0,0) (0,2) (2,2) (2,0)` → offset + 0,1,2,3
- edges   `(0,1) (1,2) (2,1) (1,0)` → offset + 0,1,2,3

The full mapping, which `cube.test.ts` must assert:

```
corners  A=UBL B=UBR C=UFR D=UFL  E=LUB F=LUF G=LDF H=LDB  I=FUL J=FUR K=FDR L=FDL
         M=RUF N=RUB O=RDB P=RDF  Q=BUR R=BUL S=BDL T=BDR  U=DFL V=DFR W=DBR X=DBL
edges    A=UB  B=UR  C=UF  D=UL   E=LU  F=LF  G=LD  H=LB   I=FU  J=FR  K=FD  L=FL
         M=RU  N=RB  O=RD  P=RF   Q=BU  R=BL  S=BD  T=BR   U=DF  V=DR  W=DB  X=DL
```

Face bases are `(right, up, normal)` and must stay right-handed — `right × up = normal`
— or textures render mirrored:

| face | axis | sign | up        | right     |
|------|------|------|-----------|-----------|
| U    | y    | +1   | (0,0,-1)  | (1,0,0)   |
| L    | x    | -1   | (0,1,0)   | (0,0,1)   |
| F    | z    | +1   | (0,1,0)   | (1,0,0)   |
| R    | x    | +1   | (0,1,0)   | (0,0,-1)  |
| B    | z    | -1   | (0,1,0)   | (-1,0,0)  |
| D    | y    | -1   | (0,0,1)   | (1,0,0)   |

The front face's key is `Fr` in the current code, because `F` collides with the face
table's own identifier. Rename freely, but the display label stays `F`.

### Colours

Standard Western scheme, so scrambles transfer to a physical cube held white-up /
green-front. Orange was deliberately pulled toward red and yellow toward green,
because the defaults were too close on a small screen: 28° of hue apart, not 18°.

```
U #f1f2ef   L #ec6a1a   F #1fa356   R #d8323c   B #2f66d0   D #f8da33
```

### Buffers

Old Pochmann: **corner buffer UBL** (corner letter A), **edge buffer UR** (edge
letter B). If other methods get added later (M2 edge buffer DF, 3-style UFR/UF),
make it a parameter rather than editing constants — implemented as `BufferSpec` in
`speffz/buffers.ts`, with `OLD_POCHMANN` as the current default.

### Camera

Locked home view: green front, white top, from up-front-right — `az 0.62, pol 1.0`.
Orthographic, fitted to the **narrower** screen axis. The camera never rotates on
its own; anything facing away is x-rayed instead. Two earlier attempts at
auto-rotating to the target were both rejected as too aggressive. Don't reintroduce
them.

---

## Cube state model

Positions are fixed; colours move. That matches Speffz, where letters label
locations rather than pieces.

A quarter turn rotates every sticker in the layer by −90° about the face normal:

```
v' = n(n·v) − n×v
```

applied to both the sticker's cell and its normal, then looked up in a
`cell|normal → sticker` map. Clockwise-viewed-from-outside. Derived, not tabulated —
don't replace it with hardcoded permutation tables.

Move notation maps `DIRS = [[0,1],[0,-1],[1,1],[1,-1],[2,1],[2,-1]]` to
`["R","L","U","D","F","B"]`; suffix `2` for a double, `'` for three quarter turns.
Scrambles are 20 random turns with no consecutive same-axis moves.

`target(sticker)` answers "where does the sticker currently at this location
belong?" — read the colour set of the whole cubie, find the home cubie with that
set, return the sticker there whose home face matches the colour sitting at the
queried location.

---

## Memo validation — the subtle part

An Old Pochmann shoot is a transposition on the stickers of one orbit, so a full
memo can be simulated without turning anything.

`dest[i]` = home location of the sticker now at location i, indexed by letter
(0–23) within one piece type. Memo is complete when `dest` is the identity.

### A shoot moves a whole piece

**This was bug #1.** A shoot is not a single-sticker swap. It swaps whole pieces —
three stickers for a corner, two for an edge — aligning the two targeted stickers,
with the rest following by cyclic offset:

```ts
for (let k = 0; k < bufferRing.length; k++) swap(dest, bufferRing[k], targetRing[k]);
```

`ring` is a cubie's stickers in clockwise order seen from outside, starting at the
sticker itself. Clockwise means `det[n0, p, q] < 0`; swap `p` and `q` if positive.
Treating it as a one-sticker swap produced corner memos of 25 targets instead of 8
and no parity, which is the signature to watch for if this regresses.

### You can never shoot at your own buffer piece

**This was bug #2.** `dest[buffer]` can point at another sticker of the buffer's own
cubie — a twisted buffer. The solver looped forever on it. The rule:

```ts
const forced = (dest[b] !== b && !inBuffer(dest[b])) ? dest[b] : -1;  // -1 = must break in
```

where `inBuffer(i)` tests membership in the buffer sticker's ring. For corner
buffer UBL that permanently excludes A, E and R.

### The three rules the validator enforces

Judge each letter against state, never against a stored solution — break-ins are a
free choice and there is no unique correct memo.

1. letter is on the buffer piece → reject, "cannot shoot at it"
2. `forced >= 0` and letter ≠ forced → reject, "the buffer shoots to X"
3. `forced < 0` and `dest[letter] === letter` → reject, "already solved"

Otherwise accept, apply the shoot, and check for completion. Rejected letters are
not appended, so the running sequence stays valid. Undo replays from the scramble.

### Costs, for sanity checking

- twisted corner in place: 2 targets each
- twisted buffer + one other twisted corner: 2 targets total, resolved together
- an m-piece cycle not containing the buffer: m+1 targets, and it closes by
  returning to the break-in letter, so that letter repeats

---

## Invariants — ported as Vitest

Split across `src/cube/cube.test.ts` (generic: turns, notation, scramble) and
`src/speffz/speffz.test.ts` (lettering, memo, validator). All were verified against
the current implementation; the expected values are real measurements, not guesses.

| check | expectation |
|---|---|
| four quarter turns of any face | identity |
| 30-move scramble then inverse | solved |
| printed notation re-applied from solved | reproduces displayed state (400 scrambles) |
| `R U R' U' R' F R2 U' R' U' R U R' F'` | touches exactly UFR, UBR, UL, UR |
| `(R U R' U')` ×6 | solved |
| all 48 Speffz letters | match the table above |
| `dest` for either orbit, any scramble | is a bijection on 0–23 |
| canonical memo | always settles (3000 scrambles) |
| corner vs edge target counts | **always share parity** (5000/5000) |
| corner targets | median 8; historically ~3–13 across runs |
| edge targets | median 12; historically ~5–18 across runs |
| parity rate | ~50% |
| validator, random legal break-ins | accepts and completes 3000/3000 |
| validator, one corrupted letter | rejects 100% |

The parity agreement is the strongest single check — total transpositions must be
even — and it is also the self-check the drill teaches the user.

The corner/edge target ranges above were originally written down as "4–12" and
"7–16" from limited observation. A 20000-trial Monte Carlo run directly against the
frozen `original.html` (not a reimplementation) showed the real range is wider and
shifts run to run — see `scripts/load-original.cjs` (regex/stub-extracts and runs
the actual inline script under Node with three.js/DOM no-op'd) and
`scripts/monte-carlo-original.cjs` (drives it). Reach for these whenever a
statistical claim in this file is in doubt — they check against the frozen prototype
itself, not against another reimplementation that could share the same bug. The
median is the tight, load-bearing invariant; the range is a loose sanity bound.

---

## Rendering details worth preserving

Each was arrived at by rejecting something worse; re-deriving them is wasted effort.

- **Chamfer only the cube's outer edges.** Walls between neighbouring pieces stay
  square. Radius 0.082 of a 0.487 half-cubie, 6-segment arcs, and each cube corner
  is three single-colour spherical patches meeting on the body diagonal — bordered
  by the exact arcs the adjoining strips split on, so seams line up.
- **Hard colour split at the crest, never a gradient.** The whole cube uses exactly
  7 vertex colours: six faces plus the dark core. An earlier gradient version sent
  white→red through pink and looked cheap.
- **Vertex colours are slot-indexed**, so a scramble recolours the plastic without
  rebuilding geometry.
- **Ghosts.** A marked sticker on a face turned away (`normal · viewDir < 0.14`) is
  drawn through the cube: dashed ring, `depthTest: false`, double-sided, plus the
  other eight squares of that face as pale outlines for spatial reference.
- **Labels billboard.** Revealed letters ride on planes that copy the camera
  quaternion. Painting them on the face plane makes them mirrored, and flipping the
  plane fixes the vertical faces but leaves D upside down.
- **Three label strengths**: full, faint (face ink mixed 20% into the plastic
  colour, used while a grid is showing), and off.
- **Touch, not pointer events.** `touchstart`/`touchmove` with `preventDefault()`
  and non-passive listeners, plus a document-level block. Pointer events let iOS
  read an orbit drag as a navigation swipe and close the tab.
- **Measure the canvas, not the window.** `canvas.clientWidth/Height` via
  `ResizeObserver`. `window.innerWidth` lies inside an iframe and broke the framing.

Bundling removes the three.js r128 CDN pin — use current three with `@types/three`.
The hand-rolled orbit control stays regardless; it exists because the camera is
deliberately constrained.

---

## Drills and UI state

Seven tabs: `learn` (reference), `s2l`, `piece`, `l2s`, `trace`, `memo`, `pace`.

Shared controls: corners/edges toggles (label visibility in `learn`, question-pool
filter elsewhere), face pool filter, arrows overlay (`learn` only), peek (quizzes
only). Face net chips — a *separate* thing from the pool filter: focus a single
face in `learn`, select a face to answer in `l2s`.

**One settings surface (`src/ui/controls.ts`).** The original scattered these:
four buttons pinned top-right plus a "pool" net in the drill chrome, each drill
re-implementing which of them it honours. The port folds all of them into a single
top-right panel. Two groups, and the split is load-bearing:

- **pool** (corners, edges, faces) changes *what gets asked* → `onPoolChange`, and
  every drill re-asks. (The original re-asked in `s2l` only, leaving `l2s`/`piece`
  showing a question the new pool excludes.)
- **show** (arrows, peek) changes *what you see* → `onDisplayChange`, repaint only.

**Pinned, not collapsed, whenever there's room.** Above 760×560 the panel simply
sits open in the corner (static flow, no trigger, no drop shadow) — it is small,
and hiding a handful of toggles behind a tap on a screen with empty space beside
the cube buys nothing. Below that it becomes a dropdown, and the collapsed trigger
must then carry the whole state: it lists every non-default setting in panel order
(`edges · FB · peek`) and is accent-lit while any is active. A hidden panel may not
hide an active question filter, or you'd wonder why only eight letters ever come
up — and peek left on is the difference between practising and reading the answers
off the cube. The media query is live, so a resize flips presentation either way.

The component owns no drill vocabulary. `setLayout()` says which groups are
relevant and the host decides: `learn` hides the pool net, quizzes hide arrows.
A tab switch resets *display* only — the pool is a "what am I training today"
choice and must survive moving between drills. The trigger summarises only what
the current layout exposes, so a filter carried into `learn` doesn't advertise
itself where it can't be seen or changed.

**Face pool filter.** Restricts which faces the drills draw letters from —
orthogonal to corners/edges, so edges-only × {green, blue} gives exactly
I J K L Q R S T. Hidden in `learn` (the chips already isolate faces there) and
`memo` (whole-cube memo can't be filtered). The rule itself lives in
`src/drills/pool.ts` as a pure `PoolFilter` (all six faces = no filter), not inside
the widget, so all drills share one definition and it is testable without a DOM.
It filters on a sticker's **home** face, i.e. its location, never the colour
currently there — a letter labels a location, so "only F" stays I–L on a scrambled
cube.

Interaction rule, verified by test (`nextSelection` in `src/ui/net.ts`): first tap
on an unfiltered net **solos** that face, because training one face is the common
want and shouldn't cost five taps. After that each tap is a plain toggle, and
emptying the net restores no-filter rather than leaving an empty pool. Multi mode
also **dims** the out-of-pool faces (single mode never does — nothing-selected is
its resting state), because a filter has to read at a glance and the selected
ring alone doesn't carry it. Combined
with the last corner/edge toggle being sticky, the pool can never actually go
empty; drills still guard for it, since `freshPool` permits it. Faces map to letter
blocks U=A–D, L=E–H, F=I–L, R=M–P, B=Q–T, D=U–X.

`trace` needs care here: it re-rolls scrambles hunting the weakest letter, and a
narrow filter makes that hunt likely to exhaust its cap. It then falls back to
re-rolling until the target is anywhere inside the filter, and a final uncapped loop
guarantees the buffer never shoots to itself. Note `solve()` and `scramble()` only
mutate `s.cur` — no repaint — so a 600-iteration re-roll is cheap. Keep that true.

**`pace` drill.** Letters spoken via `speechSynthesis`, lowercase to avoid
"capital A", prefixed "corner"/"edge" only when both toggles are on. Hands stay on a
real cube; the isolated piece appears at 55% of the interval as an answer key.

Interval is a manual slider, 0.6–5.0 s. An earlier version adapted automatically and
had to be removed: it inferred success from the absence of a miss tap, and since the
user never taps, it accelerated without bound. Two consequences to preserve:

- An **unflagged beat records nothing** in the weighting. Silence is not evidence.
  Only an explicit tap writes, and it writes a miss. `pace` therefore has no progress
  column, since it can only ever move levels down.
- The **`ramp`** toggle (opt-in, off by default) is one-way and blind: `ms *= 0.985`
  per beat, floored at 600 ms to agree with the slider minimum, reading nothing from
  whether a beat was flagged. From 2.6 s that reaches the floor around beat 98. The
  slider tracks the drift so it stays visible and grabbable.

**Weighting.** Leitner levels 0–4 per drill/kind/letter, draw weight `2^(4-level)`,
previous item down-weighted ×0.12. A miss drops to 0, a hit steps up one. Measured:
four weak letters take 61% of draws, nothing goes unshown, immediate repeats under
2%. `trace` picks the weakest target first, then re-rolls scrambles until one traces
to it — ~23 rolls average, capped at 120.

**Storage.** Currently `window.storage` (artifact API) with an in-memory fallback,
one JSON key `speffz:levels`, 900 ms debounce, and a `HAS_STORE` flag that surfaces
"saved" vs "this session only". Once hosted, make it
`window.storage → localStorage → memory`.

Known regression in the move: the artifact API is tied to an account and follows the
user between phone and laptop; `localStorage` is per-device, so Leitner levels will
fork. Cheapest honest mitigation is JSON export/import. Real fix is a Cloudflare
Worker plus KV keyed on a device token.

---

## Open bugs — the reason this repo exists

Reported from the artifact, none reproduced or diagnosed, all in the view layer:

1. **`l2s` ghost renders as a black square** instead of the dashed ring overlay.
   Worth checking first: the ghost materials use `depthTest:false`,
   `depthWrite:false`, `side:DoubleSide` and `renderOrder` 15–24, and the ring is a
   `CanvasTexture`. A black square smells like a texture that failed to upload or a
   material whose map is null, not like a depth-sorting problem.
2. **Ghosting behaves differently on desktop and mobile.** There is no platform
   branch anywhere in the ghost path — no UA sniffing, no touch/mouse gating, and
   the visibility test is pure geometry (`s.normal.dot(dir) < 0.14`). So the
   divergence is a symptom of something else. Leading theory: the camera fits the
   cube to the narrower canvas axis, which on a short wide desktop panel makes the
   cube much smaller, and a hairline dashed stroke at 1x DPR can simply vanish.
   Screenshot tests at both viewports should settle it immediately.
3. **`trace` "not working properly"** — symptom not yet pinned down. Suspect the
   filter-aware re-roll described above.
4. Further unspecified issues; expect more once the view is observable.

Do not fix these by reading the code. Get the repo deployed, get screenshot
baselines of current behaviour (bugs included — a baseline of a buggy app is still
the contract for "don't break anything else"), then debug with devtools.

---

## Migration order

Big-bang rewrites lose working behaviour that can't be recovered. Strangle instead:

1. Drop `reference/original.html` in as `index.html` unchanged. Get Vite building and
   Pages deploying. Nothing refactored — the app is live and installable.
2. Add the seeded RNG and URL state. Capture Playwright baselines at desktop and
   phone viewports.
3. Extract `src/cube/` (generic 3x3 engine) and `src/speffz/` (Speffz lettering +
   Old Pochmann memo) built on top of it. Port the invariant suite below to Vitest,
   split across `cube.test.ts` and `speffz.test.ts`. Core goes green.
4. Only then fix the view bugs.

Enforce the boundary with an ESLint `no-restricted-imports` rule on `src/cube/` and
`src/speffz/`, so neither can quietly acquire a dependency on three or the DOM (and
`src/speffz/` can't reach into `src/render/`).

---

## Ideas not yet built

- keyboard input — type letters, space for next, digits for tabs (desktop; overdue,
  and more pressing now that desktop is a first-class target)
- web manifest, `display: standalone`, icon. Side benefit: with no browser chrome
  there is nothing to swipe-navigate, so the document-level `touchmove`
  `preventDefault` hack that iOS forced may become unnecessary
- optional: a miss tap in `pace` nudging the interval back a step (deliberately not
  wired, to keep `ramp` blind)
- self-check that runs the invariants at load and warns visibly if the model breaks
- per-letter accuracy display, e.g. tinting the reference rows by mastery
- selectable buffers / method variants
- letter-pair image training — probably out of scope, Anki does it better
