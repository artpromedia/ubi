/**
 * Proposals, the role matrix, shift overlap (application check AND the
 * database's EXCLUDE constraint), the city cap and PIN signing through a
 * faithful double of user-service's documented /auth/pin/verify contract.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  OWNER_TERMS,
  addStaff,
  addVehicle,
  api,
  closeTestDb,
  idemKey,
  resetFleet,
  seedFleet,
  seedUser,
  signedArrangement,
  startHarness,
  tokenFor,
  type FleetWorld,
  type Harness,
} from "./helpers";
import { expireProposals } from "../src/ops/assignments";
import { ProposalViewSchema, SignOfferViewSchema } from "../src/contract";

let h: Harness;
let world: FleetWorld;

beforeAll(async () => {
  h = await startHarness();
  await resetFleet(h.db);
});

afterAll(async () => {
  await h.close();
  await closeTestDb();
});

beforeEach(() => {
  h.clock.now = new Date("2026-09-28T08:00:00.000Z");
  h.pin.reset();
  h.ride.reset();
});

async function propose(
  token: string,
  body: Record<string, unknown>,
  key = idemKey("prop"),
) {
  return api<Record<string, unknown>>(h.app, {
    method: "POST",
    path: `/v1/fleets/${world.fleetId}/assignments/propose`,
    token,
    city: world.cityId,
    body,
    idem: key,
  });
}

describe("proposals and the role matrix", () => {
  beforeEach(async () => {
    world = await seedFleet(h);
  });

  it("lets an owner propose terms: sent to the driver, expires in 48 h, nothing signed", async () => {
    const vehicleId = await addVehicle(h, world);
    const driverId = await seedUser(h.db, { driver: true });
    const result = await propose(world.ownerToken, {
      vehicleId,
      driverId,
      shift: "day",
      validFrom: "2026-10-01",
      terms: OWNER_TERMS,
    });
    expect(result.status).toBe(201);
    const view = ProposalViewSchema.parse(result.body);
    expect(view.status).toBe("pending_signature");
    expect(view.shift).toEqual({ kind: "day", start: "06:00", end: "18:00" });
    expect(view.terms.currency).toBe("NGN");
    expect(view.expiresAt).toBe("2026-09-30T08:00:00.000Z");
    expect(view.termsVersion).toBe(1);
    expect(await h.db.fleetAssignment.count({ where: { driverId } })).toBe(0);
    const events = await h.db.outboxEvent.findMany({
      where: { aggregateId: view.proposalId },
    });
    expect(events.map((event) => event.name)).toContain(
      "assignment.proposal.status.changed",
    );
    const audit = await h.db.auditLog.findMany({
      where: { subjectId: view.proposalId },
    });
    expect(audit.map((row) => row.action)).toContain(
      "fleet.assignment_proposal.sent",
    );
  });

  it("accepts a custom shift {start, end} and refuses start == end", async () => {
    const vehicleId = await addVehicle(h, world);
    const driverId = await seedUser(h.db, { driver: true });
    const ok = await propose(world.ownerToken, {
      vehicleId,
      driverId,
      shift: { start: "20:00", end: "04:00" },
      validFrom: "2026-10-01",
      terms: OWNER_TERMS,
    });
    expect(ok.status).toBe(201);
    expect((ok.body as { shift: unknown }).shift).toEqual({
      kind: "custom",
      start: "20:00",
      end: "04:00",
    });
    const bad = await propose(world.ownerToken, {
      vehicleId,
      driverId,
      shift: { start: "09:00", end: "09:00" },
      validFrom: "2026-10-01",
      terms: OWNER_TERMS,
    });
    expect(bad.status).toBe(422);
  });

  it("refuses a weekly remittance above the city cap (422 above_city_cap)", async () => {
    const vehicleId = await addVehicle(h, world);
    const driverId = await seedUser(h.db, { driver: true });
    const result = await propose(world.ownerToken, {
      vehicleId,
      driverId,
      shift: "full",
      validFrom: "2026-10-01",
      terms: { ...OWNER_TERMS, amountMinor: 15_000_001 },
    });
    expect(result.status).toBe(422);
    expect(result.body.code).toBe("above_city_cap");
    expect((result.body.details as { cityCap: unknown }).cityCap).toEqual({
      amountMinor: 15_000_000,
      currency: "NGN",
    });
  });

  it("keeps new remittance terms owner-only, and lets a manager propose under the signed terms", async () => {
    const manager = await addStaff(h, world, "manager");
    const vehicleA = await addVehicle(h, world);
    const vehicleB = await addVehicle(h, world);
    const driverId = await seedUser(h.db, { driver: true });

    // No signed terms yet: a manager cannot open with terms, nor without.
    const withTerms = await propose(manager.token, {
      vehicleId: vehicleA,
      driverId,
      shift: "day",
      validFrom: "2026-10-01",
      terms: OWNER_TERMS,
    });
    expect(withTerms.status).toBe(403);
    expect(withTerms.body.code).toBe("terms_owner_only");
    const noTerms = await propose(manager.token, {
      vehicleId: vehicleA,
      driverId,
      shift: "day",
      validFrom: "2026-10-01",
    });
    expect(noTerms.status).toBe(403);
    expect(noTerms.body.code).toBe("terms_owner_only");

    await signedArrangement(h, world, {
      vehicleId: vehicleA,
      driverId,
      shift: "day",
      validFrom: "2026-10-01",
    });

    // Now the manager moves the driver to vehicle B, night shift, under v1.
    const moved = await propose(manager.token, {
      vehicleId: vehicleB,
      driverId,
      shift: "night",
      validFrom: "2026-10-05",
    });
    expect(moved.status).toBe(201);
    const view = ProposalViewSchema.parse(moved.body);
    expect(view.termsVersion).toBe(1);
    expect(view.terms.amountMinor).toBe(OWNER_TERMS.amountMinor);
    expect(view.proposedByRole).toBe("manager");
    expect(view.diff.map((entry) => entry.field)).toEqual(
      expect.arrayContaining(["vehicle", "shift"]),
    );
    expect(
      view.diff.find((entry) => entry.field === "remittance"),
    ).toBeUndefined();
  });

  it("gives read-only staff the calendar but no writes", async () => {
    const readOnly = await addStaff(h, world, "read_only");
    const vehicleId = await addVehicle(h, world);
    const calendar = await api(h.app, {
      path: `/v1/fleets/${world.fleetId}/calendar`,
      token: readOnly.token,
      city: world.cityId,
    });
    expect(calendar.status).toBe(200);
    const driverId = await seedUser(h.db, { driver: true });
    const refused = await propose(readOnly.token, {
      vehicleId,
      driverId,
      shift: "day",
      validFrom: "2026-10-01",
      terms: OWNER_TERMS,
    });
    expect(refused.status).toBe(403);
    expect(
      (refused.body.details as { allowedRoles: string[] }).allowedRoles,
    ).toEqual(["owner", "manager"]);
    const staff = await api(h.app, {
      method: "PUT",
      path: `/v1/fleets/${world.fleetId}/staff`,
      token: readOnly.token,
      city: world.cityId,
      body: { staff: [{ userId: readOnly.userId, role: "owner" }] },
    });
    expect(staff.status).toBe(403);
  });

  it("only an owner manages staff, and a fleet always keeps an owner", async () => {
    const manager = await addStaff(h, world, "manager");
    const byManager = await api(h.app, {
      method: "PUT",
      path: `/v1/fleets/${world.fleetId}/staff`,
      token: manager.token,
      city: world.cityId,
      body: { staff: [{ userId: manager.userId, role: "owner" }] },
    });
    expect(byManager.status).toBe(403);
    const noOwner = await api(h.app, {
      method: "PUT",
      path: `/v1/fleets/${world.fleetId}/staff`,
      token: world.ownerToken,
      city: world.cityId,
      body: { staff: [{ userId: world.ownerId, role: "manager" }] },
    });
    expect(noOwner.status).toBe(422);
  });

  it("answers an Idempotency-Key replay with the same proposal and refuses the key with another body", async () => {
    const vehicleId = await addVehicle(h, world);
    const driverId = await seedUser(h.db, { driver: true });
    const key = idemKey("replay");
    const body = {
      vehicleId,
      driverId,
      shift: "day",
      validFrom: "2026-10-01",
      terms: OWNER_TERMS,
    };
    const first = await propose(world.ownerToken, body, key);
    const again = await propose(world.ownerToken, body, key);
    expect(again.status).toBe(201);
    expect(again.body.proposalId).toBe(first.body.proposalId);
    expect(
      await h.db.fleetAssignmentProposal.count({ where: { driverId } }),
    ).toBe(1);
    const other = await propose(
      world.ownerToken,
      { ...body, shift: "night" },
      key,
    );
    expect(other.status).toBe(409);
    expect(other.body.code).toBe("idempotency_key_reuse");
    const missing = await api(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/assignments/propose`,
      token: world.ownerToken,
      city: world.cityId,
      body,
      idem: null,
    });
    expect(missing.status).toBe(422);
  });
});

describe("shift overlap", () => {
  beforeEach(async () => {
    world = await seedFleet(h);
  });

  it("refuses two drivers on one vehicle in overlapping signed shifts (422 shift_overlap, naming the signed shift)", async () => {
    const vehicleId = await addVehicle(h, world);
    const first = await seedUser(h.db, {
      driver: true,
      firstName: "Bola",
      lastName: "Adeyemi",
    });
    const second = await seedUser(h.db, { driver: true });
    await signedArrangement(h, world, {
      vehicleId,
      driverId: first,
      shift: "day",
      validFrom: "2026-10-01",
    });
    const overlapping = await propose(world.ownerToken, {
      vehicleId,
      driverId: second,
      shift: { start: "17:00", end: "23:00" },
      validFrom: "2026-10-03",
      terms: OWNER_TERMS,
    });
    expect(overlapping.status).toBe(422);
    expect(overlapping.body.code).toBe("shift_overlap");
    const overlap = (
      overlapping.body.details as { overlaps: Record<string, unknown>[] }
    ).overlaps[0];
    expect(overlap?.reason).toBe("vehicle_shift_taken");
    expect(overlap?.driverDisplayName).toBe("Bola A.");
    expect(overlap?.shift).toEqual({
      kind: "day",
      start: "06:00",
      end: "18:00",
    });

    // The complementary night shift shares the vehicle without overlap.
    const night = await propose(world.ownerToken, {
      vehicleId,
      driverId: second,
      shift: "night",
      validFrom: "2026-10-03",
      terms: OWNER_TERMS,
    });
    expect(night.status).toBe(201);
  });

  it("catches a night shift's after-midnight part on the next day", async () => {
    const vehicleId = await addVehicle(h, world);
    const first = await seedUser(h.db, { driver: true });
    const second = await seedUser(h.db, { driver: true });
    await signedArrangement(h, world, {
      vehicleId,
      driverId: first,
      shift: "night",
      validFrom: "2026-10-01",
      validTo: "2026-10-02",
    });
    // Night of Oct 1 runs to 06:00 on Oct 2: an early shift on Oct 2 overlaps.
    const early = await propose(world.ownerToken, {
      vehicleId,
      driverId: second,
      shift: { start: "05:00", end: "09:00" },
      validFrom: "2026-10-02",
      validTo: "2026-10-03",
      terms: OWNER_TERMS,
    });
    expect(early.status).toBe(422);
    // …but not on Oct 3, when no night instance reaches.
    const later = await propose(world.ownerToken, {
      vehicleId,
      driverId: second,
      shift: { start: "05:00", end: "09:00" },
      validFrom: "2026-10-03",
      terms: OWNER_TERMS,
    });
    expect(later.status).toBe(201);
  });

  it("is enforced by the database even when the application check is bypassed", async () => {
    const vehicleId = await addVehicle(h, world);
    const first = await seedUser(h.db, { driver: true });
    const second = await seedUser(h.db, { driver: true });
    const { assignmentId } = await signedArrangement(h, world, {
      vehicleId,
      driverId: first,
      shift: "full",
      validFrom: "2026-10-01",
    });
    await expect(
      h.db.fleetAssignmentShiftSegment.create({
        data: {
          id: `${assignmentId}_forged`,
          assignmentId,
          vehicleId,
          driverId: second,
          daysFrom: new Date("2026-10-05T00:00:00Z"),
          daysTo: null,
          minuteFrom: 600,
          minuteTo: 700,
        },
      }),
    ).rejects.toThrow(
      /fleet_shift_segments_vehicle_no_overlap|23P01|exclusion/,
    );
  });

  it("settles two concurrent signatures for one slot: exactly one signs", async () => {
    const vehicleId = await addVehicle(h, world);
    const a = await seedUser(h.db, { driver: true });
    const b = await seedUser(h.db, { driver: true });
    const pa = await propose(world.ownerToken, {
      vehicleId,
      driverId: a,
      shift: "day",
      validFrom: "2026-10-01",
      terms: OWNER_TERMS,
    });
    const pb = await propose(world.ownerToken, {
      vehicleId,
      driverId: b,
      shift: "night",
      validFrom: "2026-10-01",
      terms: OWNER_TERMS,
    });
    // Make B's proposal overlap A's after both were checked.
    await h.db.fleetAssignmentProposal.update({
      where: { id: String(pb.body.proposalId) },
      data: { shiftKind: "custom", shiftStart: "10:00", shiftEnd: "14:00" },
    });
    h.pin.setPin(a, "1111");
    h.pin.setPin(b, "2222");
    const [ra, rb] = await Promise.all([
      api(h.app, {
        method: "POST",
        path: `/v1/fleet-offers/${String(pa.body.proposalId)}/sign`,
        token: await tokenFor(a, world.cityId, { kind: "driver" }),
        city: world.cityId,
        body: { pin: "1111" },
      }),
      api(h.app, {
        method: "POST",
        path: `/v1/fleet-offers/${String(pb.body.proposalId)}/sign`,
        token: await tokenFor(b, world.cityId, { kind: "driver" }),
        city: world.cityId,
        body: { pin: "2222" },
      }),
    ]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toEqual([200, 422]);
    expect(await h.db.fleetAssignment.count({ where: { vehicleId } })).toBe(1);
  });
});

describe("signing with the wallet PIN (user-service /auth/pin/verify)", () => {
  let vehicleId: string;
  let driverId: string;
  let offerId: string;
  let driverToken: string;

  beforeEach(async () => {
    world = await seedFleet(h);
    vehicleId = await addVehicle(h, world);
    driverId = await seedUser(h.db, { driver: true });
    const proposal = await propose(world.ownerToken, {
      vehicleId,
      driverId,
      shift: "day",
      validFrom: "2026-10-01",
      terms: OWNER_TERMS,
    });
    offerId = String(proposal.body.proposalId);
    driverToken = await tokenFor(driverId, world.cityId, { kind: "driver" });
    h.pin.setPin(driverId, "4821");
  });

  async function sign(pin: string, key = idemKey("sign")) {
    return api(h.app, {
      method: "POST",
      path: `/v1/fleet-offers/${offerId}/sign`,
      token: driverToken,
      city: world.cityId,
      body: { pin },
      idem: key,
    });
  }

  it("lists the offer to the driver with the terms, the diff and UBI's check — never invented earnings", async () => {
    const offers = await api<{ offers: Record<string, unknown>[] }>(h.app, {
      path: "/v1/drivers/me/fleet-offers",
      token: driverToken,
      city: world.cityId,
    });
    expect(offers.status).toBe(200);
    expect(offers.body.offers).toHaveLength(1);
    const offer = offers.body.offers[0] as Record<string, unknown>;
    expect(offer.offerId).toBe(offerId);
    expect(offer.historicEarnings).toBeNull();
    expect(offer.check).toEqual({
      clashesWithBookings: false,
      clashesWithTimeOff: false,
    });
  });

  it("signs with the right PIN: relays the driver's OWN context, records evidence, never the PIN", async () => {
    const result = await sign("4821");
    expect(result.status).toBe(200);
    const view = SignOfferViewSchema.parse(result.body);
    expect(view.signature.verification).toMatchObject({
      method: "wallet_pin",
      verifiedBy: "user-service",
    });
    expect(view.signature.termsVersion).toBe(1);
    expect(view.arrangement.status).toBe("active");
    expect(h.pin.relayedContexts).toEqual([driverToken]);

    const assignment = await h.db.fleetAssignment.findUniqueOrThrow({
      where: { id: view.arrangement.assignmentId },
    });
    expect(assignment.pinVerificationRef).toMatch(
      /^user-service:\/auth\/pin\/verify:req_/,
    );
    const segments = await h.db.fleetAssignmentShiftSegment.findMany({
      where: { assignmentId: assignment.id },
    });
    expect(segments).toHaveLength(1);
    // The PIN appears nowhere fleet-service writes.
    const audit = await h.db.auditLog.findMany({
      where: { subjectId: assignment.id },
    });
    const idem = await h.db.fleetIdempotencyRecord.findMany({
      where: { operation: `fleet.offer.sign:${offerId}` },
    });
    const events = await h.db.outboxEvent.findMany({
      where: { aggregateId: { in: [offerId, assignment.id] } },
    });
    const written = JSON.stringify(
      [audit, idem, events, assignment],
      (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
    );
    expect(written).not.toContain("4821");
    expect(audit[0]?.action).toBe("assignment.signed");
  });

  it("passes a wrong PIN through as wrong_pin with the attempts left, and signs nothing", async () => {
    const result = await sign("0000");
    expect(result.status).toBe(422);
    expect(result.body.code).toBe("wrong_pin");
    expect(
      (result.body.details as { attemptsRemaining: number }).attemptsRemaining,
    ).toBe(4);
    expect(await h.db.fleetAssignment.count({ where: { driverId } })).toBe(0);
    const proposal = await h.db.fleetAssignmentProposal.findUniqueOrThrow({
      where: { id: offerId },
    });
    expect(proposal.status).toBe("pending_signature");
  });

  it("honours user-service's lockout: after the last wrong try even the right PIN is refused", async () => {
    for (let attempt = 1; attempt < h.pin.maxAttempts; attempt += 1) {
      expect((await sign("0000")).body.code).toBe("wrong_pin");
    }
    const locking = await sign("0000");
    expect(locking.status).toBe(403);
    expect(locking.body.code).toBe("pin_locked");
    const right = await sign("4821");
    expect(right.status).toBe(403);
    expect(right.body.code).toBe("pin_locked");
    expect(await h.db.fleetAssignment.count({ where: { driverId } })).toBe(0);
  });

  it("never accepts a client-asserted verification", async () => {
    const asserted = await api(h.app, {
      method: "POST",
      path: `/v1/fleet-offers/${offerId}/sign`,
      token: driverToken,
      city: world.cityId,
      body: { pin: "4821", verified: true },
    });
    expect(asserted.status).toBe(422);
    const noPin = await api(h.app, {
      method: "POST",
      path: `/v1/fleet-offers/${offerId}/sign`,
      token: driverToken,
      city: world.cityId,
      body: {},
    });
    expect(noPin.status).toBe(422);
    expect(h.pin.relayedContexts).toHaveLength(0);
  });

  it("refuses to sign someone else's offer (not found, no PIN attempt spent)", async () => {
    const stranger = await seedUser(h.db, { driver: true });
    h.pin.setPin(stranger, "4821");
    const result = await api(h.app, {
      method: "POST",
      path: `/v1/fleet-offers/${offerId}/sign`,
      token: await tokenFor(stranger, world.cityId, { kind: "driver" }),
      city: world.cityId,
      body: { pin: "4821" },
    });
    expect(result.status).toBe(404);
    expect(h.pin.relayedContexts).toHaveLength(0);
  });

  it("replays a signature with the same key without a second PIN check", async () => {
    const key = idemKey("sign-replay");
    const first = await sign("4821", key);
    const again = await sign("4821", key);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(h.pin.relayedContexts).toHaveLength(1);
  });

  it("declines with no reason and no penalty; the fleet sees only `declined`", async () => {
    const declined = await api(h.app, {
      method: "POST",
      path: `/v1/fleet-offers/${offerId}/decline`,
      token: driverToken,
      city: world.cityId,
      body: { reason: "the fleet should never see this" },
    });
    expect(declined.status).toBe(200);
    expect(declined.body).toEqual({ offerId, status: "declined" });
    const fleetView = await api<{ proposals: Record<string, unknown>[] }>(
      h.app,
      {
        path: `/v1/fleets/${world.fleetId}/assignments`,
        token: world.ownerToken,
        city: world.cityId,
      },
    );
    const proposal = fleetView.body.proposals.find(
      (row) => row.proposalId === offerId,
    );
    expect(proposal?.status).toBe("declined");
    expect(JSON.stringify(fleetView.body)).not.toContain("should never see");
    expect(
      JSON.stringify(
        await h.db.auditLog.findMany({ where: { subjectId: offerId } }),
      ),
    ).not.toContain("should never see");
  });

  it("expires an unsigned offer after 48 h; it can no longer be signed", async () => {
    h.clock.now = new Date("2026-09-30T08:00:01.000Z");
    expect(await expireProposals(h.deps)).toBeGreaterThanOrEqual(1);
    const result = await sign("4821");
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("offer_expired");
    expect(h.pin.relayedContexts).toHaveLength(0);
    const events = await h.db.outboxEvent.findMany({
      where: { aggregateId: offerId },
    });
    expect(
      events.some(
        (event) => (event.payload as { to?: string }).to === "expired",
      ),
    ).toBe(true);
  });

  it("supersedes the driver's own arrangement in this fleet on a material change", async () => {
    const first = await sign("4821");
    const firstId = (first.body as { arrangement: { assignmentId: string } })
      .arrangement.assignmentId;
    const second = await propose(world.ownerToken, {
      vehicleId,
      driverId,
      shift: "full",
      validFrom: "2026-10-10",
      terms: { ...OWNER_TERMS, amountMinor: 3_000_000 },
    });
    expect(second.status).toBe(201);
    expect(ProposalViewSchema.parse(second.body).termsVersion).toBe(2);
    offerId = String(second.body.proposalId);
    const signed = await sign("4821");
    expect(signed.status).toBe(200);
    const old = await h.db.fleetAssignment.findUniqueOrThrow({
      where: { id: firstId },
    });
    expect(old.status).toBe("superseded");
    expect(old.validTo?.toISOString().slice(0, 10)).toBe("2026-10-10");
  });

  it("never takes effect before the signature: an offer signed after its start date starts on the signing day", async () => {
    const first = await sign("4821");
    const firstId = (first.body as { arrangement: { assignmentId: string } })
      .arrangement.assignmentId;
    // New terms proposed to start today (Mon 5 Oct), signed on Wed 7 Oct.
    h.clock.now = new Date("2026-10-05T08:00:00.000Z");
    const second = await propose(world.ownerToken, {
      vehicleId,
      driverId,
      shift: "day",
      validFrom: "2026-10-05",
      terms: { ...OWNER_TERMS, amountMinor: 3_000_000 },
    });
    expect(second.status).toBe(201);
    offerId = String(second.body.proposalId);
    h.clock.now = new Date("2026-10-07T07:00:00.000Z");
    const signed = await sign("4821");
    expect(signed.status).toBe(200);
    const view = SignOfferViewSchema.parse(signed.body);
    expect(view.arrangement.validFrom).toBe("2026-10-07");
    // The old terms stay in force until the signature: nothing retroactive.
    const old = await h.db.fleetAssignment.findUniqueOrThrow({
      where: { id: firstId },
    });
    expect(old.validTo?.toISOString().slice(0, 10)).toBe("2026-10-07");
    // Contract B settles Mon-Tue under the first terms, Wed onward under the new.
    const inputs = await api<{
      items: {
        assignmentId: string;
        termsVersion: number;
        shiftHoursInWeek: number;
      }[];
    }>(h.app, {
      path: `/internal/fleet/settlement-inputs?weekStart=2026-10-05&cityId=${world.cityId}`,
      headers: { "x-service-key": process.env.FLEET_PAYMENT_SERVICE_KEY ?? "" },
    });
    expect(inputs.status).toBe(200);
    const hoursOf = (id: string) =>
      inputs.body.items.find((item) => item.assignmentId === id)
        ?.shiftHoursInWeek;
    expect(hoursOf(firstId)).toBe(24);
    expect(hoursOf(view.arrangement.assignmentId)).toBe(60);
  });

  it("refuses to sign an offer whose whole validity has passed", async () => {
    const short = await propose(world.ownerToken, {
      vehicleId,
      driverId,
      shift: "day",
      validFrom: "2026-09-28",
      validTo: "2026-09-29",
      terms: OWNER_TERMS,
    });
    expect(short.status).toBe(201);
    offerId = String(short.body.proposalId);
    h.clock.now = new Date("2026-09-29T09:00:00.000Z");
    const result = await sign("4821");
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("offer_expired");
    // Refused before the PIN: no attempt was spent.
    expect(h.pin.relayedContexts).toEqual([]);
  });
});

describe("termination (2-week notice)", () => {
  beforeEach(async () => {
    world = await seedFleet(h);
  });

  it("is owner-only on the fleet side and opens conflicts for bookings past the notice end", async () => {
    const manager = await addStaff(h, world, "manager");
    const vehicleId = await addVehicle(h, world);
    const driverId = await seedUser(h.db, { driver: true });
    const { assignmentId } = await signedArrangement(h, world, {
      vehicleId,
      driverId,
      shift: "full",
      validFrom: "2026-09-28",
    });
    h.ride.addBooking({
      driverId,
      vehicleId,
      startsAt: "2026-10-20T07:00:00.000Z",
      endsAt: "2026-10-20T09:00:00.000Z",
    });
    const refused = await api(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/assignments/${assignmentId}/terminate`,
      token: manager.token,
      city: world.cityId,
    });
    expect(refused.status).toBe(403);
    const notice = await api<{
      noticeEndsOn: string;
      bookingsAfterNotice: unknown[];
      conflictIds: string[];
    }>(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/assignments/${assignmentId}/terminate`,
      token: world.ownerToken,
      city: world.cityId,
    });
    expect(notice.status).toBe(200);
    expect(notice.body.noticeEndsOn).toBe("2026-10-12");
    expect(notice.body.bookingsAfterNotice).toHaveLength(1);
    expect(notice.body.conflictIds).toHaveLength(1);
  });
});
