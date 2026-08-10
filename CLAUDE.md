# Speffz cube trainer

A blindfolded-cubing trainer: an orbitable 3D cube plus seven practice drills
(Speffz lettering, Old Pochmann buffers). Fully static client-side app, deployed
to GitHub Pages — no backend, no build step at request time.

`reference/original.html` is the original single-file prototype and the
behavioural spec for this port. **It is frozen — never edit it.** Diff against
it whenever a change might alter what the user sees on screen.

`docs/CONVENTIONS.md` has the detailed domain conventions, invariants, and open
bug list for the cube/Speffz/rendering logic. Read it before touching that code.

## Dev basics

- `npm run dev` — Vite dev server
- `npm test` / `npm run typecheck` / `npm run lint` — checks CI also runs
- `npm run build` — production build to `dist/`, deployed to Pages on push to `main`

`dev/harness.html` (+ `src/harness.ts`) is a dev-only page for exercising UI pieces
(cube/render, letter input, etc.) in isolation, outside of any drill. It's excluded
from `vite.config.ts`'s build inputs, so it's reachable via `npm run dev` but never
ships to `dist/` or Pages.

`src/cube/` (generic 3x3 engine) and `src/speffz/` (Speffz lettering + memo logic
built on top of it) stay dependency-free of three.js and the DOM — enforced by
ESLint. Only `render/`, `drills/`, and `ui/` touch the browser.
