/**
 * The structured marketplace review (recheck A01 / P01).
 *
 * A marketplace proposal is not text. It is a persisted object carrying the
 * EXACT server-derived scope and revision the user is asked to approve, in the
 * `ask_reviews` row the existing Ask lifecycle already owns (propose → review →
 * confirm → execute):
 *
 *   - the stage and the one action it will take (`mp.select` / `mp.prepare`);
 *   - the grant scope (ops/marketplace.ts `MarketplaceGrantScope`) the confirm
 *     will mint — principal, service, city, currency, the hard cap, vehicle
 *     class, quote — and its fingerprint;
 *   - for a selection: request id + revision + version, bid id + version, the
 *     rider price and the driver's bid amount exactly as the marketplace sent
 *     them, the offer's expiry, and the driver commission shown SEPARATELY
 *     (the driver pays it out of the fare; it is never added to the rider's
 *     price, and its amount is only ever the server's — known once awarded);
 *   - for a publish: the quote, the server's fare bounds and the fare offered.
 *
 * The review's terms version is a digest over all of it, so a confirm that
 * echoes it is a confirm of exactly these terms. Every amount is the
 * marketplace's integer minor units; nothing here adds, splits or derives money
 * (CLAUDE.md #1).
 */
import { z } from "zod";

import { CurrencySchema, money, type Money } from "@ubi/contracts";

import { fingerprintScope, type MarketplaceGrantScope } from "./marketplace";
import { grantTermsVersion } from "../ports/grant-port";

export const MP_REVIEW_KIND = "marketplace" as const;
export type MpReviewStage = "publish" | "select";

/** The one sentence the assistant always says about its own authority. */
export const MP_AUTHORITY_STATEMENT =
  "I can't set prices or book without your OK.";

/** `AskReview.paymentMethodId` for a selection: the request already has one. */
export const MP_REQUEST_PAYMENT_METHOD = "mp:request";

export interface MpCommissionTerms {
  /** Who pays UBI's commission on a marketplace fare: always the driver. */
  readonly payer: "driver";
  /** It is taken from the driver's fare, never added to the rider's price. */
  readonly addedToYourPrice: false;
  /** The server's amount once the award exists; null before (never guessed). */
  readonly amountMinor: number | null;
  readonly note: string;
}

export interface MpSelectionItem {
  readonly kind: "mp_selection";
  readonly action: "mp.select";
  readonly title: string;
  readonly requestId: string;
  readonly requestRevision: number;
  readonly requestVersion: number;
  readonly quoteId: string;
  readonly bidId: string;
  readonly bidVersion: number;
  /** What the rider pays for this offer — the marketplace's total. */
  readonly priceMinor: number;
  /** The driver's bid as the marketplace sent it. */
  readonly bidAmountMinor: number;
  readonly currency: string;
  readonly offerExpiresAt: string;
  /** Server-verified facts only; driver-authored text is never stored here. */
  readonly vehicle: string;
  readonly driverRating: string;
  readonly driverProfileStatus: string;
  readonly commission: MpCommissionTerms;
}

export interface MpPublishItem {
  readonly kind: "mp_publish";
  readonly action: "mp.prepare";
  readonly title: string;
  readonly quoteId: string;
  readonly service: "ride" | "delivery";
  readonly vehicleClass: string;
  /** The fare offered to drivers — inside the server's bounds. */
  readonly priceMinor: number;
  readonly currency: string;
  readonly bounds: {
    readonly minimumMinor: number;
    readonly suggestedMinor: number;
    readonly maximumMinor: number;
  };
  readonly quoteExpiresAt: string;
  readonly paymentMethodId: string;
  readonly weightKg: number | null;
}

export type MpReviewItem = MpSelectionItem | MpPublishItem;

/** What a marketplace proposal hands the review row (and the loop). */
export interface MarketplaceReviewProposal {
  readonly kind: typeof MP_REVIEW_KIND;
  readonly stage: MpReviewStage;
  readonly scope: MarketplaceGrantScope;
  readonly scopeFingerprint: string;
  readonly item: MpReviewItem;
  readonly totalMinor: number;
  readonly currency: string;
  readonly paymentMethodId: string;
  readonly termsVersion: string;
  readonly assuranceRequired: "pin" | "biometric";
  readonly notes: readonly string[];
  /** Where the conventional flow for this proposal lives (never a dead end). */
  readonly conventionalFlow: string;
}

/** The persisted `ask_reviews.items` shape of a marketplace review. */
export interface StoredMpReview {
  readonly kind: typeof MP_REVIEW_KIND;
  readonly stage: MpReviewStage;
  readonly scope: MarketplaceGrantScope;
  readonly scopeFingerprint: string;
  readonly items: readonly [MpReviewItem];
  readonly notes: readonly string[];
  readonly assuranceRequired: "pin" | "biometric";
  readonly conventionalFlow: string;
}

const NonNegativeInt = z.number().int().min(0).safe();

const ScopeSchema = z
  .object({
    principalId: z.string().min(1),
    actions: z.array(z.enum(["quote", "prepare", "select", "cancel"])).min(1),
    service: z.enum(["ride", "delivery"]),
    cityId: z.string().min(1),
    currency: CurrencySchema,
    maxSpendMinor: NonNegativeInt,
    vehicleClass: z.string().min(1).nullable(),
    quoteId: z.string().min(1),
  })
  .strict();

const CommissionSchema = z
  .object({
    payer: z.literal("driver"),
    addedToYourPrice: z.literal(false),
    amountMinor: NonNegativeInt.nullable(),
    note: z.string(),
  })
  .strict();

const SelectionItemSchema = z
  .object({
    kind: z.literal("mp_selection"),
    action: z.literal("mp.select"),
    title: z.string().min(1),
    requestId: z.string().min(1),
    requestRevision: NonNegativeInt,
    requestVersion: NonNegativeInt,
    quoteId: z.string().min(1),
    bidId: z.string().min(1),
    bidVersion: NonNegativeInt,
    priceMinor: NonNegativeInt,
    bidAmountMinor: NonNegativeInt,
    currency: CurrencySchema,
    offerExpiresAt: z.string().min(1),
    vehicle: z.string(),
    driverRating: z.string(),
    driverProfileStatus: z.string(),
    commission: CommissionSchema,
  })
  .strict();

const PublishItemSchema = z
  .object({
    kind: z.literal("mp_publish"),
    action: z.literal("mp.prepare"),
    title: z.string().min(1),
    quoteId: z.string().min(1),
    service: z.enum(["ride", "delivery"]),
    vehicleClass: z.string().min(1),
    priceMinor: NonNegativeInt,
    currency: CurrencySchema,
    bounds: z
      .object({
        minimumMinor: NonNegativeInt,
        suggestedMinor: NonNegativeInt,
        maximumMinor: NonNegativeInt,
      })
      .strict(),
    quoteExpiresAt: z.string().min(1),
    paymentMethodId: z.string().min(1),
    weightKg: z.number().positive().nullable(),
  })
  .strict();

const StoredMpReviewSchema = z
  .object({
    kind: z.literal(MP_REVIEW_KIND),
    stage: z.enum(["publish", "select"]),
    scope: ScopeSchema,
    scopeFingerprint: z.string().min(1),
    items: z.tuple([z.union([SelectionItemSchema, PublishItemSchema])]),
    notes: z.array(z.string()),
    assuranceRequired: z.enum(["pin", "biometric"]),
    conventionalFlow: z.string().min(1),
  })
  .strict();

/** True when a stored review row is a marketplace review. */
export function isMarketplaceReview(items: unknown): boolean {
  return (
    typeof items === "object" &&
    items !== null &&
    !Array.isArray(items) &&
    (items as { kind?: unknown }).kind === MP_REVIEW_KIND
  );
}

/**
 * Parses a stored marketplace review. A row that SAYS it is a marketplace
 * review but does not parse is a defect: it fails closed (nothing is confirmed
 * against terms the server cannot read back exactly).
 */
export function parseStoredMpReview(items: unknown): StoredMpReview {
  const parsed = StoredMpReviewSchema.safeParse(items);
  if (!parsed.success) {
    throw new Error("a stored marketplace review failed its schema");
  }
  const stored = parsed.data as StoredMpReview;
  if (fingerprintScope(stored.scope) !== stored.scopeFingerprint) {
    throw new Error(
      "a stored marketplace review's scope does not match its fingerprint",
    );
  }
  return stored;
}

export function storedFromProposal(
  proposal: MarketplaceReviewProposal,
): StoredMpReview {
  return {
    kind: MP_REVIEW_KIND,
    stage: proposal.stage,
    scope: proposal.scope,
    scopeFingerprint: proposal.scopeFingerprint,
    items: [proposal.item],
    notes: proposal.notes,
    assuranceRequired: proposal.assuranceRequired,
    conventionalFlow: proposal.conventionalFlow,
  };
}

/**
 * The review's terms version: a digest over the stage, the scope fingerprint
 * and every decision field of the item. Any change to any of them — a new
 * revision, a re-priced or re-versioned bid, a different cap — is a different
 * terms version, so a confirm of the old one can never run the new terms.
 */
export function mpReviewTermsVersion(
  stage: MpReviewStage,
  scopeFingerprint: string,
  item: MpReviewItem,
): string {
  const decision =
    item.kind === "mp_selection"
      ? [
          // The request VERSION is deliberately absent: it also moves on
          // non-material updates (the search envelope widening). A material
          // request change bumps the revision, which is here.
          item.action,
          item.requestId,
          item.requestRevision,
          item.quoteId,
          item.bidId,
          item.bidVersion,
          item.priceMinor,
          item.bidAmountMinor,
          item.currency,
          item.offerExpiresAt,
        ]
      : [
          item.action,
          item.quoteId,
          item.service,
          item.vehicleClass,
          item.priceMinor,
          item.currency,
          item.bounds.minimumMinor,
          item.bounds.suggestedMinor,
          item.bounds.maximumMinor,
          item.quoteExpiresAt,
          item.paymentMethodId,
          item.weightKg ?? "",
        ];
  return grantTermsVersion(
    "mp.review.v1",
    JSON.stringify([stage, scopeFingerprint, ...decision]),
  );
}

export function commissionTerms(amountMinor: number | null): MpCommissionTerms {
  return {
    payer: "driver",
    addedToYourPrice: false,
    amountMinor,
    note: "The driver pays UBI's commission out of this fare. It is not added to your price.",
  };
}

// ---------------------------------------------------------------------------
// The client view
// ---------------------------------------------------------------------------

export interface MpReviewView {
  readonly stage: MpReviewStage;
  readonly action: "mp.select" | "mp.prepare";
  readonly statement: string;
  /** The persisted, server-derived scope the confirm will mint. */
  readonly scope: {
    readonly fingerprint: string;
    readonly actions: readonly string[];
    readonly service: "ride" | "delivery";
    readonly cityId: string;
    readonly cap: Money;
    readonly vehicleClass: string | null;
    readonly quoteId: string;
  };
  readonly price: Money;
  readonly awardsNothing: boolean;
  readonly selection?: {
    readonly requestId: string;
    readonly requestRevision: number;
    readonly requestVersion: number;
    readonly bidId: string;
    readonly bidVersion: number;
    readonly bidAmount: Money;
    readonly offerExpiresAt: string;
    readonly vehicle: string;
    readonly driverRating: string;
    readonly driverProfileStatus: string;
    readonly commission: {
      readonly payer: "driver";
      readonly addedToYourPrice: false;
      readonly amount: Money | null;
      readonly note: string;
    };
  };
  readonly publish?: {
    readonly quoteId: string;
    readonly service: "ride" | "delivery";
    readonly vehicleClass: string;
    readonly bounds: {
      readonly minimum: Money;
      readonly suggested: Money;
      readonly maximum: Money;
    };
    readonly quoteExpiresAt: string;
    readonly paymentMethodId: string;
  };
  readonly conventionalFlow: string;
}

export function mpReviewView(stored: StoredMpReview): MpReviewView {
  const [item] = stored.items;
  const { scope } = stored;
  const base = {
    stage: stored.stage,
    action: item.action,
    statement: MP_AUTHORITY_STATEMENT,
    scope: {
      fingerprint: stored.scopeFingerprint,
      actions: [...scope.actions],
      service: scope.service,
      cityId: scope.cityId,
      cap: money(scope.maxSpendMinor, scope.currency),
      vehicleClass: scope.vehicleClass,
      quoteId: scope.quoteId,
    },
    price: money(item.priceMinor, item.currency),
    conventionalFlow: stored.conventionalFlow,
  };
  if (item.kind === "mp_selection") {
    return {
      ...base,
      awardsNothing: false,
      selection: {
        requestId: item.requestId,
        requestRevision: item.requestRevision,
        requestVersion: item.requestVersion,
        bidId: item.bidId,
        bidVersion: item.bidVersion,
        bidAmount: money(item.bidAmountMinor, item.currency),
        offerExpiresAt: item.offerExpiresAt,
        vehicle: item.vehicle,
        driverRating: item.driverRating,
        driverProfileStatus: item.driverProfileStatus,
        commission: {
          payer: item.commission.payer,
          addedToYourPrice: item.commission.addedToYourPrice,
          amount:
            item.commission.amountMinor === null
              ? null
              : money(item.commission.amountMinor, item.currency),
          note: item.commission.note,
        },
      },
    };
  }
  return {
    ...base,
    // Publishing only asks drivers for offers: it never awards a driver.
    awardsNothing: true,
    publish: {
      quoteId: item.quoteId,
      service: item.service,
      vehicleClass: item.vehicleClass,
      bounds: {
        minimum: money(item.bounds.minimumMinor, item.currency),
        suggested: money(item.bounds.suggestedMinor, item.currency),
        maximum: money(item.bounds.maximumMinor, item.currency),
      },
      quoteExpiresAt: item.quoteExpiresAt,
      paymentMethodId: item.paymentMethodId,
    },
  };
}
