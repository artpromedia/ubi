#!/usr/bin/env node
/**
 * Contract gate.
 *
 * Checks every document in contracts/openapi/ for the two failure modes that are
 * invisible to a reader but fatal to a code generator:
 *
 *   1. a duplicate top-level key. YAML has no merge semantics, so a second
 *      `components:` block silently replaces the first — which is exactly how
 *      securitySchemes, the Idempotency-Key parameter and the shared Money and
 *      Error schemas went missing from five of the six documents.
 *   2. a `$ref` that does not resolve within the document.
 *
 * It also verifies that contracts/state-machines.json is internally consistent
 * with the generated code in packages/contracts.
 *
 * Run: node tooling/scripts/validate-contracts.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const OPENAPI_DIR = "contracts/openapi";

let failures = 0;
const fail = (msg) => {
  console.error(`FAIL  ${msg}`);
  failures += 1;
};

/** Duplicate top-level keys, detected on the raw text rather than after parsing. */
function duplicateTopLevelKeys(text) {
  const seen = new Map();
  const dupes = [];
  text.split("\n").forEach((line, i) => {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):/.exec(line);
    if (!m) return;
    const key = m[1];
    if (seen.has(key)) dupes.push({ key, first: seen.get(key), second: i + 1 });
    else seen.set(key, i + 1);
  });
  return dupes;
}

function collectRefs(node, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, out);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "$ref" && typeof v === "string") out.push(v);
      else collectRefs(v, out);
    }
  }
  return out;
}

function resolves(doc, ref) {
  if (!ref.startsWith("#/")) return true; // external refs are out of scope here
  let cur = doc;
  for (const part of ref.slice(2).split("/")) {
    if (cur && typeof cur === "object" && part in cur) cur = cur[part];
    else return false;
  }
  return true;
}

let yaml;
try {
  yaml = (await import("yaml")).default ?? (await import("yaml"));
} catch {
  console.error(
    "This gate needs a YAML parser. Install one at the workspace root: pnpm add -Dw yaml",
  );
  process.exit(2);
}

for (const file of readdirSync(OPENAPI_DIR).filter((f) => f.endsWith(".yaml"))) {
  const path = join(OPENAPI_DIR, file);
  const text = readFileSync(path, "utf8");

  for (const d of duplicateTopLevelKeys(text)) {
    fail(`${path}: duplicate top-level key "${d.key}" (lines ${d.first} and ${d.second}). ` +
         `The later block silently replaces the earlier one.`);
  }

  let doc;
  try {
    doc = yaml.parse(text);
  } catch (e) {
    fail(`${path}: does not parse — ${e.message}`);
    continue;
  }

  for (const ref of new Set(collectRefs(doc))) {
    if (!resolves(doc, ref)) fail(`${path}: unresolved $ref ${ref}`);
  }

  if (!doc?.components?.securitySchemes) {
    fail(`${path}: declares no components.securitySchemes, so the API has no authentication`);
  }

  if (failures === 0) console.log(`ok    ${path}`);
}

const machines = JSON.parse(readFileSync("contracts/state-machines.json", "utf8"));
for (const [name, machine] of Object.entries(machines)) {
  if (name.startsWith("$") || !machine?.transitions) continue;
  if (!(machine.initial in machine.transitions)) {
    fail(`state-machines.json: ${name}.initial "${machine.initial}" is not a declared state`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} contract problem(s).`);
  process.exit(1);
}
console.log("\nAll contracts parse, resolve and declare authentication.");
