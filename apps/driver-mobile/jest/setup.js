// Native-module mocks for the driver app's Jest suite. Same approach as the
// rider app: the React Native preset provides the base environment, and this
// file stubs the native modules the shared packages import so components can be
// rendered by react-test-renderer without a device or the native bridge.

// Secure storage (react-native-keychain) — @ubi/mobile-core/session imports it
// at module load. Return "no stored session" so nothing reaches the keychain.
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn().mockResolvedValue(false),
  setGenericPassword: jest.fn().mockResolvedValue(true),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));

// Safe-area context — @ubi/mobile-ui Screen/Sheet import it. Pass children
// through and report zero insets.
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  const inset = { top: 0, right: 0, bottom: 0, left: 0 };
  const frame = { x: 0, y: 0, width: 390, height: 844 };
  const pass = ({ children }) => React.createElement(View, null, children);
  return {
    SafeAreaProvider: pass,
    SafeAreaView: ({ children }) => React.createElement(View, null, children),
    SafeAreaInsetsContext: React.createContext(inset),
    useSafeAreaInsets: () => inset,
    useSafeAreaFrame: () => frame,
    initialWindowMetrics: { insets: inset, frame },
  };
});
