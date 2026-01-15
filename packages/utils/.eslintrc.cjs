module.exports = {
  root: true,
  extends: ["@ubi/eslint-config/node"],
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
  rules: {
    // Relax rules for utility helpers that have complex async patterns
    "require-await": "off",
    "@typescript-eslint/require-await": "off",
    "@typescript-eslint/no-floating-promises": "warn",
    "@typescript-eslint/promise-function-async": "off",
  },
};
