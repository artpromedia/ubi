/**
 * Rider RN app lint (handoff-rn CLAUDE.md rule 13 note: RN apps carry the same
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
    "jest.setup.js",
    ".eslintrc.js",
    "index.js",
  ],
  rules: {
    // Scoped to this app's established idioms (shared with driver-mobile): compact
    // single-block imports, named `function` components, single-line guards and
    // `import React`. Re-enabling these would mean reformatting every pre-existing
    // screen, which the RN handoff explicitly avoids. Correctness rules stay on.
    "import/order": "off",
    "import/newline-after-import": "off",
    "curly": "off",
    "react/function-component-definition": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      { varsIgnorePattern: "^React$|^_", argsIgnorePattern: "^_" },
    ],
  },
  overrides: [
    {
      // __tests__/ is outside tsconfig.json's include set (app build scope),
      // so lint the jest suites without a type-aware parser project.
      files: ["__tests__/**/*.ts", "__tests__/**/*.tsx"],
      parserOptions: { project: null },
    },
    {
      // Compile-time assertion aliases in the type tests are intentionally
      // `_`-prefixed throwaways (they exist only so tsc checks them); keep the
      // shared naming rule but allow the leading underscore for type aliases.
      files: ["src/__typetests__/**"],
      rules: {
        "@typescript-eslint/naming-convention": [
          "error",
          {
            selector: "interface",
            format: ["PascalCase"],
            custom: { regex: "^I[A-Z]", match: false },
          },
          {
            selector: "typeAlias",
            format: ["PascalCase"],
            leadingUnderscore: "allow",
          },
          { selector: "enum", format: ["PascalCase"] },
          { selector: "enumMember", format: ["UPPER_CASE", "PascalCase"] },
        ],
      },
    },
  ],
};
