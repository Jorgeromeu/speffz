import { defineConfig } from "vite";
import { resolve } from "node:path";

// The site deploys to a GitHub Pages project subpath, so every asset
// reference must be relative — see CLAUDE.md "Fully static".
//
// dev/harness.html is dev-only: it's served fine under `vite dev` without
// being listed here, but leaving it out of rollupOptions.input keeps it out
// of `dist/` (and therefore off Pages) when we build.
export default defineConfig({
  base: "/speffz/",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
      },
    },
  },
});
