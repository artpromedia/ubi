import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          50: "#E8F8EE",
          100: "#C5EDD6",
          200: "#9DE0B9",
          300: "#6FD199",
          400: "#4AC77F",
          500: "#1DB954",
          600: "#18A349",
          700: "#148D3E",
          800: "#107633",
          900: "#0B5F28",
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
          black: "#191414",
          white: "#FFFFFF",
          green: {
            DEFAULT: "#1DB954",
            50: "#E8F8EE",
            100: "#C5EDD6",
            200: "#9DE0B9",
            300: "#6FD199",
            400: "#4AC77F",
            500: "#1DB954",
            600: "#18A349",
            700: "#148D3E",
            800: "#107633",
            900: "#0B5F28",
          },
          move: "#1DB954",
          bites: "#FF7545",
          send: "#10AEBA",
        },
        // Driver-specific status colors
        driver: {
          online: "#1DB954",
          offline: "#6B7280",
          busy: "#F59E0B",
          break: "#3B82F6",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      keyframes: {
        "pulse-ring": {
          "0%": { transform: "scale(1)", opacity: "1" },
          "100%": { transform: "scale(1.5)", opacity: "0" },
        },
        "slide-up": {
          "0%": { transform: "translateY(100%)" },
          "100%": { transform: "translateY(0)" },
        },
      },
      animation: {
        "pulse-ring": "pulse-ring 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "slide-up": "slide-up 0.3s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
