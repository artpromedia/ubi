/**
 * @ubi/contracts — the canonical contract surface shared by every UBI service,
 * console and app.
 *
 * Sources of truth, vendored at the repository root:
 *   contracts/state-machines.json   → state machines (generated, never hand-edited)
 *   contracts/events/catalog.md     → event envelope and names
 *   contracts/openapi/*.yaml        → HTTP contracts
 */
export * from "./money";
export * from "./events";
export * from "./state-machines";
export * from "./city-config";
export * from "./flags";
export * from "./errors";
export * from "./idempotency";
export * from "./test-ids";
