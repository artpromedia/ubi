import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "vitest/index": "src/vitest/index.ts",
    "mocks/index": "src/mocks/index.ts",
    "fixtures/index": "src/fixtures/index.ts",
    "factories/index": "src/factories/index.ts",
    "matchers/index": "src/matchers/index.ts",
    "msw/index": "src/msw/index.ts",
  },
  format: ["esm"],  // ESM-only since test packages work well with ESM and top-level await is used
  dts: false, // Temporarily disabled - ESM module resolution requires .js extensions
  clean: true,
  splitting: false,
  treeshake: true,
  external: ["vitest", "msw"],
});
