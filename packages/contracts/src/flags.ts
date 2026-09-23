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
  // Negotiated-fare marketplace (M01). Scoped by city AND service: rides and
  // package delivery roll out independently, and the queued next-job slot
  // (finishing-trip matching) can trail a stationary-only pilot. Deny-by-default
  // is automatic; an unconfigured market also fails closed on policy (see
  // MarketplacePolicySchema in city-config.ts).
  "marketplace_rides",
  "marketplace_delivery",
  "marketplace_queued_jobs",
  // Ordered intermediate stops on marketplace RIDE requests (A02). Scoped by
  // city like the verticals above. While off, a quote, publish or pre-award
  // route revision that carries stops is refused and the no-stop path is
  // untouched; deliveries stay single-drop whatever this says (multi-drop
  // needs per-package custody). Nothing enables this by default.
  "marketplace_multi_stop",
  // Post-award trip amendments and safe early termination on marketplace
  // RIDES (A02 items 4-7). While off, propose/approve/reject/list and
  // terminate are refused; per-stop arrival/waiting events stay under
  // marketplace_multi_stop. Money moves only through linked adjustments (the
  // 10% is never re-charged). Nothing enables this by default.
  "marketplace_trip_amendments",
  // AI marketplace actions (C10). Gates ask-service's marketplace adapters — the
  // assistant quoting, publishing a bounded request, and (the only binding step)
  // selecting a winning offer within a user's grant/mandate. Deny-by-default and
  // independent of `marketplace_rides`: the human marketplace can be live in a
  // city while the AI is not authorised to act in it. Nothing enables this; it
  // stays off until the C10 deterministic suite gates it on per city.
  "ai_marketplace",
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
