module.exports = {
  root: true,
  extends: ["@ubi/eslint-config/node"],
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
  rules: {
    // API client methods return promises from base class
    "require-await": "off",
    "@typescript-eslint/require-await": "off",
    "@typescript-eslint/promise-function-async": "off",
  },
};
