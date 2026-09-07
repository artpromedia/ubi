/**
 * Privacy and authorization by role (CLAUDE.md #6, #3).
 *
 * The role is asserted by the gateway in `X-User-Role` and read from nowhere
 * else — never from a request body. This module is a closed set of roles with a
 * closed set of permissions; an unrecognised role gets nothing, so access is
 * deny-by-default like the flags.
 *
 * Being allowed to perform an action is necessary but not sufficient: a merchant
 * may manage *their* outlets, a customer may read *their* order. Those ownership
 * checks live beside the data in the service functions; this module only decides
 * whether the role may attempt the action at all.
 */
import { ContractError } from "@ubi/contracts";

export const BITES_ROLES = [
  /** The person ordering food. */
  "rider",
  /** A registered food business acting on its own outlets. */
  "merchant",
  /** The courier carrying the order; role name shared with rides. */
  "driver",
  /** Trust & Safety / ops reviewing a merchant KYB application. */
  "reviewer",
  "ops_admin",
] as const;
export type BitesRole = (typeof BITES_ROLES)[number];

export const PERMISSIONS = [
  "cart.write",
  "order.place",
  "order.read.own",
  "order.issue.report",
  "merchant.apply",
  /** Build outlets and menus, toggle availability, work the orders board, read payouts. */
  "merchant.manage",
  "order.issue.respond",
  /** Carry the order: handover at the counter, deliver at the door. */
  "courier.fulfill",
  /** Decide a merchant KYB application. */
  "merchant.review",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Readonly<Record<BitesRole, readonly Permission[]>> = {
  rider: ["cart.write", "order.place", "order.read.own", "order.issue.report"],
  merchant: ["merchant.apply", "merchant.manage", "order.issue.respond"],
  driver: ["courier.fulfill"],
  reviewer: ["merchant.review"],
  ops_admin: ["merchant.review", "merchant.manage"],
};

const ROLE_SET: ReadonlySet<string> = new Set(BITES_ROLES);

export function isKnownRole(role: string): role is BitesRole {
  return ROLE_SET.has(role);
}

export function permissionsFor(role: string): readonly Permission[] {
  return isKnownRole(role) ? ROLE_PERMISSIONS[role] : [];
}

export function can(role: string, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}

export function assertPermission(role: string, permission: Permission): void {
  if (!can(role, permission)) {
    throw new ContractError(
      "forbidden",
      "your role does not allow that action",
      {
        role,
        permission,
      },
    );
  }
}

/** The actor type an event envelope carries for this role. */
export function actorTypeFor(role: string): string {
  switch (role) {
    case "rider":
    case "driver":
    case "merchant":
      return role;
    default:
      return "agent";
  }
}
