/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ["@ubi/eslint-config/node"],
  parserOptions: {
    project: ["./tsconfig.json", "./tsconfig.test.json"],
    tsconfigRootDir: __dirname,
  },
};
