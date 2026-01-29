/**
 * UBI Node.js ESLint Configuration
 *
 * For Node.js services and backend packages.
 * Extends base config with server-specific rules.
 */

/** @type {import("eslint").Linter.Config} */
module.exports = {
  extends: ["./base.js"],
  env: {
    node: true,
    es2022: true,
  },
  rules: {
    // ===========================================
    // Node.js Specific Rules
    // ===========================================

    // Console logging is acceptable in server code
    "no-console": "off",

    // Allow process.env access
    "node/no-process-env": "off",

    // Ensure proper async/await patterns
    "require-await": "error",
    "no-return-await": "error",
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/await-thenable": "error",
    "@typescript-eslint/promise-function-async": "error",

    // Security rules
    "no-eval": "error",
    "no-implied-eval": "error",
    "no-new-func": "error",

    // Error handling
    "@typescript-eslint/only-throw-error": "error",
    "prefer-promise-reject-errors": "error",

    // ===========================================
    // Service-Specific Patterns
    // ===========================================

    // Allow require for dynamic imports in Node.js
    "@typescript-eslint/no-var-requires": "warn",

    // Allow any in catch blocks for error handling
    "@typescript-eslint/no-explicit-any": [
      "warn",
      {
        ignoreRestArgs: true,
      },
    ],
  },
  parserOptions: {
    project: true,
    ecmaVersion: "latest",
    sourceType: "module",
  },
  overrides: [
    // Test files
    {
      files: [
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/__tests__/**/*.ts",
        "**/test/**/*.ts",
      ],
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-non-null-assertion": "off",
        "no-console": "off",
      },
    },
    // Migration files
    {
      files: ["**/migrations/**/*.ts", "**/seeds/**/*.ts"],
      rules: {
        "no-console": "off",
        "@typescript-eslint/no-explicit-any": "off",
      },
    },
  ],
};
