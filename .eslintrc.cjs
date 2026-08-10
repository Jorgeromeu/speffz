module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: 2020, sourceType: "module" },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  env: { browser: true, es2020: true, node: true },
  ignorePatterns: ["dist", "node_modules"],
  overrides: [
    {
      // src/cube is the generic 3x3 engine: no three.js, no DOM, and no
      // Speffz vocabulary either — it must stay reusable by any labelling
      // scheme. See CLAUDE.md "Target structure".
      files: ["src/cube/**/*.ts"],
      excludedFiles: ["src/cube/**/*.test.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [{ name: "three", message: "src/cube must stay render-agnostic." }],
            patterns: [
              { group: ["three", "three/*"], message: "src/cube must stay render-agnostic." },
              { group: ["**/render/*"], message: "src/cube may not depend on src/render." },
              { group: ["**/speffz/*"], message: "src/cube may not depend on src/speffz — it must stay generic." },
            ],
          },
        ],
      },
    },
    {
      // src/speffz (lettering + Old Pochmann memo, built on cube/) is also
      // pure: no three.js, no DOM. It may depend on src/cube.
      files: ["src/speffz/**/*.ts"],
      excludedFiles: ["src/speffz/**/*.test.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [{ name: "three", message: "src/speffz must stay render-agnostic." }],
            patterns: [
              { group: ["three", "three/*"], message: "src/speffz must stay render-agnostic." },
              { group: ["**/render/*"], message: "src/speffz may not depend on src/render." },
            ],
          },
        ],
      },
    },
  ],
};
