import sharedConfig from "@ubi/ui/tailwind.config";

import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx}",
  ],
  presets: [sharedConfig],
  theme: {
    extend: {
      colors: {
        // UBI brand colors
        "ubi-black": "#191414",
        "ubi-green": "#1DB954",
        "ubi-white": "#FFFFFF",
        "ubi-move": "#1DB954",
        "ubi-bites": "#FF7545",
        "ubi-send": "#10AEBA",
      },
      fontFamily: {
        sans: ["var(--font-inter)"],
      },
    },
  },
};

export default config;
