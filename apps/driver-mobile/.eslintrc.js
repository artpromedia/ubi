/**
 * Driver RN app lint (handoff-rn CLAUDE.md rule 13 note: RN apps carry the same
 * `lint` script as the rest of the workspace). React Native ships no DOM, so the
 * jsx-a11y browser rules from the shared react config don't apply; RN accessibility
 * is enforced by the component contracts (accessibilityRole/Label on primitives).
 */
/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ["@ubi/eslint-config/react"],
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
  env: {
    browser: false,
    node: true,
  },
  ignorePatterns: [
    "node_modules/",
    "babel.config.js",
    "jest.config.js",
    ".eslintrc.js",
    "jest/",
  ],
  rules: {
    // Scoped to this app's established idioms (shared with rider-mobile): compact
    // single-block imports, named `function` components, single-line guards and
    // `import React`. Re-enabling these would mean reformatting every pre-existing
    // screen, which the RN handoff explicitly avoids. Correctness rules stay on.
    "import/order": "off",
    "import/newline-after-import": "off",
    curly: "off",
    "react/function-component-definition": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      { varsIgnorePattern: "^React$|^_", argsIgnorePattern: "^_" },
    ],
  },
};
