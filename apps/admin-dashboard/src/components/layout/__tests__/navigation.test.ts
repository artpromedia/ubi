import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { navigation } from "../navigation";

const ADMIN_APP_DIR = path.resolve(__dirname, "../../../app/(admin)");

describe("Admin sidebar navigation (P3-12)", () => {
  it("resolves every top-level and child href to a real page.tsx on disk", () => {
    const allHrefs: string[] = [];
    for (const item of navigation) {
      allHrefs.push(item.href);
      for (const child of item.children ?? []) {
        allHrefs.push(child.href);
      }
    }

    expect(allHrefs.length).toBeGreaterThan(0);

    for (const href of allHrefs) {
      const pagePath = path.join(
        ADMIN_APP_DIR,
        href.replace(/^\//, ""),
        "page.tsx",
      );
      expect(
        existsSync(pagePath),
        `Expected ${href} to resolve to ${pagePath}`,
      ).toBe(true);
    }
  });

  it("does not contain dead links to unbuilt sections", () => {
    const allHrefs = new Set<string>();
    for (const item of navigation) {
      allHrefs.add(item.href);
      for (const child of item.children ?? []) {
        allHrefs.add(child.href);
      }
    }

    for (const deadHref of [
      "/rides",
      "/food",
      "/deliveries",
      "/safety",
      "/settings",
      "/help",
      "/users/riders",
      "/payments/payouts",
      "/verification/background",
    ]) {
      expect(allHrefs.has(deadHref)).toBe(false);
    }
  });
});
