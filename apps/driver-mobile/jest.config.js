// Jest for the driver RN app. Mirrors the rider app's approach: the React Native
// preset plus a setup file that mocks the native modules the packages touch
// (Keychain, safe-area) so components render under react-test-renderer without a
// device. babel-jest is pinned to an absolute path because pnpm's strict
// node_modules does not hoist it into this app's tree.
const path = require('path');
const reactNativeDir = path.dirname(require.resolve('react-native/package.json'));
const babelJest = require.resolve('babel-jest', { paths: [reactNativeDir] });

/** @type {import('jest').Config} */
module.exports = {
  preset: 'react-native',
  rootDir: __dirname,
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': babelJest,
  },
  setupFilesAfterEnv: ['<rootDir>/jest/setup.js'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  // The React Native transform is heavy; when all suites compile at once on a
  // cold cache the async provider tests can briefly starve. A generous timeout
  // keeps the run deterministic without slowing the (sub-second) happy path.
  testTimeout: 20000,
  // pnpm nests every dependency under node_modules/.pnpm/<pkg>@<ver>/node_modules,
  // so the preset's default ignore pattern (which anchors on the first
  // node_modules/) skips the React Native family and leaves its Flow/JSX source
  // untransformed. Transform anything whose path mentions react-native (covers
  // react-native, @react-native/*, @react-native-community) or @react-navigation;
  // ignore the rest of node_modules. @ubi/* packages resolve to real paths under
  // packages/ (outside node_modules), so they are always transformed.
  transformIgnorePatterns: [
    'node_modules/(?!.*(?:react-native|@react-navigation))',
  ],
};
