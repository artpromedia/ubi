import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    dts: false, // Disabled - re-exports from dist/ break rootDir constraint
    splitting: false,
    sourcemap: true,
    clean: false, // Don't clean - style-dictionary generates files to dist/ first
    treeshake: true,
  },
  {
    entry: { index: "dist/tailwind/theme.ts" },
    outDir: "dist/tailwind",
    format: ["cjs", "esm"],
    dts: false, // Disabled - generated file with external dependencies
    splitting: false,
    sourcemap: false,
    clean: false,
    external: ["tailwindcss"],
  },
]);
