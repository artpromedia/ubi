import { describe, expect, it } from "vitest";

import {
  DESTINATION_ENV,
  httpsUrl,
  reportUnsetDestinations,
} from "@/lib/destination-env.mjs";

describe("httpsUrl", () => {
  it("accepts only https", () => {
    expect(httpsUrl("https://app.ubi.africa")).toBe("https://app.ubi.africa/");
    expect(httpsUrl("http://app.ubi.africa")).toBeUndefined();
    expect(httpsUrl("app.ubi.africa")).toBeUndefined();
    expect(httpsUrl("")).toBeUndefined();
    expect(httpsUrl(undefined)).toBeUndefined();
    expect(httpsUrl("  https://driver.ubi.africa/auth/signup ")).toBe(
      "https://driver.ubi.africa/auth/signup",
    );
  });
});

describe("reportUnsetDestinations", () => {
  it("names every unset or non-https destination variable", () => {
    const lines: string[] = [];
    const unset = reportUnsetDestinations(
      { UBI_RIDER_URL: "https://app.ubi.africa", UBI_TERMS_URL: "http://x" },
      (line: string) => lines.push(line),
    );
    expect(unset).toEqual(
      Object.values(DESTINATION_ENV).filter((name) => name !== "UBI_RIDER_URL"),
    );
    expect(lines).toHaveLength(Object.keys(DESTINATION_ENV).length - 1);
    expect(lines.some((line) => line.includes("UBI_TERMS_URL"))).toBe(true);
  });
});
