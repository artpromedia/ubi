/**
 * Workaround for ESLint's plugin-uniqueness check: `@ubi/eslint-config/next`
 * extends `next/core-web-vitals`, and eslint-config-next (pinned by
 * marketing-site, publicly hoisted by pnpm) bundles its own instance of
 * eslint-plugin-import that collides with @ubi/eslint-config's copy
 * ("ESLint couldn't determine the plugin \"import\" uniquely").
 * We therefore extend the shared react config plus the @next/next plugin's
 * core-web-vitals preset directly (it declares no import plugin) and reuse
 * the shared Next rule set verbatim, so the effective rules stay the same.
 */
const ubiNext = require("@ubi/eslint-config/next");

/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  ignorePatterns: ["next-env.d.ts"],
  extends: ["@ubi/eslint-config/react", "plugin:@next/next/core-web-vitals"],
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
  rules: ubiNext.rules,
  overrides: ubiNext.overrides,
};
