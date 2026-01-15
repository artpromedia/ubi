import sharedConfig from "@ubi/ui/tailwind.config";

import type { Config } from "tailwindcss";

const config: Config = {
  presets: [sharedConfig],
  content: ["./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Admin-specific colors
        admin: {
          primary: "#191414",
          secondary: "#2563eb", // Blue for admin actions
          accent: "#1DB954",
          warning: "#f59e0b",
          danger: "#ef4444",
          success: "#22c55e",
        },
      },
    },
  },
  plugins: [],
};

export default config;
