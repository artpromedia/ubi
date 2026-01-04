import type { Config } from "tailwindcss";
import sharedConfig from "@ubi/ui/tailwind.config";

const config: Config = {
  presets: [sharedConfig],
  content: [
    "./src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Restaurant portal specific - uses UBI Bites orange theme
        restaurant: {
          primary: "#FF7545", // UBI Bites orange
          secondary: "#FF9B76",
          accent: "#1DB954",
          dark: "#191414",
        },
      },
    },
  },
  plugins: [],
};

export default config;
