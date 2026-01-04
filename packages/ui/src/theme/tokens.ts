/**
 * UBI Design Tokens
 *
 * Central source of truth for all design values.
 * These tokens are used to generate CSS variables and Tailwind config.
 */

// ===========================================
// Color System
// ===========================================

export const colors = {
  // Brand Colors
  ubi: {
    black: "#191414",
    green: "#1DB954",
    white: "#FFFFFF",
    gray: "#666666",
    lightGray: "#E5E5E5",
  },

  // Service Colors
  services: {
    move: "#1DB954", // UBI Move (Rides) - Green
    bites: "#FF7545", // UBI Bites (Food) - Orange
    send: "#10AEBA", // UBI Send (Delivery) - Teal
  },

  // Semantic Colors
  semantic: {
    success: "#22C55E",
    warning: "#F59E0B",
    error: "#EF4444",
    info: "#3B82F6",
  },

  // Grayscale
  gray: {
    50: "#F9FAFB",
    100: "#F3F4F6",
    200: "#E5E7EB",
    300: "#D1D5DB",
    400: "#9CA3AF",
    500: "#6B7280",
    600: "#4B5563",
    700: "#374151",
    800: "#1F2937",
    900: "#111827",
    950: "#030712",
  },

  // Primary Palette (UBI Green)
  primary: {
    50: "#ECFDF5",
    100: "#D1FAE5",
    200: "#A7F3D0",
    300: "#6EE7B7",
    400: "#34D399",
    500: "#1DB954", // Brand green
    600: "#059669",
    700: "#047857",
    800: "#065F46",
    900: "#064E3B",
    950: "#022C22",
  },

  // Secondary Palette (Warm Orange for Bites)
  secondary: {
    50: "#FFF7ED",
    100: "#FFEDD5",
    200: "#FED7AA",
    300: "#FDBA74",
    400: "#FB923C",
    500: "#FF7545", // UBI Bites
    600: "#EA580C",
    700: "#C2410C",
    800: "#9A3412",
    900: "#7C2D12",
    950: "#431407",
  },

  // Tertiary Palette (Teal for Send)
  tertiary: {
    50: "#F0FDFA",
    100: "#CCFBF1",
    200: "#99F6E4",
    300: "#5EEAD4",
    400: "#2DD4BF",
    500: "#10AEBA", // UBI Send
    600: "#0D9488",
    700: "#0F766E",
    800: "#115E59",
    900: "#134E4A",
    950: "#042F2E",
  },
} as const;

// ===========================================
// Typography
// ===========================================

export const typography = {
  fontFamily: {
    heading: ["Poppins", "system-ui", "sans-serif"],
    body: ["Inter", "system-ui", "sans-serif"],
    mono: ["JetBrains Mono", "Menlo", "monospace"],
  },

  fontSize: {
    xs: ["0.75rem", { lineHeight: "1rem" }],
    sm: ["0.875rem", { lineHeight: "1.25rem" }],
    base: ["1rem", { lineHeight: "1.5rem" }],
    lg: ["1.125rem", { lineHeight: "1.75rem" }],
    xl: ["1.25rem", { lineHeight: "1.75rem" }],
    "2xl": ["1.5rem", { lineHeight: "2rem" }],
    "3xl": ["1.875rem", { lineHeight: "2.25rem" }],
    "4xl": ["2.25rem", { lineHeight: "2.5rem" }],
    "5xl": ["3rem", { lineHeight: "1" }],
    "6xl": ["3.75rem", { lineHeight: "1" }],
  },

  fontWeight: {
    normal: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
    extrabold: "800",
  },
} as const;

// ===========================================
// Spacing
// ===========================================

export const spacing = {
  0: "0",
  px: "1px",
  0.5: "0.125rem",
  1: "0.25rem",
  1.5: "0.375rem",
  2: "0.5rem",
  2.5: "0.625rem",
  3: "0.75rem",
  3.5: "0.875rem",
  4: "1rem",
  5: "1.25rem",
  6: "1.5rem",
  7: "1.75rem",
  8: "2rem",
  9: "2.25rem",
  10: "2.5rem",
  11: "2.75rem",
  12: "3rem",
  14: "3.5rem",
  16: "4rem",
  20: "5rem",
  24: "6rem",
  28: "7rem",
  32: "8rem",
  36: "9rem",
  40: "10rem",
  44: "11rem",
  48: "12rem",
  52: "13rem",
  56: "14rem",
  60: "15rem",
  64: "16rem",
  72: "18rem",
  80: "20rem",
  96: "24rem",
} as const;

// ===========================================
// Border Radius
// ===========================================

export const borderRadius = {
  none: "0",
  sm: "0.125rem",
  DEFAULT: "0.25rem",
  md: "0.375rem",
  lg: "0.5rem",
  xl: "0.75rem",
  "2xl": "1rem",
  "3xl": "1.5rem",
  full: "9999px",
} as const;

// ===========================================
// Shadows
// ===========================================

export const shadows = {
  sm: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
  DEFAULT: "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
  md: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
  lg: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
  xl: "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
  "2xl": "0 25px 50px -12px rgb(0 0 0 / 0.25)",
  inner: "inset 0 2px 4px 0 rgb(0 0 0 / 0.05)",
  none: "none",
  // UBI specific shadows
  card: "0 2px 8px -2px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.06)",
  dropdown: "0 4px 12px -2px rgb(0 0 0 / 0.12), 0 2px 6px -2px rgb(0 0 0 / 0.08)",
  modal: "0 24px 48px -12px rgb(0 0 0 / 0.18)",
} as const;

// ===========================================
// Animation
// ===========================================

export const animation = {
  duration: {
    instant: "0ms",
    fast: "100ms",
    normal: "200ms",
    slow: "300ms",
    slower: "500ms",
  },

  easing: {
    linear: "linear",
    easeIn: "cubic-bezier(0.4, 0, 1, 1)",
    easeOut: "cubic-bezier(0, 0, 0.2, 1)",
    easeInOut: "cubic-bezier(0.4, 0, 0.2, 1)",
    bounce: "cubic-bezier(0.68, -0.55, 0.265, 1.55)",
  },
} as const;

// ===========================================
// Breakpoints
// ===========================================

export const breakpoints = {
  sm: "640px",
  md: "768px",
  lg: "1024px",
  xl: "1280px",
  "2xl": "1536px",
} as const;

// ===========================================
// Z-Index
// ===========================================

export const zIndex = {
  auto: "auto",
  0: "0",
  10: "10",
  20: "20",
  30: "30",
  40: "40",
  50: "50",
  dropdown: "100",
  sticky: "200",
  modal: "300",
  popover: "400",
  toast: "500",
} as const;

// ===========================================
// Type Exports
// ===========================================

export type ColorToken = typeof colors;
export type TypographyToken = typeof typography;
export type SpacingToken = typeof spacing;
export type BorderRadiusToken = typeof borderRadius;
export type ShadowToken = typeof shadows;
export type AnimationToken = typeof animation;
export type BreakpointToken = typeof breakpoints;
export type ZIndexToken = typeof zIndex;

export interface DesignTokens {
  colors: ColorToken;
  typography: TypographyToken;
  spacing: SpacingToken;
  borderRadius: BorderRadiusToken;
  shadows: ShadowToken;
  animation: AnimationToken;
  breakpoints: BreakpointToken;
  zIndex: ZIndexToken;
}

export const tokens: DesignTokens = {
  colors,
  typography,
  spacing,
  borderRadius,
  shadows,
  animation,
  breakpoints,
  zIndex,
};

export default tokens;
