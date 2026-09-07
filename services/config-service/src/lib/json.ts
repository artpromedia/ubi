/**
 * Canonical JSON and structural diffing.
 *
 * Config bodies are compared and hashed by value, so a key-order change can
 * never produce a new ETag or a phantom diff line in the audit trail.
 */

export type JsonObject = Record<string, unknown>;

export function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON with object keys sorted at every depth. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (isPlainObject(value)) {
    const out: JsonObject = {};
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry === undefined) continue;
      out[key] = canonicalise(entry);
    }
    return out;
  }
  return value;
}

export function jsonEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

export interface DiffEntry {
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
}

/**
 * Leaf-level diff. Arrays are compared whole because an ordered list (vehicle
 * classes, matching rings) only makes sense as a unit.
 */
export function diffJson(before: unknown, after: unknown, path = ""): DiffEntry[] {
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys]
      .sort()
      .flatMap((key) => diffJson(before[key], after[key], path === "" ? key : `${path}.${key}`));
  }
  return jsonEqual(before, after) ? [] : [{ path, before, after }];
}

/**
 * Deep merge of a change-request patch onto the current config. `null` removes
 * a key so a request can drop a policy; arrays are replaced wholesale.
 */
export function applyPatch(base: JsonObject, patch: JsonObject): JsonObject {
  const out: JsonObject = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete out[key];
      continue;
    }
    if (value === undefined) continue;
    const current = out[key];
    if (isPlainObject(value)) {
      out[key] = applyPatch(isPlainObject(current) ? current : {}, value);
    } else if (Array.isArray(value)) {
      out[key] = [...value];
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Narrow a Prisma `Json` column to an object without trusting its shape. */
export function asJsonObject(value: unknown): JsonObject {
  return isPlainObject(value) ? value : {};
}
