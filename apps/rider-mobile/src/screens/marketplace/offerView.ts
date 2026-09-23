// Offer comparison (A06 part A) — the rider's reading of one SERVER-computed offer. Every
// figure here is the server's: the total the rider pays and its note, the pickup ESTIMATE
// (with its basis), the verified driver card (or "details unavailable"), the rating
// average and count exactly as user-service returned them, the DEFINED reliability with
// its window and sample (or "not enough history"), the service fit and each badge's
// reason. Nothing is ranked, filled in or invented on the client: an offer from a server
// that predates the comparison shows none of it, and a driver without a verified card
// never shows a rating or a trip count.
import type {
  MpCriterion,
  MpOfferSort,
  MpReliability,
  MpServiceFit,
} from "@ubi/contracts";
import type { Money } from "@ubi/mobile-core";
import type { MpOfferDto } from "../../api/marketplace";

export type DriverCardStatus = "verified" | "not_verified" | "unavailable";

export type OfferDriverCard = {
  status: DriverCardStatus;
  /** Server-phrased: "Verified by UBI" / "Driver checks not complete" / "Driver details unavailable". */
  statusLabel: string;
  /** The card's name when one resolved; otherwise the honest "details unavailable". */
  name: string;
  initials: string;
  /** Server-phrased: "4.80 from 212 ratings" / "No ratings yet" / "Rating unavailable". */
  ratingLabel: string;
  /** Completed trips from a resolved card, or null — never a placeholder 0. */
  tripsLabel: string | null;
  plateMasked: string | null;
};

export type ReliabilityLine = {
  status: MpReliability["status"];
  /** Server-phrased figure or "Not enough history yet". */
  label: string;
  /** Its window and sample, so the figure is never read without its basis. */
  basis: string | null;
  definition: string;
};

const UNAVAILABLE_NAME = "Driver details unavailable";

/** A live offer or an advance (future-window) offer — both carry the same comparison. */
type OfferLike = Omit<MpOfferDto, "kind">;

/**
 * The driver card to show. The structured `driverProfile` (A06) is authoritative; an
 * older server's legacy fields are used ONLY when they say a verified profile backs
 * them — its placeholder rating ("–") and trip count (0) are never shown.
 */
export function driverCardOf(o: OfferLike): OfferDriverCard {
  const p = o.driverProfile;
  if (p) {
    const named = p.status !== "unavailable" && !!p.displayName;
    return {
      status: p.status,
      statusLabel: p.label,
      name: named ? (p.displayName as string) : UNAVAILABLE_NAME,
      initials: named && p.initials ? p.initials : "?",
      ratingLabel: p.ratingLabel,
      tripsLabel:
        p.completedTrips === null
          ? null
          : p.completedTrips.toLocaleString("en-GB") +
            (p.completedTrips === 1 ? " completed trip" : " completed trips"),
      plateMasked: o.vehicle?.verified ? (o.vehicle.plateMasked ?? null) : null,
    };
  }
  if (o.driver.profileStatus === "verified") {
    return {
      status: "verified",
      statusLabel: "Verified by UBI",
      name: o.driver.displayName,
      initials: o.driver.initials,
      ratingLabel: "Rating " + o.driver.rating,
      tripsLabel:
        o.driver.completedTrips.toLocaleString("en-GB") + " completed trips",
      plateMasked: o.driver.plateMasked,
    };
  }
  return {
    status: "unavailable",
    statusLabel: UNAVAILABLE_NAME,
    name: UNAVAILABLE_NAME,
    initials: "?",
    ratingLabel: "Rating unavailable",
    tripsLabel: null,
    plateMasked: null,
  };
}

/**
 * The legacy driver display (bookings, queue) read honestly: a real name, rating and plate
 * only when a verified profile backs them; otherwise "details unavailable" — never the
 * pseudonym or the "–" / 0 placeholders presented as figures.
 */
export function legacyDriverLine(d: MpOfferDto["driver"]): {
  name: string;
  detail: string;
} {
  if (d.profileStatus === "verified")
    return {
      name: d.displayName,
      detail: "Rating " + d.rating + " · " + d.vehicle + " · " + d.plateMasked,
    };
  return { name: UNAVAILABLE_NAME, detail: d.vehicle };
}

/** The server's "a driver you saved" criterion, when this offer's driver is one. */
export const savedLabelOf = (o: OfferLike): string | null =>
  o.serviceFit?.matched.find((c) => c.code === "saved_driver")?.label ?? null;

/** Reliability with its basis: the window and sample behind the figure, or why there is none. */
export function reliabilityLineOf(
  r: MpReliability | undefined,
): ReliabilityLine | null {
  if (!r) return null;
  const basis =
    r.status === "available"
      ? "Last " +
        r.windowDays +
        " days · " +
        r.sampleSize +
        " marketplace rides counted"
      : r.status === "insufficient_history"
        ? "Shown from " +
          r.minimumSample +
          " marketplace rides in " +
          r.windowDays +
          " days · " +
          r.sampleSize +
          " so far"
        : null;
  return {
    status: r.status,
    label: r.label,
    basis,
    definition: r.definition,
  };
}

/** "2 of 3 service criteria met" — the server's score in words, with what it counted. */
export function fitLineOf(fit: MpServiceFit | undefined): {
  label: string;
  matched: string[];
  unmet: string[];
  definition: string;
} | null {
  if (!fit || fit.maxScore === 0) return null;
  return {
    label:
      "Service fit: " +
      fit.score +
      " of " +
      fit.maxScore +
      (fit.maxScore === 1 ? " criterion met" : " criteria met"),
    matched: fit.matched.map((c) => c.label),
    unmet: fit.unmet.map((c) => c.label),
    definition: fit.definition,
  };
}

/** The vehicle line: the verified class always; make/model/colour only from a verified card. */
export function vehicleLineOf(o: OfferLike): string {
  const v = o.vehicle;
  if (!v) return o.driver.vehicle;
  const registered = v.verified
    ? [v.colour, v.make, v.model].filter(Boolean).join(" ")
    : "";
  return registered ? registered + " · " + v.class : v.class;
}

/** The pickup ESTIMATE as the server labelled it (falls back to the legacy label). */
export const pickupLineOf = (o: OfferLike) =>
  o.pickupEstimate?.label ?? o.pickupLabel;

/** Badges exactly as served — each carries its reason. */
export const badgesOf = (o: OfferLike): MpCriterion[] => o.badges ?? [];

/** What the rider pays: the server total when served, else the offered fare. */
export const payableOf = (o: OfferLike): Money => o.totalMinor ?? o.amountMinor;

/** The sorts a rider may ask the server for, with its own labels when it sent them. */
export const SORT_FALLBACK: { key: MpOfferSort; label: string }[] = [
  { key: "offered", label: "In the order drivers offered" },
  { key: "price", label: "Lowest total first" },
  { key: "pickup", label: "Earliest estimated pickup first" },
  { key: "service_fit", label: "Best service fit first" },
];

/** Short chip words for each server sort (the full label and tie-break print below). */
export const SORT_CHIP: Record<MpOfferSort, string> = {
  offered: "As offered",
  price: "Lowest total",
  pickup: "Soonest pickup",
  service_fit: "Best fit",
};
