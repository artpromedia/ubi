/**
 * Loads the supplier documentation example payloads in
 * tests/fixtures/supplier-docs. Each file records the official page it was
 * copied from and when; `payload` is the example verbatim. Tests that need a
 * variant (a different `refund_to`, our own metadata on an order) change a
 * deep copy in the test itself, next to a comment saying what and why.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "fixtures/supplier-docs");

interface DocFixture {
  readonly source: string;
  readonly retrieved: string;
  readonly payload: unknown;
}

export function docPayload<T = Record<string, unknown>>(file: string): T {
  const raw = readFileSync(path.join(ROOT, file), "utf8");
  const parsed = JSON.parse(raw) as DocFixture;
  // A fresh deep copy per call: tests may mutate their own copy freely.
  return JSON.parse(JSON.stringify(parsed.payload)) as T;
}

export function docSource(file: string): string {
  const raw = readFileSync(path.join(ROOT, file), "utf8");
  return (JSON.parse(raw) as DocFixture).source;
}
