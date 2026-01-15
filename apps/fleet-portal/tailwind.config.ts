import sharedConfig from "@ubi/ui/tailwind.config";

import type { Config } from "tailwindcss";

const config: Config = {
  presets: [sharedConfig],
  content: [
    "./src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Fleet portal specific - uses UBI Move green theme
        fleet: {
          primary: "#1DB954", // UBI green
          secondary: "#22c55e",
          accent: "#191414",
          dark: "#191414",
        },
      },
    },
  },
  plugins: [],
};

export default config;
