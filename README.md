# Speffz cube trainer

A blindfolded-cubing trainer: orbitable 3D cube, Speffz lettering, Old Pochmann
buffers, seven practice drills.

A fully static client-side web app — no backend — deployed to GitHub Pages, and
intended to work equally well on desktop and mobile.

Currently mid-port from a single-file prototype to a real app. `reference/original.html`
is the frozen prototype and the behavioural spec — never edit it. See `CLAUDE.md`
for the basics and `docs/CONVENTIONS.md` for domain conventions, invariants, and
open bugs.

## Dev

```
npm run dev        # Vite dev server, incl. dev/harness.html
npm test           # Vitest
npm run typecheck
npm run lint
npm run build      # production build to dist/
```
