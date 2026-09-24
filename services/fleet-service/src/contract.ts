/**
 * The fleet contract (packages/contracts/src/fleet.ts), imported by path.
 *
 * @ubi/contracts publishes only its built index, and fleet.ts is not
 * registered there yet (the lead wires `export * from "./fleet"` together
 * with FLEET_EVENT_NAMES / FLEET_ERROR_CODES at integration). Until then every
 * module here imports the fleet vocabulary from this file, so the switch to
 * `@ubi/contracts` is this one line. tsup bundles the module; it depends on
 * nothing but zod and the contracts' own money schema.
 */
export * from "../../../packages/contracts/src/fleet";
