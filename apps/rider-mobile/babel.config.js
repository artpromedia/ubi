// RN 0.79 Metro + jest transform. Handles TS/TSX/Flow/JSX for the app and the
// @ubi/mobile-* workspace source (which ships as TypeScript, not a built dist).
module.exports = {
  presets: ['module:@react-native/babel-preset'],
};
