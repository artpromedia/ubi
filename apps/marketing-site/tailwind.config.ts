import type { Config } from "tailwindcss";
import sharedConfig from "@ubi/ui/tailwind.config";

import {
  marketingColors,
  marketingRadius,
  marketingSizes,
} from "./src/styles/marketing-tokens";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx}",
  ],
  presets: [sharedConfig],
  theme: {
    extend: {
      colors: {
        // UBI brand colours (packages/ui tokens)
        "ubi-black": "#191414",
        "ubi-green": "#1DB954",
        "ubi-white": "#FFFFFF",
        "ubi-move": "#1DB954",
        "ubi-bites": "#FF7545",
        "ubi-send": "#10AEBA",
        // Marketing tokens: the single source is src/styles/marketing-tokens.ts
        ...marketingColors,
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        heading: [
          "var(--font-poppins)",
          "var(--font-inter)",
          "system-ui",
          "sans-serif",
        ],
      },
      borderRadius: marketingRadius,
      minHeight: marketingSizes,
      keyframes: {
        slideIn: {
          from: { transform: "translateY(8px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        slideIn: "slideIn 0.2s ease-out",
      },
    },
  },
};

export default config;
