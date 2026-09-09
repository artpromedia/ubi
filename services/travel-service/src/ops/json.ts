/**
 * Casting our JSON values to the type Prisma accepts for a `Json` column.
 *
 * Our `JsonValue` allows a top-level `null`; Prisma's `InputJsonValue` does not
 * (a JSON null in a column is `Prisma.JsonNull`, distinct from a SQL NULL). Every
 * value we persist here is an object or an array, never a bare null, so this
 * narrow cast is safe and keeps the write sites readable.
 */
import type { Prisma } from "@prisma/client/index";

import type { JsonRecord, JsonValue } from "./types";

export function toJson(value: JsonValue | JsonRecord | unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/**
 * A deep copy with every `undefined` dropped, so an object built from optional
 * fields is safe to store in a `Json` column (JSON has no `undefined`).
 */
export function cleanJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}
