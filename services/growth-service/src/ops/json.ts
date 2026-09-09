/**
 * Coercion helpers for Prisma `Json` columns.
 *
 * Prisma types a *required* Json column as `JsonNullValueInput | InputJsonValue`
 * (SQL NULL only through the sentinel), which our structural `JsonValue` — which
 * admits `null` — is not assignable to. These helpers make the intent explicit
 * at the write site: a real JSON payload, or the JSON-null sentinel.
 */
import { Prisma } from "@prisma/client";

export function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export const JSON_NULL = Prisma.JsonNull;
