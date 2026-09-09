const path = require('path');

// The transform tooling (babel-jest, @babel/core, babel-preset-jest) is present
// in the pnpm store's hoisted layer but is not a declared dependency of this app,
// so it does not appear in this package's node_modules. Resolve babel-jest from
// the hoisted layer explicitly rather than relying on bare-specifier resolution
// (which the react-native preset assumes). @babel/core is resolved by babel-jest
// relative to its own store location, so nothing else needs wiring here.
const hoisted = path.resolve(__dirname, '../../node_modules/.pnpm/node_modules');
const babelJest = require.resolve('babel-jest', { paths: [hoisted] });

/** @type {import('jest').Config} */
module.exports = {
  // Brings in react-native's haste config, native setup (sets __DEV__ + mocks
  // NativeModules), the react-native test environment and transformIgnorePatterns.
  preset: 'react-native',
  rootDir: __dirname,
  // Override the preset transform (which references a bare `babel-jest`) with the
  // resolved path; keep the preset's asset transformer.
  transform: {
    '^.+\\.(js|jsx|ts|tsx|cjs|mjs)$': [
      babelJest,
      { configFile: path.resolve(__dirname, 'babel.config.js') },
    ],
    '^.+\\.(bmp|gif|jpg|jpeg|mp4|png|psd|svg|webp)$': require.resolve(
      'react-native/jest/assetFileTransformer.js',
    ),
  },
  // pnpm stores every package under node_modules/.pnpm/<name>@<version>/..., which
  // defeats the preset's default allow-list. Transform (don't ignore) any store dir
  // whose name is react-native / @react-native* / @react-navigation* — these ship
  // Flow/TS source that must be compiled (e.g. @react-native/js-polyfills). Workspace
  // @ubi/* packages resolve to their real path under packages/** (no node_modules) and
  // are always transformed. Everything else in node_modules stays ignored.
  transformIgnorePatterns: [
    'node_modules/\\.pnpm/(?!(?:@react-native|@react-navigation|react-native)[^/]*/)',
  ],
  // Native modules are mocked here so tests never touch native code.
  setupFilesAfterEnv: [path.resolve(__dirname, 'jest.setup.js')],
  testMatch: ['<rootDir>/__tests__/**/*.test.{ts,tsx}'],
  clearMocks: true,
};
