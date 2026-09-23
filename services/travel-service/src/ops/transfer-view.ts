/**
 * What a traveller (or travel-ops) sees of an airport transfer.
 *
 * `driverSecured` is true in exactly one state — `awarded`, written only when
 * ride-service reported a requester-approved award — and every label says so.
 * Until then the transfer is pending with honest copy: no driver yet, nothing
 * charged for the ride. Ride-service's own labels for the scheduled request
 * (which never claim a secured driver before an award) are shown as it
 * phrased them. The flight and the ride are separate orders: nothing here
 * carries a flight price, and the ride's money is ride-service's.
 */
import { localLabel, outcomeOf, TRANSFER_TERMS } from "./transfer-policy";

import type { TransferRow } from "./transfer-store";
import type { JsonRecord } from "./types";

function jsonRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

const PENDING_NOTICE =
  "No driver yet. We ask UBI rides to schedule this ride as your trip gets close, and drivers see it near the pickup time. No driver is secured and nothing is charged for the ride until you choose a driver's offer in the ride app.";

function labels(row: TransferRow): { statusLabel: string; notice: string } {
  const action = jsonRecord(row.actionRequired);
  const ride = jsonRecord(row.rideNotice);
  const outcome = jsonRecord(row.outcome);
  switch (row.state) {
    case "pending_unassigned":
      return {
        statusLabel: "Pending — no driver yet",
        notice:
          typeof action?.message === "string" ? action.message : PENDING_NOTICE,
      };
    case "requested": {
      // ride-service's own words for a live scheduled request; ours while
      // one is being (re-)made.
      const live = row.scheduledRequestId !== null;
      const rideNotice =
        live && typeof ride?.notice === "string"
          ? ride.notice
          : "UBI rides is scheduling this ride. No driver is secured until you choose a driver's offer in the ride app.";
      return {
        statusLabel:
          live && typeof ride?.statusLabel === "string"
            ? ride.statusLabel
            : "Requested — no driver secured yet",
        notice:
          typeof action?.message === "string" ? action.message : rideNotice,
      };
    }
    case "awarded":
      return {
        statusLabel: "Driver secured",
        notice:
          typeof action?.message === "string"
            ? action.message
            : "A driver is secured through the offer you selected in the ride app. The fare and pickup are exactly as you accepted them there.",
      };
    case "failed":
      return {
        statusLabel: "Not booked — no driver",
        notice:
          typeof outcome?.message === "string"
            ? outcome.message
            : (outcomeOf("ride_refused").message as string),
      };
    default:
      return {
        statusLabel: "Cancelled",
        notice:
          typeof outcome?.message === "string"
            ? outcome.message
            : (outcomeOf("cancelled_by_traveller").message as string),
      };
  }
}

export function transferView(row: TransferRow): JsonRecord {
  const { statusLabel, notice } = labels(row);
  const action = jsonRecord(row.actionRequired);
  return {
    transferId: row.id,
    linkedOrderId: row.orderId,
    direction: row.direction,
    legIndex: row.legIndex,
    flightNumber: row.flightNumber,
    airportCode: row.airportCode,
    status: row.state,
    driverSecured: row.state === "awarded",
    statusLabel,
    notice,
    pickup: jsonRecord(row.pickup),
    dropoff: jsonRecord(row.dropoff),
    pickupWindow:
      row.pickupAt === null || row.windowEnd === null
        ? null
        : {
            start: iso(row.pickupAt),
            end: iso(row.windowEnd),
            timeZone: row.timeZone,
            label: `${localLabel(row.pickupAt, row.timeZone)} – ${localLabel(row.windowEnd, row.timeZone)}`,
          },
    arriveBy:
      row.arriveBy === null
        ? null
        : {
            at: iso(row.arriveBy),
            timeZone: row.timeZone,
            label: localLabel(row.arriveBy, row.timeZone),
          },
    flight: {
      departAt: iso(row.flightDepartAt),
      arriveAt: iso(row.flightArriveAt),
      status: row.flightStatus,
    },
    vehicleClass: row.vehicleClass,
    approvedMaxFareMinor: {
      amountMinor: Number(row.maxFareMinor),
      currency: row.currency,
    },
    paymentMethodId: row.paymentMethodId,
    policyVersion: row.policyVersion,
    ride:
      row.scheduledRequestId === null && row.rideRequestId === null
        ? null
        : {
            scheduledRequestId: row.scheduledRequestId,
            requestId: row.rideRequestId,
            state: row.rideState,
            requestState: row.rideRequestState,
          },
    retimedCount: row.retimedCount,
    actionRequired:
      action === null
        ? null
        : {
            reason: action.reason ?? null,
            message: action.message ?? null,
            choices: action.choices ?? [],
            ...(action.minimumFareMinor === undefined
              ? {}
              : { minimumFareMinor: action.minimumFareMinor }),
            ...(action.proposal === undefined
              ? {}
              : { proposal: action.proposal }),
          },
    outcome: jsonRecord(row.outcome),
    terms: [...TRANSFER_TERMS],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
