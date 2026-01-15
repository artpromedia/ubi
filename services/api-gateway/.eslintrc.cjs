module.exports = {
  root: true,
  extends: ["@ubi/eslint-config/node"],
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
  rules: {
    // Disable no-return-await as it conflicts with @typescript-eslint/promise-function-async
    // Awaiting return values provides better error stack traces
    "no-return-await": "off",
    "@typescript-eslint/return-await": ["error", "always"],
  },
};
