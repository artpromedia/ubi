module.exports = {
  root: true,
  extends: ["@ubi/eslint-config/library"],
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
};
