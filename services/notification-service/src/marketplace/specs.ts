/**
 * The closed set of events that produce a notification, with per-viewer copy.
 *
 * Copy rules (DESIGN_HANDOFF "copy is distinct per state"; CLAUDE.md #8):
 *   - a push is a NUDGE to open the app; the authoritative, viewer-scoped
 *     state is pulled over REST. Copy NEVER contains money, a PIN, a name or
 *     a phone — so a rider can never read the driver's commission and a
 *     driver can never read rider PII, whatever the payload carries;
 *   - never promise transport before a real award: "confirmed" / "secured"
 *     appear only on events that follow an award (mp.award.confirmed,
 *     advance-booking activation/reminder, reservation.assigned). Scheduled
 *     requests always say no driver is secured yet;
 *   - the actor of an event is not pushed about their own action unless the
 *     catalog names them as the audience (NotificationSpec.notifyActor).
 *
 * Events absent from this map are deliberately not notified, e.g.:
 *   - mp.bid.expired / invalidated / withdrawn (offer-expiry suppression);
 *   - mp.request.published / revised / reopened (drivers discover via the feed;
 *     a scheduled request announces its publication itself);
 *   - mp.award.pending / failed / cancelled, mp.commission.*, mp.claim.created /
 *     released, mp.rate_profile.saved, mp.driver_preferences.saved — internal
 *     or non-actionable;
 *   - mp.amendment.awaiting_approvals / failed (intermediate; the outcome is
 *     announced), mp.amendment.proposed for a pre-authorized adjustment
 *     (stop_waiting / early_termination: nothing to approve; the commit is
 *     announced), mp.trip.terminated_early (the commit announces it),
 *     mp.stop.arrived / waiting_started / allowance_consumed /
 *     paid_waiting_accruing / departed / skipped (live screen state);
 *   - mp.recurring_occurrence.generated (reminders announce each occurrence;
 *     a push per generated day would be noise), mp.recurring_template.*;
 *   - trip_access.issued / revoked — the passenger is reached ONLY by the
 *     sealed trip-link SMS (../trip-access/), never by push;
 *   - reservation.retimed — the retime shows in the app; only outcomes
 *     (awarded / action required / failed / cancelled) are pushed.
 */
import {
  payloadId,
  type NotificationSpec,
  type ViewerCopy,
} from "./audience.js";

import type { EventEnvelope } from "@ubi/contracts";

function actorType(envelope: EventEnvelope): string {
  return envelope.actor.type;
}

/** Copy chosen by who acted (rider / driver / system); null for anyone else. */
function byActor(
  envelope: EventEnvelope,
  copies: Partial<Record<"rider" | "driver" | "system", ViewerCopy>>,
): ViewerCopy | null {
  const actor = actorType(envelope);
  return actor === "rider" || actor === "driver" || actor === "system"
    ? (copies[actor] ?? null)
    : null;
}

function text(envelope: EventEnvelope, key: string): string | null {
  return payloadId(envelope, key);
}

/** "in 12 hours" / "in 1 hour" from a reminder's offsetSec. */
export function leadPhrase(envelope: EventEnvelope): string {
  const sec = Number(envelope.payload.offsetSec);
  if (!Number.isFinite(sec) || sec <= 0) {
    return "soon";
  }
  if (sec % 3600 === 0) {
    const hours = sec / 3600;
    return hours === 1 ? "in 1 hour" : `in ${hours} hours`;
  }
  if (sec % 60 === 0) {
    const minutes = sec / 60;
    return minutes === 1 ? "in 1 minute" : `in ${minutes} minutes`;
  }
  return "soon";
}

const TRIP_CONTINUES = "The trip continues on the agreed terms.";

/**
 * Only a `route` amendment waits for the other party's approval. The
 * server-proposed kinds — `stop_waiting` (paid waiting the rider authorized up
 * front) and `early_termination` (a safe partial journey) — are pre-authorized
 * adjustments (ride-service amendment_apply.go createSystemAdjustment records
 * both approvals as implicit) that commit on their own, so a "needs your
 * approval" push for them would be false; their outcome (committed / not
 * applied) is announced instead.
 */
function awaitsApproval(envelope: EventEnvelope): boolean {
  return text(envelope, "kind") === "route";
}

// ── Advance-booking failure explanations (reason codes from ride-service
// advance.go BookingFail*/BookingCancelled*). Rider copy never mentions the
// driver's commission; driver copy never mentions the rider's payment.

const RIDER_BOOKING_REASON: Readonly<Record<string, string>> = {
  driver_withdrew: "Your reserved driver withdrew and can't attend.",
  driver_ineligible: "Your reserved driver can no longer take this ride.",
  driver_unavailable: "Your reserved driver is unavailable for this ride.",
  driver_on_running_trip: "Your reserved driver is still on another trip.",
  execution_blocked: "Your reserved ride couldn't be started.",
  reconfirmation_missed: "Your reserved driver didn't reconfirm in time.",
  funding_not_secured: "Payment for this ride couldn't be secured in time.",
  risk_unresolved:
    "Your reserved ride couldn't be kept by the assigned vehicle or driver in time.",
  award_cancelled: "This reserved ride was cancelled.",
  trip_cancelled: "This reserved ride was cancelled.",
};

const DRIVER_BOOKING_REASON: Readonly<Record<string, string>> = {
  rider_cancelled: "The rider cancelled this reserved job.",
  reconfirmation_missed:
    "You didn't reconfirm this reserved job in time, so it was released.",
  driver_ineligible:
    "You're not currently eligible for this reserved job, so it was released.",
  driver_unavailable: "This reserved job was released: you're unavailable.",
  driver_on_running_trip:
    "This reserved job was released because you're still on another trip.",
  funding_not_secured:
    "This reserved job was released: the booking couldn't be completed.",
  risk_unresolved:
    "This reserved job wasn't resolved before the deadline, so it was released.",
  execution_blocked: "This reserved job couldn't be started.",
  award_cancelled: "This reserved job was cancelled.",
  trip_cancelled: "This reserved job was cancelled.",
};

function financialOutcome(envelope: EventEnvelope): Record<string, unknown> {
  const value = envelope.payload.financialOutcome;
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function riderBookingEnded(envelope: EventEnvelope): ViewerCopy {
  const reason = text(envelope, "reason") ?? "";
  const money = financialOutcome(envelope);
  const parts = [
    RIDER_BOOKING_REASON[reason] ?? "Your reserved ride can't go ahead.",
  ];
  if (money.riderCharged === false) {
    parts.push(
      money.riderFundingReleased === true
        ? "You weren't charged and your payment hold was released."
        : "You weren't charged.",
    );
  }
  parts.push(
    envelope.payload.rematchAvailable === true
      ? "Open UBI to find another driver for the same time."
      : "Open UBI for details.",
  );
  return {
    title:
      envelope.name === "mp.advance_booking.cancelled"
        ? "Your reserved ride was cancelled"
        : "Your reserved ride can't go ahead",
    body: parts.join(" "),
  };
}

function driverBookingEnded(envelope: EventEnvelope): ViewerCopy {
  const reason = text(envelope, "reason") ?? "";
  const parts = [
    DRIVER_BOOKING_REASON[reason] ?? "This reserved job won't go ahead.",
  ];
  if (financialOutcome(envelope).commissionReversed === true) {
    parts.push("The commission you paid for it is returned.");
  }
  parts.push("Open UBI for details.");
  return { title: "Reserved job cancelled", body: parts.join(" ") };
}

// ── Scheduled request outcomes (scheduled.go scheduledClose*).

const UNFULFILLED_COPY: Readonly<Record<string, ViewerCopy>> = {
  no_driver_found: {
    title: "No driver for your scheduled ride",
    body: "No driver was secured for your scheduled ride. Nothing was charged. Open UBI to request a ride now.",
  },
  market_unavailable: {
    title: "Scheduled ride unavailable",
    body: "Rides aren't available for your scheduled trip right now, so it wasn't sent to drivers. Nothing was charged.",
  },
  too_late_for_offers: {
    title: "Scheduled ride not sent",
    body: "It became too late to collect driver offers for your scheduled ride. Nothing was charged. Open UBI to request a ride now.",
  },
};

// ── Airport transfer outcomes (travel-service transfer-policy.ts OUTCOME
// reasons). The airport ride and the flight are separate orders.

const TRANSFER_CANCELLED_COPY: Readonly<Record<string, ViewerCopy>> = {
  flight_cancelled: {
    title: "Airport ride cancelled",
    body: "Your flight was cancelled, so we cancelled your airport ride request before any driver was secured. Nothing was charged for the ride.",
  },
  cancelled_after_award: {
    title: "Airport ride cancelled",
    body: "Your airport ride was cancelled after a driver was secured. The ride's own cancellation rules apply; any fee shows on the ride receipt, never on your flight.",
  },
  cancelled_in_ride_app: {
    title: "Airport ride cancelled",
    body: "This airport ride was cancelled in the ride app. No driver is secured for it now. Open UBI for details.",
  },
};

export const NOTIFICATION_SPECS: Readonly<Record<string, NotificationSpec>> = {
  // ── Negotiated-fare marketplace (C06), now per viewer ──────────────────
  "mp.bid.submitted": {
    prefCategory: "ride",
    type: "RIDE_REQUESTED",
    copy: {
      requester: {
        title: "New offer on your request",
        body: "A driver sent you an offer. Open UBI to review it.",
      },
    },
  },
  "mp.bid.won": {
    prefCategory: "ride",
    type: "RIDE_ACCEPTED",
    copy: {
      driver: {
        title: "You won a request",
        body: "A rider chose your offer. Open UBI to see the job.",
      },
    },
  },
  "mp.bid.lost": {
    prefCategory: "ride",
    type: "RIDE_REQUESTED",
    copy: {
      // No amount, no winner identity — just that this offer was not selected.
      driver: {
        title: "Requester chose another driver",
        body: "Your offer wasn’t selected this time. Open UBI to keep bidding.",
      },
    },
  },
  "mp.award.confirmed": {
    prefCategory: "ride",
    type: "RIDE_ACCEPTED",
    copy: {
      // The winning driver is told by mp.bid.won in the same transaction.
      requester: {
        title: "Your driver is confirmed",
        body: "Open UBI to see your pickup details.",
      },
    },
  },
  "mp.claim.promoted": {
    prefCategory: "ride",
    type: "DRIVER_ARRIVING",
    copy: {
      requester: {
        title: "Your driver is on the way",
        body: "Your queued trip is starting. Open UBI for your PIN and pickup.",
      },
    },
  },
  "mp.queue.eta_updated": {
    prefCategory: "ride",
    type: "RIDE_REQUESTED",
    copy: {
      requester: {
        title: "Pickup ETA updated",
        body: "Your pickup estimate changed. Open UBI for the latest.",
      },
    },
  },
  "mp.queue.window_missed": {
    prefCategory: "ride",
    type: "RIDE_REQUESTED",
    copy: {
      requester: {
        title: "Pickup window update",
        body: "Your pickup is running late. Open UBI for your options.",
      },
    },
  },
  "mp.settlement.posted": {
    prefCategory: "payment",
    type: "PAYMENT_SUCCESSFUL",
    copy: {
      requester: {
        title: "Ride settled",
        body: "Your marketplace ride was settled. Open UBI for the receipt.",
      },
      driver: {
        title: "Trip settled",
        body: "Your marketplace trip was settled. Open UBI for your earnings.",
      },
    },
  },

  // ── Post-award trip amendments (A02) — subject mp_amendment ────────────
  // The proposer/decider is the actor and is not pushed; the other party is.
  // A proposal is announced only when it really awaits their approval (a
  // `route` change proposed by the other party); pre-authorized adjustments
  // are not (awaitsApproval).
  "mp.amendment.proposed": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      requester: (e) =>
        awaitsApproval(e)
          ? byActor(e, {
              driver: {
                title: "Trip change proposed",
                body: "Your driver proposed a change to your trip. Open UBI to review it — nothing changes unless you approve.",
              },
            })
          : null,
      driver: (e) =>
        awaitsApproval(e)
          ? byActor(e, {
              rider: {
                title: "Trip change requested",
                body: "Your rider asked to change the trip. Open UBI to review it — nothing changes unless you approve.",
              },
            })
          : null,
    },
  },
  "mp.amendment.approved": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      requester: (e) =>
        byActor(e, {
          driver: {
            title: "Driver approved the change",
            body: "Your driver approved the trip change. Open UBI to see where it stands.",
          },
        }),
      driver: (e) =>
        byActor(e, {
          rider: {
            title: "Rider approved the change",
            body: "Your rider approved the trip change. Open UBI to see where it stands.",
          },
        }),
    },
  },
  "mp.amendment.rejected": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      requester: (e) =>
        byActor(e, {
          driver: {
            title: "Trip change declined",
            body: `Your driver declined the trip change. ${TRIP_CONTINUES}`,
          },
          system: {
            title: "Trip change not applied",
            body: `The trip change couldn't be applied. ${TRIP_CONTINUES}`,
          },
        }),
      driver: (e) =>
        byActor(e, {
          rider: {
            title: "Trip change declined",
            body: `Your rider declined the trip change. ${TRIP_CONTINUES}`,
          },
          system: {
            title: "Trip change not applied",
            body: `The trip change couldn't be applied. ${TRIP_CONTINUES}`,
          },
        }),
    },
  },
  "mp.amendment.expired": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      requester: {
        title: "Trip change expired",
        body: `The trip change wasn't approved in time. ${TRIP_CONTINUES}`,
      },
      driver: {
        title: "Trip change expired",
        body: `The trip change wasn't approved in time. ${TRIP_CONTINUES}`,
      },
    },
  },
  "mp.amendment.committed": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      requester: {
        title: "Trip updated",
        body: "Your trip change is confirmed. Open UBI for the updated route and fare.",
      },
      driver: {
        title: "Trip updated",
        body: "The trip change is confirmed. Open UBI for the updated route and earnings.",
      },
    },
  },
  "mp.amendment.compensated": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      requester: {
        title: "Trip change not applied",
        body: `The trip change couldn't be completed and was undone. ${TRIP_CONTINUES}`,
      },
      driver: {
        title: "Trip change not applied",
        body: `The trip change couldn't be completed and was undone. ${TRIP_CONTINUES}`,
      },
    },
  },

  // ── Stops and paid waiting (A02 item 7) — subject mp_award ─────────────
  "mp.stop.waiting_approval_required": {
    prefCategory: "ride",
    type: "GENERAL",
    smsFallback: true,
    copy: {
      requester: {
        title: "Approve more waiting?",
        body: "Your driver is still waiting at a stop and your approved waiting limit is reached. Open UBI to approve more waiting or continue the trip.",
      },
      driver: {
        title: "Waiting limit reached",
        body: "The rider's approved waiting limit is reached and they've been asked to approve more. Open UBI for details.",
      },
    },
  },
  "mp.stop.excessive_waiting": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      requester: {
        title: "Your driver has waited a long time",
        body: "Your driver has waited a long time at a stop and may now continue the trip without it. Open UBI for details.",
      },
      driver: {
        title: "You may leave this stop",
        body: "You've waited long enough at this stop and may now continue the trip. Open UBI.",
      },
    },
  },

  // ── Book for Later: scheduled requests (A03) — rider-only; no driver is
  // secured in any of these ────────────────────────────────────────────────
  "mp.scheduled_request.needs_approval": {
    prefCategory: "ride",
    type: "GENERAL",
    smsFallback: true,
    copy: {
      requester: {
        title: "Approve your scheduled ride",
        body: "Your scheduled ride needs your approval before it's sent to drivers. No driver is booked yet. Open UBI to review.",
      },
    },
  },
  "mp.scheduled_request.published": {
    prefCategory: "ride",
    type: "RIDE_REQUESTED",
    copy: {
      requester: {
        title: "Your scheduled ride is open to drivers",
        body: "Drivers can now send offers for your scheduled ride. No driver is confirmed until you choose an offer.",
      },
    },
  },
  "mp.scheduled_request.unfulfilled": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      requester: (e) =>
        UNFULFILLED_COPY[text(e, "reason") ?? ""] ?? {
          title: "No driver for your scheduled ride",
          body: "Your scheduled ride didn't get a driver. Nothing was charged. Open UBI for details.",
        },
    },
  },
  "mp.scheduled_request.expired": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      requester: {
        title: "Scheduled ride expired",
        body: "The pickup time for your scheduled ride passed before a driver was secured. Nothing was charged.",
      },
    },
  },
  "mp.scheduled_request.reminder": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      requester: (e) => ({
        title: "Scheduled ride reminder",
        body: `Your scheduled ride is ${leadPhrase(e)}. No driver is secured yet — it's sent to drivers at its lead time.`,
      }),
    },
  },
  "mp.scheduled_request.skipped": {
    // Recurring occurrence status: a system skip is announced; the rider's
    // own skip is not (they are the actor).
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      requester: (e) =>
        text(e, "templateId") !== null
          ? {
              title: "A ride in your series was skipped",
              body: "One ride in your recurring series was skipped and won't be sent to drivers. Open UBI for details.",
            }
          : {
              title: "Scheduled ride skipped",
              body: "Your scheduled ride was skipped and won't be sent to drivers. Open UBI for details.",
            },
    },
  },

  // ── Book for Later: advance driver reservations (A03) — a driver IS
  // secured once the advance award captured the commission ────────────────
  "mp.advance_booking.reminder": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      requester: (e) =>
        e.payload.fullySecured === false
          ? {
              title: "Upcoming reserved ride",
              body: `Your reserved ride is ${leadPhrase(e)}. Your payment still needs to be secured — open UBI to finish it.`,
            }
          : {
              title: "Upcoming reserved ride",
              body: `Your reserved ride is ${leadPhrase(e)}. Your driver is booked. Open UBI for the pickup details.`,
            },
      driver: (e) => ({
        title: "Upcoming reserved job",
        body: `You have a reserved pickup ${leadPhrase(e)}. Open UBI for the details.`,
      }),
    },
  },
  "mp.advance_booking.reconfirm_requested": {
    prefCategory: "ride",
    type: "GENERAL",
    smsFallback: true,
    copy: {
      driver: {
        title: "Reconfirm your reserved job",
        body: "Please reconfirm you'll make your reserved pickup before the deadline, or the job is released. Open UBI to reconfirm.",
      },
    },
  },
  "mp.advance_booking.failed": {
    prefCategory: "ride",
    type: "GENERAL",
    smsFallback: true,
    copy: {
      requester: (e) =>
        e.payload.choiceOffered === true ? null : riderBookingEnded(e),
      driver: driverBookingEnded,
    },
  },
  "mp.advance_booking.cancelled": {
    prefCategory: "ride",
    type: "GENERAL",
    smsFallback: true,
    copy: { requester: riderBookingEnded, driver: driverBookingEnded },
  },
  "mp.advance_booking.risk_changed": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      driver: (e) =>
        text(e, "risk") === "at_risk"
          ? {
              title: "Reserved job needs a decision",
              body: "A vehicle or schedule change affects your reserved job. Open UBI to review your options before the deadline.",
            }
          : {
              title: "Reserved job back on track",
              body: "Your reserved job is no longer at risk. Open UBI for the details.",
            },
    },
  },
  "mp.advance_booking.choice_offered": {
    prefCategory: "ride",
    type: "GENERAL",
    smsFallback: true,
    copy: {
      requester: (e) => {
        const reason =
          RIDER_BOOKING_REASON[text(e, "reason") ?? ""] ??
          "Your reserved ride can't go ahead with its original driver.";
        const money = financialOutcome(e);
        const refundNote =
          money.riderCharged === false
            ? money.riderFundingReleased === true
              ? "You weren't charged and your payment hold was released."
              : "You weren't charged."
            : "Your payment is protected.";
        const choiceNote =
          e.payload.rematchAvailable === true
            ? "Open UBI to request a same-fare rematch or take a full refund."
            : "Not enough time remains to rematch before pickup — open UBI to confirm your refund or request a live ride.";
        return {
          title:
            e.payload.rematchAvailable === true
              ? "Choose a rematch or refund"
              : "Your reserved ride can't go ahead",
          body: `${reason} ${refundNote} ${choiceNote}`,
        };
      },
    },
  },
  "mp.advance_booking.activated": {
    prefCategory: "ride",
    type: "DRIVER_ARRIVING",
    copy: {
      requester: {
        title: "Your reserved ride is starting",
        body: "Your reserved driver now has your trip. Open UBI for your PIN and pickup.",
      },
      driver: (e) =>
        text(e, "slot") === "next"
          ? {
              title: "Reserved job queued",
              body: "Your reserved pickup is queued after your current trip. Open UBI for the details.",
            }
          : {
              title: "Reserved job is now active",
              body: "Your reserved pickup is now your current job. Open UBI to head to the pickup.",
            },
    },
  },

  // ── Vehicle swaps on advance bookings (Q4) ─────────────────────────────
  "mp.vehicle_swap.proposed": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      driver: {
        title: "Vehicle swap proposed for your job",
        body: "Your fleet proposed a replacement vehicle for one of your reserved jobs. Open UBI to accept or decline.",
      },
    },
  },
  "mp.vehicle_swap.rider_consent_requested": {
    prefCategory: "ride",
    type: "GENERAL",
    smsFallback: true,
    copy: {
      requester: {
        title: "Approve a replacement vehicle?",
        body: "Your driver's original vehicle is unavailable and a replacement vehicle of the same class is ready. Open UBI to approve or decline.",
      },
    },
  },
  "mp.vehicle_swap.applied": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      requester: {
        title: "Replacement vehicle confirmed",
        body: "Your reserved ride is confirmed on the replacement vehicle. Open UBI for the updated vehicle details.",
      },
      driver: {
        title: "Vehicle swap confirmed",
        body: "The replacement vehicle is confirmed for your reserved job. Open UBI for the details.",
      },
      fleet_owner: {
        title: "Vehicle swap confirmed",
        body: "The rider and driver confirmed the replacement vehicle for a booked trip. Open the Fleet Portal for details.",
      },
      fleet_manager: {
        title: "Vehicle swap confirmed",
        body: "The rider and driver confirmed the replacement vehicle for a booked trip. Open the Fleet Portal for details.",
      },
    },
  },
  "mp.vehicle_swap.rider_declined": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      driver: {
        title: "Replacement vehicle declined",
        body: "The rider declined the replacement vehicle, so the reserved job was released and your commission is returned. Open UBI for details.",
      },
      fleet_owner: {
        title: "Vehicle swap declined",
        body: "A replacement vehicle swap was not accepted for a booked trip. Open the Fleet Portal for details.",
      },
      fleet_manager: {
        title: "Vehicle swap declined",
        body: "A replacement vehicle swap was not accepted for a booked trip. Open the Fleet Portal for details.",
      },
    },
  },
  "mp.vehicle_swap.expired": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      requester: {
        title: "Vehicle swap expired",
        body: "The replacement vehicle offer for your reserved ride expired before it was confirmed. Open UBI for your booking options.",
      },
      driver: {
        title: "Vehicle swap expired",
        body: "The replacement vehicle proposal for your reserved job expired in time. Open UBI to check the booking.",
      },
      fleet_owner: {
        title: "Vehicle swap expired",
        body: "A replacement vehicle proposal expired before confirmation. Open the Fleet Portal for details.",
      },
      fleet_manager: {
        title: "Vehicle swap expired",
        body: "A replacement vehicle proposal expired before confirmation. Open the Fleet Portal for details.",
      },
    },
  },

  // ── Preferred-driver requests (A04 item 3) — subject mp_request ────────
  "mp.request.preferred_driver_invited": {
    prefCategory: "ride",
    type: "RIDE_REQUESTED",
    copy: {
      // The rider is never identified to the invited driver.
      driver: {
        title: "You're invited to offer first",
        body: "A rider invited you to send the first offer on their request. Open UBI to view it before the window closes.",
      },
    },
  },
  "mp.request.preferred_driver_declined": {
    // Announced to the declining driver alone (catalog); the rider is told
    // only the outcome (opened to market / closed).
    prefCategory: "ride",
    type: "GENERAL",
    notifyActor: true,
    copy: {
      driver: {
        title: "Invitation declined",
        body: "You declined the invitation. Declining is free and doesn't affect your standing.",
      },
    },
  },
  "mp.request.opened_to_market": {
    prefCategory: "ride",
    type: "RIDE_REQUESTED",
    copy: {
      requester: {
        title: "Your request is open to other drivers",
        body: "Your preferred driver didn't send an offer, so, as you allowed, other drivers can now send offers. No driver is confirmed yet.",
      },
    },
  },
  "mp.request.closed": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      // Only the preferred-driver lapse is pushed; other closes are visible
      // in the app the rider is already watching.
      requester: (e) =>
        text(e, "reason") === "preferred_driver_unavailable"
          ? {
              title: "Preferred driver unavailable",
              body: "Your preferred driver didn't send an offer in time, so your request was closed. Nothing was charged.",
            }
          : null,
    },
  },

  // ── Book for another adult (A06 part B) — the REQUESTER hears of the
  // passenger's free decline; the passenger is never pushed ───────────────
  "trip_access.declined": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      requester: {
        title: "Your passenger declined the ride",
        body: "The person you booked a ride for declined it before pickup. There's no fee for this. Open UBI for details.",
      },
    },
  },

  // ── Delivery returns (G08/C07 custody) — the SENDER approves a return ──
  // Expected payload (the producer is not wired yet): deliveryId, returnId,
  // senderId, chargeStatus ("authorization_required" when a fee needs the
  // sender's approval), consentExpiresAt. Drivers are never addressed.
  "shipment.return_proposed": {
    prefCategory: "delivery",
    type: "DELIVERY_IN_TRANSIT",
    smsFallback: true,
    copy: {
      sender: (e) =>
        text(e, "chargeStatus") === "authorization_required"
          ? {
              title: "Approve a return fee",
              body: "Your delivery couldn't be completed. Open UBI to approve the return fee or choose another option before the deadline.",
            }
          : {
              title: "Return proposed for your delivery",
              body: "Your delivery couldn't be completed and a return was proposed. Open UBI to respond before the deadline.",
            },
    },
  },

  // ── Airport transfers (travel-service reservation.*) — the TRAVELLER ───
  "reservation.assigned": {
    prefCategory: "ride",
    type: "RIDE_ACCEPTED",
    copy: {
      traveller: (e) =>
        text(e, "state") === "awarded"
          ? {
              title: "Driver secured for your airport ride",
              body: "A driver is confirmed for your airport ride. Open UBI for the pickup details.",
            }
          : null,
    },
  },
  "reservation.requested": {
    // ACTION REQUIRED: the orchestrator (system) parked the transfer back in
    // pending_unassigned because it needs the traveller's approval. The
    // traveller's own requests/approvals and "a request was made" (no driver
    // yet) are not pushed.
    prefCategory: "ride",
    type: "GENERAL",
    smsFallback: true,
    copy: {
      traveller: (e) =>
        text(e, "state") === "pending_unassigned" && actorType(e) === "system"
          ? {
              title: "Action needed for your airport ride",
              body: "Your airport ride needs your approval before it can be sent to drivers. No driver is secured yet. Open UBI to review.",
            }
          : null,
    },
  },
  "reservation.reservation_failed": {
    // Carries both `failed` and `cancelled` (the catalog has no
    // reservation.cancelled yet); `state` tells them apart.
    prefCategory: "ride",
    type: "GENERAL",
    smsFallback: true,
    copy: {
      traveller: (e) => {
        const state = text(e, "state");
        if (state === "failed") {
          return {
            title: "No driver for your airport ride",
            body: "We couldn't secure a driver for your airport ride. Nothing was charged for the ride, and your flight booking is unaffected. Open UBI for options.",
          };
        }
        if (state === "cancelled") {
          return (
            TRANSFER_CANCELLED_COPY[text(e, "reason") ?? ""] ?? {
              title: "Airport ride cancelled",
              body: "Your airport ride was cancelled. Open UBI for details.",
            }
          );
        }
        return null;
      },
    },
  },

  // ── Fleet & driver arrangements, maintenance, documents, conflicts ─────
  "assignment.proposal.status.changed": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      driver: (e) => {
        const to = text(e, "to");
        if (to === "pending_signature") {
          return {
            title: "New vehicle arrangement offer",
            body: "A fleet sent you a vehicle arrangement offer. Open UBI to review the terms and sign or decline.",
          };
        }
        if (to === "expired") {
          return {
            title: "Arrangement offer expired",
            body: "A vehicle arrangement offer expired before it was signed. Open UBI for details.",
          };
        }
        if (to === "withdrawn") {
          return {
            title: "Arrangement offer withdrawn",
            body: "A fleet withdrew a pending vehicle arrangement offer. Open UBI for details.",
          };
        }
        return null;
      },
      fleet_owner: (e) => {
        const to = text(e, "to");
        if (to === "declined") {
          return {
            title: "Arrangement offer declined",
            body: "A driver declined a vehicle arrangement proposal. Open the Fleet Portal to review.",
          };
        }
        if (to === "expired") {
          return {
            title: "Arrangement offer expired",
            body: "A vehicle arrangement proposal expired unsigned. Open the Fleet Portal to review.",
          };
        }
        return null;
      },
      fleet_manager: (e) => {
        const to = text(e, "to");
        if (to === "declined") {
          return {
            title: "Arrangement offer declined",
            body: "A driver declined a vehicle arrangement proposal. Open the Fleet Portal to review.",
          };
        }
        if (to === "expired") {
          return {
            title: "Arrangement offer expired",
            body: "A vehicle arrangement proposal expired unsigned. Open the Fleet Portal to review.",
          };
        }
        return null;
      },
    },
  },
  "assignment.signed": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      fleet_owner: {
        title: "Vehicle arrangement signed",
        body: "A driver signed a vehicle arrangement proposal. Open the Fleet Portal to view the active arrangement.",
      },
      fleet_manager: {
        title: "Vehicle arrangement signed",
        body: "A driver signed a vehicle arrangement proposal. Open the Fleet Portal to view the active arrangement.",
      },
    },
  },
  "assignment.status.changed": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      driver: (e) => {
        const to = text(e, "to");
        if (to === "notice") {
          return {
            title: "Notice given on your arrangement",
            body: "A two-week notice period has started on your vehicle arrangement. Open UBI to review your schedule and bookings.",
          };
        }
        if (to === "ended") {
          return {
            title: "Vehicle arrangement ended",
            body: "Your vehicle arrangement has ended. Open UBI for your schedule.",
          };
        }
        return null;
      },
      fleet_owner: (e) => {
        const to = text(e, "to");
        if (to === "notice") {
          return {
            title: "Notice given on an arrangement",
            body: "A two-week notice period has started on a vehicle arrangement. Open the Fleet Portal to review.",
          };
        }
        if (to === "ended") {
          return {
            title: "Vehicle arrangement ended",
            body: "A vehicle arrangement has ended. Open the Fleet Portal for details.",
          };
        }
        return null;
      },
      fleet_manager: (e) => {
        const to = text(e, "to");
        if (to === "notice") {
          return {
            title: "Notice given on an arrangement",
            body: "A two-week notice period has started on a vehicle arrangement. Open the Fleet Portal to review.",
          };
        }
        if (to === "ended") {
          return {
            title: "Vehicle arrangement ended",
            body: "A vehicle arrangement has ended. Open the Fleet Portal for details.",
          };
        }
        return null;
      },
    },
  },
  "maintenance.status.changed": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      fleet_owner: (e) => {
        const to = text(e, "to");
        if (to === "scheduled") {
          return {
            title: "Maintenance scheduled",
            body: "A planned maintenance block is now scheduled. Open the Fleet Portal calendar for details.",
          };
        }
        if (to === "cancelled") {
          return {
            title: "Maintenance block cancelled",
            body: "A planned maintenance block was cancelled. Open the Fleet Portal calendar for details.",
          };
        }
        if (to === "completed") {
          return {
            title: "Vehicle back in service",
            body: "A maintenance block was marked complete and the vehicle is back in service. Open the Fleet Portal for details.",
          };
        }
        return null;
      },
      fleet_manager: (e) => {
        const to = text(e, "to");
        if (to === "scheduled") {
          return {
            title: "Maintenance scheduled",
            body: "A planned maintenance block is now scheduled. Open the Fleet Portal calendar for details.",
          };
        }
        if (to === "cancelled") {
          return {
            title: "Maintenance block cancelled",
            body: "A planned maintenance block was cancelled. Open the Fleet Portal calendar for details.",
          };
        }
        if (to === "completed") {
          return {
            title: "Vehicle back in service",
            body: "A maintenance block was marked complete and the vehicle is back in service. Open the Fleet Portal for details.",
          };
        }
        return null;
      },
    },
  },
  "fleet.offroad.reported": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      fleet_owner: {
        title: "Vehicle reported off-road",
        body: "A fleet vehicle was reported off-road. Open the Fleet Portal to review affected shifts and bookings.",
      },
      fleet_manager: {
        title: "Vehicle reported off-road",
        body: "A fleet vehicle was reported off-road. Open the Fleet Portal to review affected shifts and bookings.",
      },
    },
  },
  "fleet.offroad.flagged": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      ubi_ops: {
        title: "Off-road report flagged for review",
        body: "A vehicle reported off-road was seen active during the claimed breakdown window. Open Admin to review.",
      },
    },
  },
  "fleet.alert": {
    prefCategory: "ride",
    type: "GENERAL",
    smsFallback: (e) => text(e, "severity") === "cannot_drive",
    copy: {
      fleet_owner: (e) =>
        text(e, "severity") === "cannot_drive"
          ? {
              title: "Driver reported a breakdown",
              body: "A driver reported that a fleet vehicle cannot be driven. Open the Fleet Portal to arrange cover or a vehicle swap.",
            }
          : {
              title: "Driver requested vehicle service",
              body: "A driver reported that a fleet vehicle needs service soon. Open the Fleet Portal to plan maintenance.",
            },
      fleet_manager: (e) =>
        text(e, "severity") === "cannot_drive"
          ? {
              title: "Driver reported a breakdown",
              body: "A driver reported that a fleet vehicle cannot be driven. Open the Fleet Portal to arrange cover or a vehicle swap.",
            }
          : {
              title: "Driver requested vehicle service",
              body: "A driver reported that a fleet vehicle needs service soon. Open the Fleet Portal to plan maintenance.",
            },
    },
  },
  "fleet.conflict.opened": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      driver: (e) =>
        text(e, "driverId") !== null &&
        text(e, "type") !== "vehicle_service_requested"
          ? {
              title: "Schedule conflict needs your attention",
              body: "A schedule or vehicle conflict affects one of your reserved jobs. Open UBI to review your options before the deadline.",
            }
          : null,
      fleet_owner: (e) => {
        if (text(e, "fleetId") === null) return null;
        const type = text(e, "type");
        if (type === "time_off_overlaps_booking") {
          return {
            title: "Driver resolving a booking",
            body: "A driver is resolving a conflict on an upcoming booking. Open the Fleet Portal conflict centre for status.",
          };
        }
        if (type === "vehicle_service_requested") {
          return {
            title: "Vehicle service requested",
            body: "A driver flagged a vehicle as needing service soon. Open the Fleet Portal conflict centre to plan maintenance.",
          };
        }
        return {
          title: "New fleet schedule conflict",
          body: "A schedule or vehicle conflict needs attention in your fleet. Open the Fleet Portal conflict centre.",
        };
      },
      fleet_manager: (e) => {
        if (text(e, "fleetId") === null) return null;
        const type = text(e, "type");
        if (type === "time_off_overlaps_booking") {
          return {
            title: "Driver resolving a booking",
            body: "A driver is resolving a conflict on an upcoming booking. Open the Fleet Portal conflict centre for status.",
          };
        }
        if (type === "vehicle_service_requested") {
          return {
            title: "Vehicle service requested",
            body: "A driver flagged a vehicle as needing service soon. Open the Fleet Portal conflict centre to plan maintenance.",
          };
        }
        return {
          title: "New fleet schedule conflict",
          body: "A schedule or vehicle conflict needs attention in your fleet. Open the Fleet Portal conflict centre.",
        };
      },
    },
  },
  "fleet.conflict.resolved": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      driver: (e) =>
        text(e, "driverId") !== null &&
        text(e, "type") !== "vehicle_service_requested"
          ? {
              title: "Schedule conflict resolved",
              body: "A conflict on your schedule has been resolved. Open UBI to view your updated schedule.",
            }
          : null,
      fleet_owner: (e) =>
        text(e, "fleetId") !== null
          ? {
              title: "Fleet conflict resolved",
              body: "A conflict in your fleet's conflict centre has been resolved. Open the Fleet Portal for details.",
            }
          : null,
      fleet_manager: (e) =>
        text(e, "fleetId") !== null
          ? {
              title: "Fleet conflict resolved",
              body: "A conflict in your fleet's conflict centre has been resolved. Open the Fleet Portal for details.",
            }
          : null,
    },
  },
  "fleet.conflict.lapsed": {
    prefCategory: "ride",
    type: "GENERAL",
    smsFallback: true,
    copy: {
      driver: (e) =>
        text(e, "driverId") !== null
          ? {
              title: "Conflict deadline passed",
              body: "The decision deadline on a schedule conflict has passed. Open UBI to check the affected job.",
            }
          : null,
      fleet_owner: (e) =>
        text(e, "fleetId") !== null
          ? {
              title: "Conflict deadline passed",
              body: "A conflict in your fleet passed its decision deadline without resolution. Open the Fleet Portal conflict centre.",
            }
          : null,
      fleet_manager: (e) =>
        text(e, "fleetId") !== null
          ? {
              title: "Conflict deadline passed",
              body: "A conflict in your fleet passed its decision deadline without resolution. Open the Fleet Portal conflict centre.",
            }
          : null,
    },
  },
  "fleet.conflict.reminder_sent": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      driver: {
        title: "Reminder: decision needed on your job",
        body: "Your fleet sent a reminder about an open booking conflict on your schedule. Open UBI to choose an option before the deadline.",
      },
    },
  },
  "vehicle.document.expiring": {
    prefCategory: "ride",
    type: "GENERAL",
    copy: {
      fleet_owner: {
        title: "Vehicle document expiring soon",
        body: "A required document on one of your fleet vehicles is expiring soon. Open the Fleet Portal to upload a renewal.",
      },
      fleet_manager: {
        title: "Vehicle document expiring soon",
        body: "A required document on one of your fleet vehicles is expiring soon. Open the Fleet Portal to upload a renewal.",
      },
    },
  },
  "vehicle.document.expired": {
    prefCategory: "ride",
    type: "GENERAL",
    smsFallback: true,
    copy: {
      fleet_owner: {
        title: "Vehicle held: document expired",
        body: "A required document on one of your fleet vehicles has expired and the vehicle is held from service. Open the Fleet Portal for details.",
      },
      fleet_manager: {
        title: "Vehicle held: document expired",
        body: "A required document on one of your fleet vehicles has expired and the vehicle is held from service. Open the Fleet Portal for details.",
      },
    },
  },
  "driver.availability.saved": {
    prefCategory: "ride",
    type: "GENERAL",
    notifyActor: true,
    copy: {
      driver: (e) =>
        Number(e.payload.withdrawalsChosen) > 0
          ? {
              title: "Availability saved with withdrawals",
              body: "Your availability windows were saved. Open UBI to finish any booking withdrawals you selected.",
            }
          : null,
    },
  },
};

/** Redis glob patterns whose events this table can notify. */
export const NOTIFICATION_PATTERNS: readonly string[] = [
  "event:mp.*",
  "event:trip_access.declined",
  "event:reservation.*",
  "event:shipment.return_proposed",
  "event:fleet.*",
  "event:assignment.*",
  "event:maintenance.*",
  "event:vehicle.document.*",
  "event:driver.availability.saved",
];
