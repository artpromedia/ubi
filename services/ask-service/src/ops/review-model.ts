/**
 * Shared shapes for reviews and executions.
 *
 * A review row stores its items as a small wrapper object so the notes and the
 * required assurance travel with the items. The terms fingerprint is a stable
 * function of exactly which offers were resolved and at what terms version — any
 * material change to the offers changes the fingerprint, and a fingerprint that
 * no longer matches the row invalidates the review (rule #18).
 */
import { money, type Money } from "@ubi/contracts";

import type { ResolvedOffer } from "../ports/travel-port";

export interface StoredReviewItem {
  readonly kind: "flight" | "stay" | "ride_reservation";
  readonly title: string;
  readonly detail: string | null;
  readonly priceMinor: number;
  readonly currency: string;
  readonly terms: readonly { text: string; tone: string }[];
  readonly offerRef: string;
  readonly action: string;
  readonly provider: string | null;
}

export interface StoredReview {
  readonly items: readonly StoredReviewItem[];
  readonly notes: readonly string[];
  readonly assuranceRequired: "pin" | "biometric";
}

export function parseStoredReview(value: unknown): StoredReview {
  if (Array.isArray(value)) {
    return {
      items: value as StoredReviewItem[],
      notes: [],
      assuranceRequired: "pin",
    };
  }
  const record = (value ?? {}) as {
    items?: unknown;
    notes?: unknown;
    assuranceRequired?: unknown;
  };
  return {
    items: Array.isArray(record.items)
      ? (record.items as StoredReviewItem[])
      : [],
    notes: Array.isArray(record.notes) ? (record.notes as string[]) : [],
    assuranceRequired:
      record.assuranceRequired === "biometric" ? "biometric" : "pin",
  };
}

/** A stable fingerprint of the exact offers and their terms versions. */
export function fingerprintResolved(
  offers: readonly ResolvedOffer[],
): string {
  return offers.map((offer) => `${offer.offerRef}:${offer.termsVersion}`).join("|");
}

export function resolvedToStoredItem(offer: ResolvedOffer): StoredReviewItem {
  return {
    kind: offer.kind === "flight" ? "flight" : "stay",
    title: offer.title,
    detail: offer.detail,
    priceMinor: offer.priceMinor,
    currency: offer.currency,
    terms: offer.terms,
    offerRef: offer.offerRef,
    action: offer.kind === "flight" ? "flight.book" : "stay.book",
    provider: null,
  };
}

export interface ReviewItemView {
  readonly kind: string;
  readonly title: string;
  readonly detail?: string;
  readonly price: Money;
  readonly terms: readonly { text: string; tone: string }[];
  readonly offerRef: string;
}

export interface ReviewView {
  readonly id: string;
  readonly status: string;
  readonly termsVersion: string;
  readonly expiresAt: string;
  readonly items: readonly ReviewItemView[];
  readonly total: Money;
  readonly paymentMethod: { readonly id: string; readonly label: string };
  readonly assuranceRequired: "pin" | "biometric";
  readonly notes: readonly string[];
}

export interface ReviewRowShape {
  readonly id: string;
  readonly status: string;
  readonly termsVersion: string;
  readonly expiresAt: Date;
  readonly items: unknown;
  readonly totalMinor: bigint;
  readonly currency: string;
  readonly paymentMethodId: string;
}

export function reviewView(row: ReviewRowShape): ReviewView {
  const stored = parseStoredReview(row.items);
  return {
    id: row.id,
    status: row.status,
    termsVersion: row.termsVersion,
    expiresAt: row.expiresAt.toISOString(),
    items: stored.items.map((item) => ({
      kind: item.kind,
      title: item.title,
      detail: item.detail ?? undefined,
      price: money(item.priceMinor, item.currency),
      terms: item.terms,
      offerRef: item.offerRef,
    })),
    total: money(Number(row.totalMinor), row.currency),
    paymentMethod: { id: row.paymentMethodId, label: row.paymentMethodId },
    assuranceRequired: stored.assuranceRequired,
    notes: stored.notes,
  };
}
