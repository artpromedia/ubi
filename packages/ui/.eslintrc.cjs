module.exports = {
  root: true,
  extends: ["@ubi/eslint-config/react"],
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
};
