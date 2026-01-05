import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    react: "src/react.ts",
  },
  format: ["cjs", "esm"],
  dts: false, // Temporarily disabled - react-query type issues to be fixed
  splitting: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ["react", "@tanstack/react-query"],
});
