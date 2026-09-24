import path from "node:path";

import { defineConfig } from "vitest/config";

// Unit tests for the web app's pure modules and server-rendered views. Node environment: the
// app has no DOM test runtime installed, so views are rendered with react-dom/server and
// client logic lives in pure modules (src/lib) that are tested directly.
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
