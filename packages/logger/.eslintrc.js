/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ["@ubi/eslint-config/node"],
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
  rules: {
    // Disable import rules that have resolver issues
    "import/no-unresolved": "off",
    "import/no-self-import": "off",
    "import/default": "off",
  },
};
