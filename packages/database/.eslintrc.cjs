module.exports = {
  root: true,
  extends: ["@ubi/eslint-config/node"],
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
};
