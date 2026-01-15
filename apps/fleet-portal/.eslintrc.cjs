module.exports = {
  root: true,
  extends: ["@ubi/eslint-config/next"],
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
  ignorePatterns: ["next-env.d.ts"],
};
