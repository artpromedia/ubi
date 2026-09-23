// The words the A02/A03 rider screens print: status words never collapse distinct server
// states, a series is never "confirmed" in any state, refusals map to plain sentences
// (unknown ones keep the server's message) and time/distance labels are formatting only.
import { ApiError } from "@ubi/mobile-core";
import {
  MP_ADVANCE_BOOKING_STATES,
  MP_RECURRING_TEMPLATE_STATES,
  MP_SCHEDULED_REQUEST_STATES,
} from "@ubi/contracts";
import {
  bookingStatus,
  clock,
  inLabel,
  km,
  minutes,
  refusalFor,
  scheduledStatus,
  seriesStatus,
  signedKm,
  signedMinutes,
} from "../src/screens/marketplace/riderCopy";
import { localDateIn } from "../src/screens/marketplace/ScheduleRideContainer";
import { booking, scheduled, series } from "./helpers/mpFixtures";

describe("status words", () => {
  it("a series is never 'confirmed', whatever its state", () => {
    for (const state of MP_RECURRING_TEMPLATE_STATES)
      expect(seriesStatus(series({ state })).label).not.toMatch(/confirm/i);
  });

  it("an advance booking is 'Driver confirmed' ONLY when reserved and fully secured", () => {
    const labels = MP_ADVANCE_BOOKING_STATES.map((state) => [
      state,
      bookingStatus(booking({ state, fullySecured: true })).label,
      bookingStatus(booking({ state, fullySecured: false })).label,
    ]);
    for (const [state, secured, unsecured] of labels) {
      expect(unsecured).not.toBe("Driver confirmed");
      if (state !== "confirmed" && state !== "reconfirmed")
        expect(secured).not.toMatch(/^Driver confirmed/);
    }
    expect(bookingStatus(booking({ state: "confirmed" })).label).toBe(
      "Driver confirmed",
    );
    expect(
      bookingStatus(booking({ state: "payment_pending", fullySecured: false }))
        .label,
    ).toBe("Driver reserved · payment pending");
  });

  it("a scheduled request never claims a driver before one is secured", () => {
    for (const state of MP_SCHEDULED_REQUEST_STATES) {
      const word = scheduledStatus(
        scheduled({ state, driverSecured: false }),
      ).label;
      expect(word).not.toMatch(/secured|confirmed/i);
    }
    expect(
      scheduledStatus(scheduled({ state: "published", driverSecured: true }))
        .label,
    ).toBe("Driver secured");
  });
});

describe("refusals in plain words", () => {
  it("maps next_job_conflict and insufficient funds, and keeps unknown server messages", () => {
    expect(
      refusalFor(
        new ApiError(409, "conflict", "x", { reason: "next_job_conflict" }),
      ).title,
    ).toBe("Your driver can’t take this change");
    expect(refusalFor(new ApiError(422, "insufficient_funds", "x")).title).toBe(
      "Your payment can’t cover this change",
    );
    expect(
      refusalFor(new ApiError(500, "internal_error", "the server said so")),
    ).toEqual({
      title: "That didn’t go through",
      body: "the server said so",
    });
    expect(refusalFor(new TypeError("Network request failed")).title).toBe(
      "You’re offline",
    );
  });
});

describe("formatting (time and distance only)", () => {
  it("formats distance, duration and signed deltas", () => {
    expect(km(18_400)).toBe("18.4 km");
    expect(minutes(3_120)).toBe("52 min");
    expect(minutes(4_500)).toBe("1 h 15 min");
    expect(minutes(20)).toBe("1 min");
    expect(signedKm(3_100)).toBe("+3.1 km");
    expect(signedKm(-1_200)).toBe("−1.2 km");
    expect(signedKm(0)).toBe("no extra distance");
    expect(signedMinutes(360)).toBe("+6 min");
    expect(signedMinutes(0)).toBe("no extra time");
    expect(clock(75)).toBe("1:15");
    expect(clock(3_725)).toBe("1:02:05");
  });

  it("relative labels count down and disappear once passed", () => {
    const now = Date.parse("2026-09-23T10:00:00Z");
    expect(inLabel("2026-09-23T10:45:00Z", now)).toBe("in 45 min");
    expect(inLabel("2026-09-23T12:05:00Z", now)).toBe("in 2 h 5 min");
    expect(inLabel("2026-09-23T09:59:00Z", now)).toBeNull();
  });

  it("local dates are ISO YYYY-MM-DD in the pickup timezone", () => {
    expect(localDateIn(0, "Africa/Lagos")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(localDateIn(1)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // An unknown zone falls back to the device date instead of throwing.
    expect(localDateIn(0, "Not/AZone")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
