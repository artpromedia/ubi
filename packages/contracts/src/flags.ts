/**
 * Feature flags are deny-by-default and evaluated server-side per city
 * (CLAUDE.md #5). A client that cannot reach the flag service treats every flag
 * as off — it must never fail open into a half-built vertical.
 */
import { z } from "zod";

export const FLAG_KEYS = [
  "move",
  "bites",
  "send",
  "travel",
  "stays",
  "journeys",
  "reservations",
  "fleet",
  "wallet_p2p",
  "wallet_nip",
  "tips",
  "scheduled_rides",
  "recording",
  "driver_online",
  "ride_request",
  "provider_payments",
  // RN-migration handoff verticals (AI / travel / growth). Deny-by-default is
  // automatic: an absent key is off, so a half-built vertical stays dark.
  "ai_assistant",
  "ai_transactions",
  "ai_mandates",
  "flights_booking",
  "stays_booking",
  "rider_promotions",
  "driver_commission_rebates",
  "referrals",
  "ai_marketing",
] as const;

export type FlagKey = (typeof FLAG_KEYS)[number];

export const FlagSetSchema = z.record(z.boolean());
export type FlagSet = Readonly<Partial<Record<FlagKey, boolean>>>;

/**
 * The only correct way to read a flag. An absent key is off, so a service that
 * has never heard of a flag cannot accidentally expose the feature behind it.
 */
export function isEnabled(flags: FlagSet | undefined, key: FlagKey): boolean {
  return flags?.[key] === true;
}

/** Every flag off — the value used when the config service is unreachable. */
export const DENY_ALL: FlagSet = Object.freeze(
  Object.fromEntries(FLAG_KEYS.map((key) => [key, false])) as Record<
    FlagKey,
    boolean
  >,
);
