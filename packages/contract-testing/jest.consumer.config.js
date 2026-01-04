/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  preset: 'ts-jest',
  testMatch: ['**/consumers/**/*.pact.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: false,
    }],
  },
  moduleNameMapper: {
    '^@ubi/testing$': '<rootDir>/../testing/src',
  },
  testTimeout: 30000,
  verbose: true,
  collectCoverage: false,
};
