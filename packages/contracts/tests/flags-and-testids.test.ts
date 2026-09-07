import { describe, expect, it } from "vitest";

import { DENY_ALL, FLAG_KEYS, isEnabled } from "../src/flags";
import {
  ERROR_CODES,
  ContractError,
  featureDisabled,
  statusForErrorCode,
} from "../src/errors";
import { TEST_IDS, allTestIds, isValidTestId } from "../src/test-ids";
import { IdempotencyKeySchema, scopedIdempotencyKey } from "../src/idempotency";

describe("feature flags", () => {
  it("denies by default when the flag service is unreachable", () => {
    expect(isEnabled(undefined, "bites")).toBe(false);
    for (const key of FLAG_KEYS) {
      expect(isEnabled(DENY_ALL, key)).toBe(false);
    }
  });

  it("treats a missing key as off rather than truthy", () => {
    expect(isEnabled({ move: true }, "send")).toBe(false);
    expect(isEnabled({ move: true }, "move")).toBe(true);
  });

  it("does not accept a non-boolean as enabled", () => {
    expect(isEnabled({ bites: undefined }, "bites")).toBe(false);
  });
});

describe("error codes", () => {
  it("maps every code to an HTTP status", () => {
    for (const code of ERROR_CODES) {
      expect(typeof statusForErrorCode(code)).toBe("number");
    }
  });

  it("hides a disabled feature behind a 404 rather than a 403", () => {
    const error = featureDisabled("bites");
    expect(error.status).toBe(404);
    expect(error.toBody()).toEqual({
      code: "feature_disabled",
      message: "bites is not available here",
      details: { feature: "bites" },
    });
  });

  it("carries structured details for client branching", () => {
    const error = new ContractError("wrong_pin", "That PIN is not right", {
      attemptsLeft: 2,
    });
    expect(error.status).toBe(422);
    expect(error.toBody().details).toEqual({ attemptsLeft: 2 });
  });
});

describe("testIDs", () => {
  it("follows <app>.<screen>.<element> camelCase for every declared id", () => {
    expect(allTestIds().filter((id) => !isValidTestId(id))).toEqual([]);
  });

  it("is unique", () => {
    const ids = allTestIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes every id the handoff names explicitly", () => {
    const ids = new Set(allTestIds());
    for (const required of [
      "rider.home.whereTo",
      "rider.quote.confirm",
      "rider.match.cancel",
      "rider.pin.display",
      "rider.trip.shareTrip",
      "rider.trip.safetyHub",
      "rider.pay.cashConfirm",
      "rider.rate.submit",
      "driver.home.goOnline",
      "driver.offer.accept",
      "driver.offer.decline",
      "driver.pickup.arrived",
      "driver.pin.input",
      "driver.trip.complete",
      "driver.cash.received",
      "driver.earnings.cashout",
      "common.sos.hold",
      "wallet.send.confirmPin",
      "wallet.request.pay",
      "bites.cart.checkout",
      "bites.issue.submit",
      "send.create.confirm",
      "send.recipient.deliveryCode",
      "flights.search.results",
      "flights.pay.confirm",
      "flights.switch.confirm",
      "journey.itinerary.view",
      "stays.pay.confirm",
      "stays.checkin.complete",
      "fleet.assign.send",
      "driver.fleet.signPin",
      "desk.scan.qr",
      "ops.case.remedy",
    ]) {
      expect(ids.has(required), `missing testID ${required}`).toBe(true);
    }
  });

  it("exposes ids as literal constants", () => {
    expect(TEST_IDS.rider.pin.display).toBe("rider.pin.display");
  });
});

describe("idempotency keys", () => {
  it("rejects keys that are too short, too long or not url-safe", () => {
    expect(IdempotencyKeySchema.safeParse("short").success).toBe(false);
    expect(IdempotencyKeySchema.safeParse("a".repeat(65)).success).toBe(false);
    expect(IdempotencyKeySchema.safeParse("has space").success).toBe(false);
    expect(
      IdempotencyKeySchema.safeParse("ride-2026-09-05-abc123").success,
    ).toBe(true);
  });

  it("scopes a client key to the actor and operation", () => {
    expect(scopedIdempotencyKey("ride.create", "usr_1", "abc")).toBe(
      "ride.create:usr_1:abc",
    );
    expect(scopedIdempotencyKey("ride.create", "usr_1", "abc")).not.toBe(
      scopedIdempotencyKey("ride.create", "usr_2", "abc"),
    );
  });
});
