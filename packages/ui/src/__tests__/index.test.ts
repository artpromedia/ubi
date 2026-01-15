import { describe, it, expect } from "vitest";

import * as ui from "../index";

describe("@ubi/ui", () => {
  it("should export Button component", () => {
    expect(ui.Button).toBeDefined();
  });

  it("should export Input component", () => {
    expect(ui.Input).toBeDefined();
  });

  it("should export utility functions", () => {
    expect(typeof ui.cn).toBe("function");
  });

  it("should export theme tokens", () => {
    expect(ui.ubiPreset).toBeDefined();
  });
});
