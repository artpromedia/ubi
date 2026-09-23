/**
 * Business travel organizations (A06 part C) — the closed vocabularies.
 *
 * Every constant here mirrors packages/contracts/src/business-travel.ts;
 * tests/organizations parses real responses against that contract, so the
 * two cannot drift silently. The flag key is the contract's own registered
 * FlagKey.
 */
import {
  BUSINESS_TRAVEL_FLAG as CONTRACT_BUSINESS_TRAVEL_FLAG,
  type FlagKey,
} from "@ubi/contracts";

import type { PrismaClient } from "@prisma/client";

/** Mirrors `ORG_ROLES`. */
export const ORG_ROLES = ["owner", "admin", "booker", "traveller"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Mirrors `ORG_ADMIN_ROLES`: members, policy, billing and money. */
export const ORG_ADMIN_ROLES: readonly OrgRole[] = ["owner", "admin"];

/** Mirrors `ORG_BOOKER_ROLES`: may book for someone other than themselves. */
export const ORG_BOOKER_ROLES: readonly OrgRole[] = [
  "owner",
  "admin",
  "booker",
];

/** Roles an admin (not an owner) may grant, change or remove. */
export const ADMIN_MANAGEABLE_ROLES: readonly OrgRole[] = [
  "booker",
  "traveller",
];

/** Mirrors `ORG_INVITATION_TTL_DAYS`. */
export const ORG_INVITATION_TTL_DAYS = 14;

/** The registered FlagKey `business_travel` (the contract's constant). */
export const BUSINESS_TRAVEL_FLAG: FlagKey = CONTRACT_BUSINESS_TRAVEL_FLAG;

/**
 * Mirrors `BUSINESS_TRAVEL_EVENT_NAMES` — the closed set this module may
 * publish, now registered in the contract's EVENT_NAMES. The organization
 * outbox writer (./outbox.ts) enforces THIS list, so no call site can invent
 * a name (or publish another module's).
 */
export const ORG_EVENT_NAMES = [
  "organization.created",
  "organization.policy_updated",
  "organization.billing_updated",
  "organization.cost_centre_created",
  "organization.cost_centre_archived",
  "organization.member_invited",
  "organization.invitation_accepted",
  "organization.invitation_declined",
  "organization.invitation_revoked",
  "organization.member_updated",
  "organization.member_removed",
] as const;
export type OrgEventName = (typeof ORG_EVENT_NAMES)[number];

export function isOrgRole(value: string): value is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(value);
}

export function isAdminRole(role: OrgRole): boolean {
  return ORG_ADMIN_ROLES.includes(role);
}

/** The subject every organization audit row is filed under. */
export const ORG_AUDIT_SUBJECT = "organization";

export interface OrganizationDeps {
  readonly prisma: PrismaClient;
  /** The clock, so invitation expiry is exercised rather than slept through. */
  readonly now: () => Date;
}

/** The authenticated caller, from the gateway-signed identity context only. */
export interface OrgActor {
  readonly userId: string;
  readonly role: string;
  readonly cityId: string | null;
}
