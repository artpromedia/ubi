import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    treeshake: true,
  },
  {
    entry: ["dist/tailwind/theme.ts"],
    outDir: "dist/tailwind",
    format: ["cjs", "esm"],
    dts: true,
    splitting: false,
    sourcemap: false,
    clean: false,
  },
]);
