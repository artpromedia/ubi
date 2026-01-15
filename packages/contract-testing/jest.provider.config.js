/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  preset: "ts-jest",
  testMatch: ["**/providers/**/*.verify.ts"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: false,
      },
    ],
  },
  moduleNameMapper: {
    "^@ubi/testing$": "<rootDir>/../testing/src",
  },
  testTimeout: 60000,
  verbose: true,
  collectCoverage: false,
  // Run provider tests sequentially
  maxWorkers: 1,
};
