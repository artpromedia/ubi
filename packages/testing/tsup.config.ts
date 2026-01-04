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
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  splitting: false,
  treeshake: true,
  external: ["vitest", "msw"],
});
