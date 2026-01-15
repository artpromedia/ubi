module.exports = {
  root: true,
  extends: ["@ubi/eslint-config/next"],
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
  ignorePatterns: ["next-env.d.ts"],
  rules: {
    // Relax rules for marketing site - primarily static content
    "import/order": "warn",
    "react/function-component-definition": "warn",
    "react/no-unescaped-entities": "warn",
    curly: "warn",
  },
};
