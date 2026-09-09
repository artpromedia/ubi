/**
 * Who may do what.
 *
 * The gateway proves the caller's role; this service never trusts a role from a
 * body (CLAUDE.md #1). Travellers act on their own orders; travel-ops act on the
 * exception console. Privacy by role (CLAUDE.md #6): a traveller can only ever
 * see their own orders, so a forbidden order is reported as `not_found` rather
 * than being made discoverable.
 */
export const TRAVELLER_ROLES: ReadonlySet<string> = new Set(["rider", "driver"]);

export const OPS_ROLES: ReadonlySet<string> = new Set([
  "admin",
  "super_admin",
  "travel_ops",
  "ops",
  "support_lead",
  "support_agent",
]);

export function isOpsRole(role: string): boolean {
  return OPS_ROLES.has(role);
}

export function actorTypeFor(role: string): string {
  if (role === "rider") return "rider";
  if (role === "driver") return "driver";
  return "agent";
}
