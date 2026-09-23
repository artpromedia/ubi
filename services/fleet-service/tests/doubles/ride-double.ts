/**
 * A faithful double of ride-service's side of INTERNAL CONTRACT A (routes
 * 1-7), written from the contract text (tests/fixtures/contract-a.json) — not
 * from fleet-service's client. It is a real HTTP server on a socket, so the
 * REAL port (src/ports/ride-port.ts) is exercised end to end: headers,
 * status codes, bodies.
 *
 * What it enforces, as the contract states:
 *  - `X-Service-Key` = FLEET_RIDE_SERVICE_KEY on every route, compared in
 *    constant time; unset → 503, wrong/missing → 401;
 *  - Idempotency-Key on routes 2, 3, 4 and 7: the same key and body answers
 *    the same; the same key with another body is 409 `idempotency_conflict`;
 *  - route 2 is refused (409 `occupancy_conflict` + affected blocks) when the
 *    window overlaps a booking or another held block on the vehicle — the
 *    vehicle exclusion constraint;
 *  - route 4 is NOT refused by bookings: overlapping bookings on the vehicle
 *    move to `at_risk` with a decision deadline;
 *  - route 5 answers ONLY the eight OccupiedBlock fields (unless a test sets
 *    `leakExtraFields` to prove fleet-service drops what the contract forbids).
 */
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";

export interface DoubleBooking {
  blockId: string;
  bookingId: string;
  driverId: string;
  vehicleId: string | null;
  /** The occupied interval, buffers included. */
  startsAt: string;
  endsAt: string;
  /** The pickup window (inside the occupied interval). */
  windowStart: string;
  windowEnd: string;
  kind: "booked" | "on_trip";
  risk: "ok" | "at_risk";
  decisionDeadline: string | null;
  state: string;
  commissionMinor: { amountMinor: number; currency: string };
}

interface Occupancy {
  occupancyId: string;
  blockId: string;
  vehicleId: string;
  kind: string;
  startsAt: number;
  endsAt: number;
  released: boolean;
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface RideDouble {
  readonly url: string;
  readonly bookings: DoubleBooking[];
  readonly occupancies: Occupancy[];
  readonly requests: RecordedRequest[];
  /** Adds rider/location/fare fields to every route-5 block (privacy test). */
  leakExtraFields: boolean;
  /** Route 7 answers 422 swap_ineligible with these reasons when set. */
  swapIneligible: string[] | null;
  /** Every route answers 503 (outage test). */
  down: boolean;
  addBooking(
    input: Partial<DoubleBooking> &
      Pick<DoubleBooking, "driverId" | "startsAt" | "endsAt">,
  ): DoubleBooking;
  reset(): void;
  close(): Promise<void>;
}

const RESOLUTION_LEAD_MS = 30 * 60_000;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.length === 0) {
    return null;
  }
  return JSON.parse(text) as unknown;
}

function overlaps(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start < b.end && b.start < a.end;
}

function projection(booking: DoubleBooking) {
  return {
    blockId: booking.blockId,
    driverId: booking.driverId,
    vehicleId: booking.vehicleId,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    kind: booking.kind,
    risk: booking.risk,
    decisionDeadline: booking.decisionDeadline,
  };
}

export async function startRideDouble(): Promise<RideDouble> {
  const bookings: DoubleBooking[] = [];
  const occupancies: Occupancy[] = [];
  const requests: RecordedRequest[] = [];
  const idempotency = new Map<
    string,
    { bodyHash: string; status: number; body: unknown }
  >();
  let counter = 0;

  const state = {
    leakExtraFields: false,
    swapIneligible: null as string[] | null,
    down: false,
  };

  function bookingInterval(booking: DoubleBooking) {
    return {
      start: new Date(booking.startsAt).getTime(),
      end: new Date(booking.endsAt).getTime(),
    };
  }

  function liveBookingsOn(vehicleId: string) {
    return bookings.filter(
      (booking) =>
        booking.vehicleId === vehicleId &&
        [
          "held",
          "payment_pending",
          "confirmed",
          "reconfirmed",
          "activated",
        ].includes(booking.state),
    );
  }

  function heldOn(vehicleId: string, except?: string) {
    return occupancies.filter(
      (o) => o.vehicleId === vehicleId && !o.released && o.blockId !== except,
    );
  }

  function nextFeasible(vehicleId: string, start: number, end: number) {
    const length = end - start;
    let candidate = start;
    for (let guard = 0; guard < 200; guard += 1) {
      const window = { start: candidate, end: candidate + length };
      const blocking = [
        ...liveBookingsOn(vehicleId).map(bookingInterval),
        ...heldOn(vehicleId).map((o) => ({ start: o.startsAt, end: o.endsAt })),
      ].filter((interval) => overlaps(interval, window));
      if (blocking.length === 0) {
        return {
          startsAt: new Date(window.start).toISOString(),
          endsAt: new Date(window.end).toISOString(),
        };
      }
      candidate = Math.max(...blocking.map((interval) => interval.end));
    }
    return null;
  }

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://ride.double");
      const body = await readBody(req);
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers[name] = value;
      }
      requests.push({
        method: req.method ?? "GET",
        path: url.pathname + url.search,
        headers,
        body,
      });
      const send = (status: number, payload: unknown): void => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (state.down) {
        send(503, { code: "service_unavailable", message: "down" });
        return;
      }
      const configured = process.env.FLEET_RIDE_SERVICE_KEY;
      if (configured === undefined || configured.length < 32) {
        send(503, { code: "service_unavailable", message: "not configured" });
        return;
      }
      const presented = headers["x-service-key"];
      if (
        presented === undefined ||
        !timingSafeEqual(digest(presented), digest(configured))
      ) {
        send(401, {
          code: "unauthorized",
          message: "service authentication required",
        });
        return;
      }

      const idempotent = (
        compute: () => { status: number; body: unknown },
      ): void => {
        const key = headers["idempotency-key"];
        if (key === undefined || key.length === 0) {
          send(422, {
            code: "validation_failed",
            message: "Idempotency-Key required",
          });
          return;
        }
        const scoped = `${url.pathname}:${key}`;
        const bodyHash = createHash("sha256")
          .update(JSON.stringify(body))
          .digest("hex");
        const seen = idempotency.get(scoped);
        if (seen !== undefined) {
          if (seen.bodyHash !== bodyHash) {
            send(409, {
              code: "idempotency_conflict",
              message: "key reused with another body",
            });
            return;
          }
          send(seen.status, seen.body);
          return;
        }
        const answer = compute();
        idempotency.set(scoped, { bodyHash, ...answer });
        send(answer.status, answer.body);
      };

      const path = url.pathname;
      const input = (body ?? {}) as Record<string, string | null>;

      // 1. maintenance:preview
      if (
        req.method === "POST" &&
        path === "/internal/fleet/occupancy/maintenance:preview"
      ) {
        const window = {
          start: new Date(String(input.startsAt)).getTime(),
          end: new Date(String(input.endsAt)).getTime(),
        };
        const vehicleId = String(input.vehicleId);
        const affected = liveBookingsOn(vehicleId).filter((booking) =>
          overlaps(bookingInterval(booking), window),
        );
        const held = heldOn(vehicleId).filter((o) =>
          overlaps({ start: o.startsAt, end: o.endsAt }, window),
        );
        const feasible = affected.length === 0 && held.length === 0;
        send(200, {
          feasible,
          affectedBlocks: affected.map(projection),
          nextFeasibleWindow: feasible
            ? null
            : nextFeasible(vehicleId, window.start, window.end),
        });
        return;
      }
      // 2. maintenance
      if (
        req.method === "POST" &&
        path === "/internal/fleet/occupancy/maintenance"
      ) {
        idempotent(() => {
          const window = {
            start: new Date(String(input.startsAt)).getTime(),
            end: new Date(String(input.endsAt)).getTime(),
          };
          const vehicleId = String(input.vehicleId);
          const affected = liveBookingsOn(vehicleId).filter((booking) =>
            overlaps(bookingInterval(booking), window),
          );
          const held = heldOn(vehicleId, String(input.blockId)).filter((o) =>
            overlaps({ start: o.startsAt, end: o.endsAt }, window),
          );
          if (affected.length > 0 || held.length > 0) {
            return {
              status: 409,
              body: {
                code: "occupancy_conflict",
                message:
                  "the block overlaps a booking or another block on the vehicle",
                details: { affectedBlocks: affected.map(projection) },
              },
            };
          }
          counter += 1;
          const occupancy: Occupancy = {
            occupancyId: `occ_${counter}`,
            blockId: String(input.blockId),
            vehicleId,
            kind: String(input.kind),
            startsAt: window.start,
            endsAt: window.end,
            released: false,
          };
          occupancies.push(occupancy);
          return { status: 201, body: { occupancyId: occupancy.occupancyId } };
        });
        return;
      }
      // 3. release
      const release =
        /^\/internal\/fleet\/occupancy\/maintenance\/([^/]+)\/release$/.exec(
          path,
        );
      if (req.method === "POST" && release !== null) {
        idempotent(() => {
          for (const occupancy of occupancies) {
            if (occupancy.blockId === decodeURIComponent(release[1] ?? "")) {
              occupancy.released = true;
            }
          }
          return { status: 200, body: { released: true } };
        });
        return;
      }
      // 4. off-road
      if (
        req.method === "POST" &&
        path === "/internal/fleet/occupancy/off-road"
      ) {
        idempotent(() => {
          const start = new Date(String(input.startsAt)).getTime();
          const end =
            input.expectedEndsAt === null || input.expectedEndsAt === undefined
              ? Number.MAX_SAFE_INTEGER
              : new Date(input.expectedEndsAt).getTime();
          const vehicleId = String(input.vehicleId);
          counter += 1;
          occupancies.push({
            occupancyId: `occ_${counter}`,
            blockId: String(input.blockId),
            vehicleId,
            kind: "off_road",
            startsAt: start,
            endsAt: end,
            released: false,
          });
          const atRisk = liveBookingsOn(vehicleId).filter((booking) =>
            overlaps(bookingInterval(booking), { start, end }),
          );
          for (const booking of atRisk) {
            booking.risk = "at_risk";
            booking.decisionDeadline = new Date(
              new Date(booking.windowStart).getTime() - RESOLUTION_LEAD_MS,
            ).toISOString();
          }
          return {
            status: 201,
            body: {
              occupancyId: `occ_${counter}`,
              atRiskBookings: atRisk.map((booking) => ({
                blockId: booking.blockId,
                decisionDeadline: booking.decisionDeadline,
              })),
            },
          };
        });
        return;
      }
      // 5. blocks
      if (req.method === "GET" && path === "/internal/fleet/occupancy/blocks") {
        const vehicleIds = (url.searchParams.get("vehicleIds") ?? "")
          .split(",")
          .filter((id) => id.length > 0);
        const driverIds = (url.searchParams.get("driverIds") ?? "")
          .split(",")
          .filter((id) => id.length > 0);
        const window = {
          start: new Date(url.searchParams.get("from") ?? 0).getTime(),
          end: new Date(url.searchParams.get("to") ?? 0).getTime(),
        };
        const blocks = bookings
          .filter((booking) =>
            [
              "held",
              "payment_pending",
              "confirmed",
              "reconfirmed",
              "activated",
            ].includes(booking.state),
          )
          .filter(
            (booking) =>
              (booking.vehicleId !== null &&
                vehicleIds.includes(booking.vehicleId)) ||
              driverIds.includes(booking.driverId),
          )
          .filter((booking) => overlaps(bookingInterval(booking), window))
          .map((booking) =>
            state.leakExtraFields
              ? {
                  ...projection(booking),
                  riderName: "Leaky Rider",
                  riderPhone: "+2348000000000",
                  pickup: { label: "Lekki Phase 1", lat: 6.44, lng: 3.47 },
                  fareMinor: { amountMinor: 450000, currency: "NGN" },
                  requestId: "req_leak",
                }
              : projection(booking),
          );
        send(200, { blocks });
        return;
      }
      // 6. driver calendar
      const calendar = /^\/internal\/fleet\/drivers\/([^/]+)\/calendar$/.exec(
        path,
      );
      if (req.method === "GET" && calendar !== null) {
        const driverId = decodeURIComponent(calendar[1] ?? "");
        const window = {
          start: new Date(url.searchParams.get("from") ?? 0).getTime(),
          end: new Date(url.searchParams.get("to") ?? 0).getTime(),
        };
        send(200, {
          bookings: bookings
            .filter((booking) => booking.driverId === driverId)
            .filter((booking) =>
              overlaps(
                {
                  start: new Date(booking.windowStart).getTime(),
                  end: new Date(booking.windowEnd).getTime(),
                },
                window,
              ),
            )
            .map((booking) => ({
              // The driver's own entry (MpAdvanceBooking driver view, abridged).
              bookingId: booking.bookingId,
              state: booking.state,
              viewer: "driver",
              statusLabel: "Driver confirmed",
              schedule: {
                windowStart: booking.windowStart,
                windowEnd: booking.windowEnd,
                label: "Tue 29 Sep, 08:00 (UTC+01:00)",
              },
              pickup: { label: "Pickup (driver's own)", lat: 6.5, lng: 3.4 },
              commissionMinor: booking.commissionMinor,
            })),
          note: "driver calendar",
        });
        return;
      }
      // 7. vehicle swap
      const swap = /^\/internal\/fleet\/bookings\/([^/]+)\/vehicle-swaps$/.exec(
        path,
      );
      if (req.method === "POST" && swap !== null) {
        idempotent(() => {
          if (state.swapIneligible !== null) {
            return {
              status: 422,
              body: {
                code: "swap_ineligible",
                message: "not eligible",
                details: { reasons: state.swapIneligible },
              },
            };
          }
          return {
            status: 201,
            body: { swapId: `swp_${randomUUID()}`, status: "proposed" },
          };
        });
        return;
      }
      send(404, { code: "not_found", message: "no such contract A route" });
    })().catch((error: unknown) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ code: "internal_error", message: String(error) }),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;

  const double: RideDouble = {
    url: `http://127.0.0.1:${port}`,
    bookings,
    occupancies,
    requests,
    get leakExtraFields() {
      return state.leakExtraFields;
    },
    set leakExtraFields(value: boolean) {
      state.leakExtraFields = value;
    },
    get swapIneligible() {
      return state.swapIneligible;
    },
    set swapIneligible(value: string[] | null) {
      state.swapIneligible = value;
    },
    get down() {
      return state.down;
    },
    set down(value: boolean) {
      state.down = value;
    },
    addBooking(input) {
      counter += 1;
      const booking: DoubleBooking = {
        blockId: input.blockId ?? `blk_${counter}_${randomUUID().slice(0, 8)}`,
        bookingId: input.bookingId ?? randomUUID(),
        driverId: input.driverId,
        vehicleId: input.vehicleId ?? null,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        windowStart:
          input.windowStart ??
          new Date(
            new Date(input.startsAt).getTime() + 15 * 60_000,
          ).toISOString(),
        windowEnd:
          input.windowEnd ??
          new Date(
            new Date(input.startsAt).getTime() + 25 * 60_000,
          ).toISOString(),
        kind: input.kind ?? "booked",
        risk: input.risk ?? "ok",
        decisionDeadline: input.decisionDeadline ?? null,
        state: input.state ?? "confirmed",
        commissionMinor: input.commissionMinor ?? {
          amountMinor: 45_000,
          currency: "NGN",
        },
      };
      bookings.push(booking);
      return booking;
    },
    reset() {
      bookings.length = 0;
      occupancies.length = 0;
      requests.length = 0;
      idempotency.clear();
      state.leakExtraFields = false;
      state.swapIneligible = null;
      state.down = false;
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  return double;
}
