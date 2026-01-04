/**
 * UBI Base ESLint Configuration
 * 
 * This is the foundation ESLint config that all other configs extend.
 * It includes rules that apply to all TypeScript code in the monorepo.
 */

/** @type {import("eslint").Linter.Config} */
module.exports = {
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  plugins: [
    "@typescript-eslint",
    "import",
    "turbo",
  ],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:import/recommended",
    "plugin:import/typescript",
    "plugin:turbo/recommended",
    "prettier",
  ],
  env: {
    es2022: true,
    node: true,
  },
  settings: {
    "import/resolver": {
      typescript: {
        alwaysTryTypes: true,
        project: ["tsconfig.json"],
      },
      node: true,
    },
  },
  rules: {
    // ===========================================
    // TypeScript Rules
    // ===========================================
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      },
    ],
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "@typescript-eslint/no-non-null-assertion": "warn",
    "@typescript-eslint/consistent-type-imports": [
      "error",
      {
        prefer: "type-imports",
        fixStyle: "inline-type-imports",
      },
    ],
    "@typescript-eslint/no-import-type-side-effects": "error",
    "@typescript-eslint/naming-convention": [
      "error",
      {
        selector: "interface",
        format: ["PascalCase"],
        custom: {
          regex: "^I[A-Z]",
          match: false,
        },
      },
      {
        selector: "typeAlias",
        format: ["PascalCase"],
      },
      {
        selector: "enum",
        format: ["PascalCase"],
      },
      {
        selector: "enumMember",
        format: ["UPPER_CASE", "PascalCase"],
      },
    ],

    // ===========================================
    // Import Rules
    // ===========================================
    "import/order": [
      "error",
      {
        groups: [
          "builtin",
          "external",
          "internal",
          ["parent", "sibling"],
          "index",
          "type",
        ],
        pathGroups: [
          {
            pattern: "@ubi/**",
            group: "internal",
            position: "before",
          },
        ],
        pathGroupsExcludedImportTypes: ["type"],
        "newlines-between": "always",
        alphabetize: {
          order: "asc",
          caseInsensitive: true,
        },
      },
    ],
    "import/no-duplicates": ["error", { "prefer-inline": true }],
    "import/no-unresolved": "error",
    "import/no-cycle": "error",
    "import/no-self-import": "error",
    "import/first": "error",
    "import/newline-after-import": "error",
    "import/no-mutable-exports": "error",

    // ===========================================
    // General Rules
    // ===========================================
    "no-console": ["warn", { allow: ["warn", "error", "info"] }],
    "no-debugger": "error",
    "no-alert": "error",
    "prefer-const": "error",
    "no-var": "error",
    "eqeqeq": ["error", "always"],
    "curly": ["error", "all"],
    "no-nested-ternary": "warn",
    "no-unneeded-ternary": "error",
    "spaced-comment": ["error", "always", { markers: ["/"] }],

    // ===========================================
    // Turbo Rules
    // ===========================================
    "turbo/no-undeclared-env-vars": "warn",
  },
  ignorePatterns: [
    "node_modules/",
    "dist/",
    "build/",
    ".next/",
    ".turbo/",
    "coverage/",
    "*.config.js",
    "*.config.mjs",
    "*.config.cjs",
    "__generated__/",
    "generated/",
  ],
};
