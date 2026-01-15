module.exports = {
  root: true,
  extends: ["@ubi/eslint-config/next"],
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
  ignorePatterns: ["e2e/**", "playwright.config.ts", "next-env.d.ts"],
};
