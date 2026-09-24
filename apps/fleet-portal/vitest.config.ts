import path from "node:path";

import { defineConfig } from "vitest/config";

// Unit tests for the fleet portal's pure modules (src/lib) and its screens.
// Node environment: the app has no DOM test runtime installed, so screens are
// rendered with react-dom/server and every decision a screen makes (which
// state it shows, which actions it offers, what it redacts) lives in a pure
// module that is tested directly.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next", "e2e"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
