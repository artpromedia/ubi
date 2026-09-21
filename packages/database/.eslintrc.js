/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ["@ubi/eslint-config/node"],
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
  // This package is a thin re-export of the generated @prisma/client. The
  // eslint-plugin-import graph rules must not follow into that external,
  // generated package: its on-disk layout differs between a fresh
  // `prisma generate` and an incremental one, and `import/no-cycle` ENOENT'd
  // on node_modules/.prisma/client/default.d.ts in CI (present locally from a
  // prior generate, absent in a fresh CI checkout) — failing the lint with an
  // operational error rather than a real finding. Cycle/graph analysis through
  // a generated third-party client is meaningless anyway.
  settings: {
    "import/ignore": ["@prisma/client"],
  },
  rules: {
    "import/no-cycle": ["error", { ignoreExternal: true }],
  },
};
