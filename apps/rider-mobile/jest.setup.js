/**
 * Native-module mocks. Every module here is a native (TurboModule / Fabric)
 * dependency that has no meaning in the Node test environment; these mocks keep
 * tests from touching native code. Registered in setupFilesAfterEnv, so they
 * apply to every test file's import graph.
 */

// Secure storage (react-native-keychain) — used by @ubi/mobile-core session.
jest.mock('react-native-keychain', () => ({
  __esModule: true,
  getGenericPassword: jest.fn(async () => false),
  setGenericPassword: jest.fn(async () => true),
  resetGenericPassword: jest.fn(async () => true),
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
  ACCESS_CONTROL: { BIOMETRY_CURRENT_SET: 'BiometryCurrentSet' },
  AUTHENTICATION_TYPE: { BIOMETRICS: 'AuthenticationWithBiometrics' },
}));

// Safe-area context — used by @ubi/mobile-ui Screen/Sheet. Passthrough views + zero insets.
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  const insets = { top: 0, bottom: 0, left: 0, right: 0 };
  const frame = { x: 0, y: 0, width: 390, height: 844 };
  return {
    __esModule: true,
    SafeAreaProvider: ({ children }) => React.createElement(React.Fragment, null, children),
    SafeAreaView: React.forwardRef((props, ref) => React.createElement(View, { ...props, ref })),
    SafeAreaConsumer: ({ children }) => children(insets),
    SafeAreaInsetsContext: React.createContext(insets),
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
    initialWindowMetrics: { insets, frame },
  };
});

// MMKV fast storage.
jest.mock('react-native-mmkv', () => ({
  __esModule: true,
  MMKV: class {
    getString() { return undefined; }
    getBoolean() { return undefined; }
    getNumber() { return undefined; }
    set() {}
    delete() {}
    contains() { return false; }
    clearAll() {}
    getAllKeys() { return []; }
  },
}));

// NetInfo connectivity.
jest.mock('@react-native-community/netinfo', () => {
  const state = { isConnected: true, isInternetReachable: true, type: 'wifi' };
  return {
    __esModule: true,
    default: {
      addEventListener: jest.fn(() => () => {}),
      fetch: jest.fn(async () => state),
      configure: jest.fn(),
    },
    addEventListener: jest.fn(() => () => {}),
    fetch: jest.fn(async () => state),
    useNetInfo: () => state,
  };
});

// Reanimated — minimal stub (nothing under test animates).
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View, Text, ScrollView } = require('react-native');
  const noop = () => {};
  return {
    __esModule: true,
    default: { View, Text, ScrollView, createAnimatedComponent: (c) => c, call: noop },
    useSharedValue: (v) => ({ value: v }),
    useAnimatedStyle: (fn) => (typeof fn === 'function' ? fn() : {}),
    useDerivedValue: (fn) => ({ value: typeof fn === 'function' ? fn() : undefined }),
    withTiming: (v) => v,
    withSpring: (v) => v,
    withDelay: (_, v) => v,
    runOnJS: (fn) => fn,
    runOnUI: (fn) => fn,
    Easing: { linear: noop, inOut: () => noop, out: () => noop, ease: noop },
    interpolate: (v) => v,
    Extrapolation: { CLAMP: 'clamp' },
    createAnimatedComponent: (c) => c,
    View,
    Text,
    ScrollView,
  };
});

// Gesture handler — passthrough host components.
jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  const { View, ScrollView, FlatList, TextInput, TouchableOpacity } = require('react-native');
  const pass = (name) => {
    const C = ({ children, ...rest }) => React.createElement(View, rest, children);
    C.displayName = name;
    return C;
  };
  const gesture = () => {
    const g = {};
    for (const k of ['onBegin', 'onStart', 'onEnd', 'onUpdate', 'onFinalize', 'enabled', 'activeOffsetX', 'activeOffsetY', 'failOffsetX', 'failOffsetY', 'simultaneousWithExternalGesture']) {
      g[k] = () => g;
    }
    return g;
  };
  return {
    __esModule: true,
    GestureHandlerRootView: ({ children, ...rest }) => React.createElement(View, rest, children),
    GestureDetector: ({ children }) => children,
    Gesture: { Pan: gesture, Tap: gesture, Pinch: gesture, Fling: gesture, LongPress: gesture, Race: gesture, Simultaneous: gesture, Exclusive: gesture },
    Swipeable: pass('Swipeable'),
    PanGestureHandler: pass('PanGestureHandler'),
    TapGestureHandler: pass('TapGestureHandler'),
    ScrollView,
    FlatList,
    TextInput,
    TouchableOpacity,
    State: {},
    Directions: {},
  };
});

// Maps — passthrough MapView + marker stubs.
jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const stub = (name) => {
    const C = ({ children, ...rest }) => React.createElement(View, rest, children);
    C.displayName = name;
    return C;
  };
  const MapView = stub('MapView');
  return {
    __esModule: true,
    default: MapView,
    MapView,
    Marker: stub('Marker'),
    Polyline: stub('Polyline'),
    Callout: stub('Callout'),
    PROVIDER_GOOGLE: 'google',
  };
});

// Firebase app + messaging.
jest.mock('@react-native-firebase/app', () => ({
  __esModule: true,
  default: () => ({ options: {} }),
  firebase: { app: () => ({ options: {} }) },
}));
jest.mock('@react-native-firebase/messaging', () => {
  const messaging = () => ({
    requestPermission: jest.fn(async () => 1),
    getToken: jest.fn(async () => 'test-fcm-token'),
    onMessage: jest.fn(() => () => {}),
    onNotificationOpenedApp: jest.fn(() => () => {}),
    getInitialNotification: jest.fn(async () => null),
    setBackgroundMessageHandler: jest.fn(),
    hasPermission: jest.fn(async () => 1),
  });
  messaging.AuthorizationStatus = { AUTHORIZED: 1, PROVISIONAL: 2, DENIED: 0 };
  return { __esModule: true, default: messaging };
});

// Notifee local notifications.
jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    displayNotification: jest.fn(async () => 'notif-id'),
    createChannel: jest.fn(async () => 'channel-id'),
    onForegroundEvent: jest.fn(() => () => {}),
    onBackgroundEvent: jest.fn(),
    requestPermission: jest.fn(async () => ({ authorizationStatus: 1 })),
    cancelNotification: jest.fn(async () => {}),
  },
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
  EventType: { DELIVERED: 3, PRESS: 1, DISMISSED: 0 },
}));

// Permissions.
jest.mock('react-native-permissions', () => ({
  __esModule: true,
  check: jest.fn(async () => 'granted'),
  request: jest.fn(async () => 'granted'),
  checkNotifications: jest.fn(async () => ({ status: 'granted', settings: {} })),
  requestNotifications: jest.fn(async () => ({ status: 'granted', settings: {} })),
  openSettings: jest.fn(async () => {}),
  RESULTS: { UNAVAILABLE: 'unavailable', DENIED: 'denied', LIMITED: 'limited', GRANTED: 'granted', BLOCKED: 'blocked' },
  PERMISSIONS: { IOS: {}, ANDROID: {} },
}));

// Device info.
jest.mock('react-native-device-info', () => ({
  __esModule: true,
  default: {
    getUniqueId: jest.fn(async () => 'test-device-id'),
    getUniqueIdSync: jest.fn(() => 'test-device-id'),
    getVersion: jest.fn(() => '0.0.1'),
    getBuildNumber: jest.fn(() => '1'),
    getBundleId: jest.fn(() => 'africa.ubi.app'),
    getModel: jest.fn(() => 'jest'),
    getSystemName: jest.fn(() => 'iOS'),
    getSystemVersion: jest.fn(() => '17.0'),
    hasNotch: jest.fn(() => false),
  },
  getUniqueId: jest.fn(async () => 'test-device-id'),
  getVersion: jest.fn(() => '0.0.1'),
}));
