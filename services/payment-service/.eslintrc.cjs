module.exports = {
  root: true,
  extends: ["@ubi/eslint-config/node"],
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
  rules: {
    // Allow interface names starting with I (common pattern for service interfaces)
    "@typescript-eslint/naming-convention": [
      "error",
      {
        selector: "interface",
        format: ["PascalCase"],
      },
    ],
    // Allow async functions without await for interface compliance
    "require-await": "off",
    // Allow empty object types for Prisma-generated type extensions
    "@typescript-eslint/no-empty-object-type": "off",
    // Allow return await for cleaner stack traces in error handling
    "no-return-await": "off",
    // Allow throwing non-Error objects for custom error handling
    "@typescript-eslint/only-throw-error": "off",
  },
};
