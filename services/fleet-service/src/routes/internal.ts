/**
 * Service-to-service routes under `/internal/fleet` — never proxied by the
 * gateway (tests pin them as the gateway's own 404).
 *
 *  - ride-service → fleet-service (INTERNAL CONTRACT A routes 8, 9),
 *    X-Service-Key = FLEET_SERVICE_KEY:
 *      GET /internal/fleet/drivers/:driverId/vehicle-at?from&to
 *      GET /internal/fleet/vehicles/:vehicleId
 *  - payment-service → fleet-service (INTERNAL CONTRACT B),
 *    X-Service-Key = FLEET_PAYMENT_SERVICE_KEY:
 *      GET /internal/fleet/settlement-inputs?weekStart&cityId
 *
 * Each key is ≥ 32 characters, compared in constant time, and a missing key
 * CLOSES its routes (503). The `fleet` flag does not gate these: switching
 * fleet tools off in a city stops new fleet activity, never ride-service's
 * revalidation of existing bookings or the settlement of terms a driver has
 * already signed.
 */
import { Hono } from "hono";
import { z } from "zod";

import { ContractError } from "@ubi/contracts";

import {
  FleetInternalVehicleSchema,
  FleetVehicleAtResponseSchema,
  SettlementInputsQuerySchema,
  SettlementInputsResponseSchema,
} from "../contract";
import { respond } from "./respond";
import { isUuid } from "../lib/ids";
import {
  FLEET_PAYMENT_SERVICE_KEY_ENV,
  FLEET_SERVICE_KEY_ENV,
  requireServiceKey,
} from "../lib/service-key";
import { iso } from "../lib/time";
import { failure } from "../middleware/error-handler";
import { vehicleAt } from "../ops/assignments";
import { settlementInputs } from "../ops/settlement";

import type { FleetDeps } from "../ops/context";

const VehicleAtQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  })
  .strict();

export function createInternalRoutes(deps: FleetDeps): Hono {
  const routes = new Hono();
  const rideKey = requireServiceKey(FLEET_SERVICE_KEY_ENV);
  const paymentKey = requireServiceKey(FLEET_PAYMENT_SERVICE_KEY_ENV);

  routes.get("/drivers/:driverId/vehicle-at", rideKey, async (c) => {
    try {
      const query = VehicleAtQuerySchema.parse(c.req.query());
      const answer = await vehicleAt(
        deps.db,
        c.req.param("driverId"),
        new Date(query.from),
        new Date(query.to),
      );
      return respond(c, FleetVehicleAtResponseSchema, answer);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/vehicles/:vehicleId", rideKey, async (c) => {
    try {
      const vehicleId = c.req.param("vehicleId");
      const row = isUuid(vehicleId)
        ? await deps.db.fleetVehicle.findFirst({
            where: { vehicleId, status: "active" },
            include: { vehicle: true },
          })
        : null;
      if (row === null) {
        throw new ContractError("not_found", "not a fleet vehicle");
      }
      return respond(c, FleetInternalVehicleSchema, {
        vehicleId: row.vehicleId,
        fleetId: row.fleetId,
        classes: [...row.classes],
        capacity: row.capacity,
        documents: {
          insuranceExpiry:
            row.vehicle.insuranceExpiry === null
              ? null
              : iso(row.vehicle.insuranceExpiry.getTime()),
          inspectionExpiry:
            row.vehicle.inspectionExpiry === null
              ? null
              : iso(row.vehicle.inspectionExpiry.getTime()),
        },
      });
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/settlement-inputs", paymentKey, async (c) => {
    try {
      const query = SettlementInputsQuerySchema.parse(c.req.query());
      return respond(
        c,
        SettlementInputsResponseSchema,
        await settlementInputs(deps.db, query, deps.now()),
      );
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}
