/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ["@ubi/eslint-config/node"],
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
  rules: {
    // Disable rules not compatible with this package (generated imports)
    "@typescript-eslint/no-throw-literal": "off",
    "import/no-unresolved": "off",
    "import/no-cycle": "off",
    "import/no-self-import": "off",
    "import/export": "off",
  },
};
