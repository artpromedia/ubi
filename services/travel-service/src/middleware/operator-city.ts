/**
 * The operating city an UNBOUND operator declares for a console action.
 *
 * A traveller's city is always the one the gateway signed (./auth.ts). An ops
 * operator whose signed context is bound to no city holds every city, so a
 * console action names the city it is for in `X-City-ID` — the one declared
 * value this service accepts in production (`cityOf`). Two rules keep that
 * exception narrow:
 *
 *   - THE CITY MUST BE SUPPORTED. A declared city that is not a live UBI city
 *     (no `cities` row, or not `active` — the same rule the city config
 *     provider applies, ops/config.ts) is refused with `city_unsupported`
 *     before any handler runs, so an operator cannot stamp an order, outbox
 *     event or audit row with a city UBI does not operate in.
 *   - THE PROVENANCE IS KNOWN. The accepted city is recorded on the request
 *     as operator-declared together with the operator's id
 *     (`cityProvenanceOf`), so a console write can say whose word the city
 *     rests on rather than presenting it as gateway-verified.
 *
 * The lookup reads the service's own database. It is injected through
 * `setSupportedCityLookup` for tests that need a failing store; production
 * and the integration tests use the real `cities` table.
 */
import { ContractError } from "@ubi/contracts";

import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { isOpsRole } from "../ops/roles";

import type { Context } from "hono";

/** Whether `cityId` is a city UBI operates in. */
export type SupportedCityLookup = (cityId: string) => Promise<boolean>;

async function databaseLookup(cityId: string): Promise<boolean> {
  const city = await prisma.city.findUnique({
    where: { id: cityId },
    select: { active: true },
  });
  return city?.active === true;
}

let lookup: SupportedCityLookup = databaseLookup;

/** Test seam; `undefined` restores the database lookup. */
export function setSupportedCityLookup(
  next: SupportedCityLookup | undefined,
): void {
  lookup = next ?? databaseLookup;
}

/** An operator-declared city that passed the supported-city check. */
export interface OperatorDeclaredCity {
  readonly cityId: string;
  /** The signed operator whose declaration the city rests on. */
  readonly operatorId: string;
}

declare module "hono" {
  interface ContextVariableMap {
    operatorCity: OperatorDeclaredCity | undefined;
  }
}

function presentHeader(c: Context, name: string): string | undefined {
  const value = c.req.header(name)?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

/**
 * Runs inside `gatewayAuth`, after the caller is verified. When the caller is
 * a signed ops operator bound to no city and declares one, the declared city
 * must be supported; it is then recorded as operator-declared. Anyone else —
 * a traveller, a city-bound operator, the unsigned development path — is left
 * to the ordinary city rules in ./auth.ts.
 *
 * A lookup that fails is an outage (`service_unavailable`), never a reason to
 * accept the city.
 */
export async function checkOperatorDeclaredCity(c: Context): Promise<void> {
  c.set("operatorCity", undefined);
  const identity = c.get("identity");
  if (
    identity === undefined ||
    identity.cityId !== null ||
    !isOpsRole(identity.role)
  ) {
    return;
  }
  const declared = presentHeader(c, "X-City-ID");
  if (declared === undefined) {
    return;
  }
  let supported: boolean;
  try {
    supported = await lookup(declared);
  } catch (error) {
    logger.error(
      { err: error },
      "the operator's declared city could not be checked",
    );
    throw new ContractError(
      "service_unavailable",
      "the operating city could not be checked; please try again",
    );
  }
  if (!supported) {
    throw new ContractError(
      "city_unsupported",
      "UBI is not live in that city",
      {
        cityId: declared,
        reason: "operator_declared_city_unsupported",
      },
    );
  }
  c.set("operatorCity", { cityId: declared, operatorId: identity.userId });
}

/** Where the request's city came from. */
export type CityProvenance =
  /** The gateway signed it (or, outside production only, its mirrors). */
  | "verified"
  /** A signed, unbound operator declared it; it is a supported city. */
  | "operator_declared"
  /** Declared with no gateway in front (development and tests only). */
  | "declared_unverified";

export interface CityWithProvenance {
  readonly cityId: string;
  readonly provenance: CityProvenance;
  /** The operator id for `operator_declared`; null otherwise. */
  readonly declaredBy: string | null;
}
