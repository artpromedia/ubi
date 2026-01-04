/**
 * UBI Tailwind CSS Preset
 *
 * Shared Tailwind configuration for all UBI web applications.
 * Import this preset in your app's tailwind.config.ts
 */

import type { Config } from "tailwindcss";
import { animation, borderRadius, breakpoints, colors, shadows, typography, zIndex } from "./tokens";

export const ubiPreset: Partial<Config> = {
  darkMode: ["class"],
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: "1rem",
        sm: "1.5rem",
        lg: "2rem",
      },
      screens: {
        sm: "640px",
        md: "768px",
        lg: "1024px",
        xl: "1280px",
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        // CSS variable-based colors for shadcn compatibility
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        // UBI Brand Colors
        ubi: {
          black: colors.ubi.black,
          green: colors.ubi.green,
          white: colors.ubi.white,
          gray: colors.ubi.gray,
          lightGray: colors.ubi.lightGray,
          // Service colors
          move: colors.services.move,
          bites: colors.services.bites,
          send: colors.services.send,
        },

        // Extended color palettes
        "ubi-green": colors.primary,
        "ubi-orange": colors.secondary,
        "ubi-teal": colors.tertiary,

        // Semantic colors
        success: colors.semantic.success,
        warning: colors.semantic.warning,
        error: colors.semantic.error,
        info: colors.semantic.info,
      },

      fontFamily: {
        heading: typography.fontFamily.heading,
        body: typography.fontFamily.body,
        sans: typography.fontFamily.body,
        mono: typography.fontFamily.mono,
      },

      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        ...borderRadius,
      },

      boxShadow: shadows,

      zIndex: zIndex,

      screens: breakpoints,

      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "fade-out": {
          from: { opacity: "1" },
          to: { opacity: "0" },
        },
        "slide-in-from-top": {
          from: { transform: "translateY(-100%)" },
          to: { transform: "translateY(0)" },
        },
        "slide-in-from-bottom": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
        "slide-in-from-left": {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(0)" },
        },
        "slide-in-from-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        "scale-in": {
          from: { transform: "scale(0.95)", opacity: "0" },
          to: { transform: "scale(1)", opacity: "1" },
        },
        "scale-out": {
          from: { transform: "scale(1)", opacity: "1" },
          to: { transform: "scale(0.95)", opacity: "0" },
        },
        "spin-slow": {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
        shimmer: {
          from: { backgroundPosition: "200% 0" },
          to: { backgroundPosition: "-200% 0" },
        },
        pulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        bounce: {
          "0%, 100%": {
            transform: "translateY(-25%)",
            animationTimingFunction: "cubic-bezier(0.8, 0, 1, 1)",
          },
          "50%": {
            transform: "translateY(0)",
            animationTimingFunction: "cubic-bezier(0, 0, 0.2, 1)",
          },
        },
        "ping-slow": {
          "75%, 100%": {
            transform: "scale(2)",
            opacity: "0",
          },
        },
      },

      animation: {
        "accordion-down": `accordion-down ${animation.duration.normal} ${animation.easing.easeOut}`,
        "accordion-up": `accordion-up ${animation.duration.normal} ${animation.easing.easeOut}`,
        "fade-in": `fade-in ${animation.duration.normal} ${animation.easing.easeOut}`,
        "fade-out": `fade-out ${animation.duration.normal} ${animation.easing.easeIn}`,
        "slide-in-from-top": `slide-in-from-top ${animation.duration.slow} ${animation.easing.easeOut}`,
        "slide-in-from-bottom": `slide-in-from-bottom ${animation.duration.slow} ${animation.easing.easeOut}`,
        "slide-in-from-left": `slide-in-from-left ${animation.duration.slow} ${animation.easing.easeOut}`,
        "slide-in-from-right": `slide-in-from-right ${animation.duration.slow} ${animation.easing.easeOut}`,
        "scale-in": `scale-in ${animation.duration.normal} ${animation.easing.easeOut}`,
        "scale-out": `scale-out ${animation.duration.normal} ${animation.easing.easeIn}`,
        "spin-slow": "spin-slow 3s linear infinite",
        shimmer: "shimmer 2s linear infinite",
        pulse: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        bounce: "bounce 1s infinite",
        "ping-slow": "ping-slow 2s cubic-bezier(0, 0, 0.2, 1) infinite",
      },

      // Typography plugin configuration
      typography: {
        DEFAULT: {
          css: {
            maxWidth: "65ch",
            color: "hsl(var(--foreground))",
            a: {
              color: colors.primary[500],
              textDecoration: "underline",
              fontWeight: "500",
              "&:hover": {
                color: colors.primary[600],
              },
            },
            strong: {
              color: "hsl(var(--foreground))",
              fontWeight: "600",
            },
            h1: {
              color: "hsl(var(--foreground))",
              fontFamily: typography.fontFamily.heading.join(", "),
              fontWeight: "700",
            },
            h2: {
              color: "hsl(var(--foreground))",
              fontFamily: typography.fontFamily.heading.join(", "),
              fontWeight: "600",
            },
            h3: {
              color: "hsl(var(--foreground))",
              fontFamily: typography.fontFamily.heading.join(", "),
              fontWeight: "600",
            },
            h4: {
              color: "hsl(var(--foreground))",
              fontFamily: typography.fontFamily.heading.join(", "),
              fontWeight: "600",
            },
            code: {
              color: "hsl(var(--foreground))",
              backgroundColor: "hsl(var(--muted))",
              borderRadius: "0.25rem",
              padding: "0.125rem 0.25rem",
              fontWeight: "400",
            },
            "code::before": {
              content: '""',
            },
            "code::after": {
              content: '""',
            },
            pre: {
              backgroundColor: "hsl(var(--muted))",
              color: "hsl(var(--foreground))",
              borderRadius: "0.5rem",
            },
            blockquote: {
              borderLeftColor: colors.primary[500],
              color: "hsl(var(--muted-foreground))",
            },
          },
        },
      },
    },
  },
  plugins: [],
};

export default ubiPreset;
