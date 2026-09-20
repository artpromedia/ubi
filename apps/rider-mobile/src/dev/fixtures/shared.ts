// Leaf module for the fixture helpers, so the domain fixtures don't import the
// barrel (index.ts) that imports them back (import/no-cycle).
export type FixtureInput = { method: string; path: string; body?: unknown };
export const ok = (json: unknown) => ({ status: 200, json });
export const NGN = (major: number) => ({
  amountMinor: Math.round(major * 100),
  currency: "NGN",
});
