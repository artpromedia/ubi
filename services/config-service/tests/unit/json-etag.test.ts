import { describe, expect, it } from "vitest";

import { etagMatches, strongEtag } from "@/lib/etag";
import { applyPatch, canonicalJson, diffJson } from "@/lib/json";

describe("applyPatch", () => {
  it("merges nested objects instead of replacing them", () => {
    const base = { waitPolicy: { freeSec: 300, perMinMinor: 5_000 }, pinRequired: true };
    expect(applyPatch(base, { waitPolicy: { perMinMinor: 6_000 } })).toEqual({
      waitPolicy: { freeSec: 300, perMinMinor: 6_000 },
      pinRequired: true,
    });
  });

  it("replaces arrays wholesale", () => {
    const base = { vehicleClasses: ["go", "comfort", "xl"] };
    expect(applyPatch(base, { vehicleClasses: ["go"] })).toEqual({ vehicleClasses: ["go"] });
  });

  it("removes a key when the patch sets it to null", () => {
    expect(applyPatch({ a: 1, b: 2 }, { b: null })).toEqual({ a: 1 });
  });

  it("does not mutate the base", () => {
    const base = { waitPolicy: { freeSec: 300 } };
    applyPatch(base, { waitPolicy: { freeSec: 60 } });
    expect(base).toEqual({ waitPolicy: { freeSec: 300 } });
  });
});

describe("diffJson", () => {
  it("reports only the leaves that changed", () => {
    const before = { a: 1, nested: { x: 1, y: 2 } };
    const after = { a: 1, nested: { x: 1, y: 3 } };
    expect(diffJson(before, after)).toEqual([{ path: "nested.y", before: 2, after: 3 }]);
  });

  it("reports additions and removals", () => {
    expect(diffJson({ a: 1 }, { b: 2 })).toEqual([
      { path: "a", before: 1, after: undefined },
      { path: "b", before: undefined, after: 2 },
    ]);
  });

  it("ignores key order", () => {
    expect(diffJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual([]);
  });
});

describe("canonicalJson", () => {
  it("sorts keys at every depth", () => {
    expect(canonicalJson({ b: 1, a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":1}');
  });
});

describe("strongEtag", () => {
  it("is stable for equal values regardless of key order", () => {
    expect(strongEtag({ a: 1, b: 2 })).toBe(strongEtag({ b: 2, a: 1 }));
  });

  it("changes when any value changes", () => {
    expect(strongEtag({ version: 1 })).not.toBe(strongEtag({ version: 2 }));
  });

  it("is a strong validator", () => {
    expect(strongEtag({ a: 1 })).toMatch(/^"[A-Za-z0-9_-]+"$/);
  });
});

describe("etagMatches", () => {
  const etag = strongEtag({ version: 1 });

  it("matches an exact tag", () => {
    expect(etagMatches(etag, etag)).toBe(true);
  });

  it("matches inside a list", () => {
    expect(etagMatches(`"other", ${etag}`, etag)).toBe(true);
  });

  it("matches the weak form of the same tag", () => {
    expect(etagMatches(`W/${etag}`, etag)).toBe(true);
  });

  it("matches the wildcard", () => {
    expect(etagMatches("*", etag)).toBe(true);
  });

  it("does not match a different or missing tag", () => {
    expect(etagMatches('"nope"', etag)).toBe(false);
    expect(etagMatches(undefined, etag)).toBe(false);
    expect(etagMatches("", etag)).toBe(false);
  });
});
