/**
 * Fixtures for the business travel budget tests (A06 part C).
 *
 * The organization rows (organizations, members, cost centres) belong to
 * user-service; payment-service only READS them to authorize money. The
 * tests write them straight into the real database the way user-service
 * would, so the code under test — payment-service's authorization, ledger
 * postings and locks — runs unmodified against real Postgres.
 */
import { randomUUID } from "node:crypto";

import {
  closeTestDb,
  makeDeps,
  RecordingTopupRail,
  seedCity,
  seedUser,
  testDb,
  uid,
  type SeededCity,
  type SeededUser,
} from "../ledger/helpers";

import type { WalletDeps } from "../../src/ledger/context";
import type { LedgerDb } from "../../src/ledger/types";

export { closeTestDb, RecordingTopupRail, testDb, uid };

export type OrgRole = "owner" | "admin" | "booker" | "traveller";

export interface Policy {
  readonly tripCapMinor: number;
  readonly allowedServices: readonly string[];
  readonly allowedClasses: readonly string[];
}

export const OPEN_POLICY: Policy = {
  tripCapMinor: 5_000_000,
  allowedServices: ["ride"],
  allowedClasses: ["go", "comfort"],
};

export interface OrgCast {
  readonly city: SeededCity;
  readonly orgId: string;
  readonly owner: SeededUser;
  readonly admin: SeededUser;
  readonly booker: SeededUser;
  readonly traveller: SeededUser;
  readonly outsider: SeededUser;
  readonly costCentreId: string;
  readonly otherCostCentreId: string;
}

export function businessCity(
  db: LedgerDb,
  enabled = true,
): Promise<SeededCity> {
  return seedCity(db, {
    flags: { wallet_p2p: true, business_travel: enabled },
  });
}

export async function setBusinessTravel(
  db: LedgerDb,
  cityId: string,
  enabled: boolean,
): Promise<void> {
  await db.flagRule.update({
    where: { flagKey_cityId: { flagKey: "business_travel", cityId } },
    data: { enabled },
  });
}

export async function addMember(
  db: LedgerDb,
  orgId: string,
  userId: string,
  role: OrgRole,
  costCentreId: string | null = null,
): Promise<string> {
  const id = `orgm_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  await db.organizationMember.create({
    data: {
      id,
      organizationId: orgId,
      userId,
      role,
      status: "active",
      costCentreId,
      addedBy: "fixture",
    },
  });
  return id;
}

export async function addCostCentre(
  db: LedgerDb,
  orgId: string,
  code: string,
): Promise<string> {
  const id = uid("occ");
  await db.organizationCostCentre.create({
    data: {
      id,
      organizationId: orgId,
      code,
      name: `${code} centre`,
      status: "active",
      createdBy: "fixture",
    },
  });
  return id;
}

/**
 * An organization with one person per role, two cost centres (the traveller
 * defaults to the first) and the given policy.
 */
export async function seedOrganization(
  db: LedgerDb,
  options: { city?: SeededCity; policy?: Policy; status?: string } = {},
): Promise<OrgCast> {
  const city = options.city ?? (await businessCity(db));
  const policy = options.policy ?? OPEN_POLICY;
  const [owner, admin, booker, traveller, outsider] = await Promise.all([
    seedUser(db, "Olu"),
    seedUser(db, "Amaka"),
    seedUser(db, "Bayo"),
    seedUser(db, "Tobi"),
    seedUser(db, "Uche"),
  ]);
  const orgId = uid("org");
  await db.organization.create({
    data: {
      id: orgId,
      name: `Acme ${orgId.slice(-6)}`,
      cityId: city.cityId,
      currency: city.currency,
      status: options.status ?? "active",
      legalName: "Acme Logistics Ltd",
      taxId: "TIN-123456",
      tripCapMinor: BigInt(policy.tripCapMinor),
      allowedServices: [...policy.allowedServices],
      allowedClasses: [...policy.allowedClasses],
      policyVersion: 3,
      createdBy: owner.id,
    },
  });
  const costCentreId = await addCostCentre(db, orgId, "ENG");
  const otherCostCentreId = await addCostCentre(db, orgId, "SALES");
  await addMember(db, orgId, owner.id, "owner");
  await addMember(db, orgId, admin.id, "admin");
  await addMember(db, orgId, booker.id, "booker");
  await addMember(db, orgId, traveller.id, "traveller", costCentreId);
  return {
    city,
    orgId,
    owner,
    admin,
    booker,
    traveller,
    outsider,
    costCentreId,
    otherCostCentreId,
  };
}

export function depsAt(
  db: LedgerDb,
  now: Date,
  rail: RecordingTopupRail | null = new RecordingTopupRail(),
): WalletDeps {
  return makeDeps(db, { topupRail: rail, now: () => now });
}

export function key(prefix = "k"): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

export function actorOf(user: SeededUser): { id: string; role: string } {
  return { id: user.id, role: "rider" };
}

/** Terms as ride-service would state them for a booking. */
export function termsFor(
  cast: OrgCast,
  overrides: Partial<{
    bookingRef: string;
    bookerId: string;
    travellerId: string;
    costCentreId: string;
    service: string;
    vehicleClass: string;
    amountMinor: number;
    currency: string;
    expenseCategory: string;
    cityId: string;
  }> = {},
) {
  return {
    bookingRef: overrides.bookingRef ?? uid("award"),
    organizationId: cast.orgId,
    costCentreId: overrides.costCentreId,
    bookerId: overrides.bookerId ?? cast.booker.id,
    travellerId: overrides.travellerId ?? cast.traveller.id,
    service: overrides.service ?? "ride",
    vehicleClass: overrides.vehicleClass ?? "go",
    amountMinor: overrides.amountMinor ?? 1_000_000,
    currency: overrides.currency ?? cast.city.currency,
    expenseCategory: overrides.expenseCategory,
    cityId: overrides.cityId ?? cast.city.cityId,
  };
}

/** A ContractError-shaped rejection: its `code` and `details.reason`. */
export async function refusalOf(promise: Promise<unknown>): Promise<{
  code: string;
  reason: unknown;
  details: Record<string, unknown>;
}> {
  try {
    await promise;
  } catch (error) {
    const candidate = error as {
      code?: string;
      details?: Record<string, unknown>;
    };
    return {
      code: candidate.code ?? "unknown",
      reason: candidate.details?.reason,
      details: candidate.details ?? {},
    };
  }
  throw new Error("expected the call to be refused, but it succeeded");
}
