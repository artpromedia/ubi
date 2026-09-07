/**
 * Privacy by role (CLAUDE.md non-negotiable #6).
 *
 * Ops roles are a closed set with a closed set of permissions. A role is never
 * read from a request body — the gateway asserts it in `X-User-Role` and this
 * module decides what that role may do and what it may see. Two rules matter
 * most and are enforced here rather than in each handler:
 *
 *  - A support agent may work a case without seeing the customer's raw contact
 *    details or a precise safety location.
 *  - Safety evidence stays with Trust & Safety: the safety queue is not visible
 *    to a support agent at all.
 */
import { ContractError } from "@ubi/contracts";

export const OPS_ROLES = [
  "support_agent",
  "support_lead",
  "safety_responder",
  "reviewer",
  "ops_admin",
] as const;
export type OpsRole = (typeof OPS_ROLES)[number];

/** Roles that belong to an end user rather than to the ops organisation. */
export const END_USER_ROLES = ["rider", "driver", "merchant", "hotel", "fleet"] as const;
export type EndUserRole = (typeof END_USER_ROLES)[number];

export const PERMISSIONS = [
  /** Open a case about yourself. */
  "case.open",
  /** Open a case on behalf of someone else. */
  "case.open.on_behalf",
  /** Read any case, not only your own. */
  "case.read.any",
  "case.message",
  "case.transition",
  "remedy.post",
  /** Post a remedy above the city's high-value threshold. */
  "remedy.post.high_value",
  /** Raise an SOS about yourself. */
  "safety.raise",
  /** See the safety queue and its evidence. */
  "safety.read",
  "safety.respond",
  "review.read",
  "review.decide",
  /** See raw phone/email instead of a masked form. */
  "pii.contact",
  /** See a precise location instead of a coarse one. */
  "pii.location",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Readonly<Record<OpsRole | EndUserRole, readonly Permission[]>> = {
  // ---- ops roles -------------------------------------------------------
  support_agent: [
    "case.open",
    "case.open.on_behalf",
    "case.read.any",
    "case.message",
    "case.transition",
    "remedy.post",
  ],
  support_lead: [
    "case.open",
    "case.open.on_behalf",
    "case.read.any",
    "case.message",
    "case.transition",
    "remedy.post",
    "remedy.post.high_value",
    "review.read",
    "review.decide",
    "pii.contact",
  ],
  safety_responder: [
    "case.read.any",
    "case.message",
    // A responder logging a third-party report raises the case themselves.
    "safety.raise",
    "safety.read",
    "safety.respond",
    "pii.contact",
    "pii.location",
  ],
  reviewer: ["review.read", "review.decide", "case.read.any"],
  ops_admin: [
    "case.open",
    "case.open.on_behalf",
    "case.read.any",
    "case.message",
    "case.transition",
    "remedy.post",
    "remedy.post.high_value",
    "safety.raise",
    "safety.read",
    "safety.respond",
    "review.read",
    "review.decide",
    "pii.contact",
    "pii.location",
  ],
  // ---- end users -------------------------------------------------------
  // They may raise things about themselves and read their own case; they get no
  // ".any" permission, so the case handler scopes every read to their own id.
  rider: ["case.open", "case.message", "safety.raise"],
  driver: ["case.open", "case.message", "safety.raise"],
  merchant: ["case.open", "case.message"],
  hotel: ["case.open", "case.message"],
  fleet: ["case.open", "case.message"],
};

const ROLE_SET: ReadonlySet<string> = new Set([...OPS_ROLES, ...END_USER_ROLES]);

export function isKnownRole(role: string): role is OpsRole | EndUserRole {
  return ROLE_SET.has(role);
}

export function permissionsFor(role: string): readonly Permission[] {
  // An unrecognised role gets nothing. Deny by default, like the flags.
  return isKnownRole(role) ? ROLE_PERMISSIONS[role] : [];
}

export function can(role: string, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}

export function assertPermission(role: string, permission: Permission): void {
  if (!can(role, permission)) {
    throw new ContractError("forbidden", "your role does not allow that action", {
      role,
      permission,
    });
  }
}

/** The actor type an event envelope carries for this role. */
export function actorTypeFor(role: string): string {
  switch (role) {
    case "rider":
    case "driver":
    case "merchant":
    case "hotel":
    case "fleet":
      return role;
    default:
      return "agent";
  }
}

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------

/**
 * Keeps the country prefix and the last two digits — enough for an agent to
 * confirm they are looking at the right person, not enough to contact them out
 * of band.
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length < 4) {
    return "•".repeat(digits.length);
  }
  const head = phone.startsWith("+") ? `+${digits.slice(0, 3)}` : digits.slice(0, 3);
  const tail = digits.slice(-2);
  return `${head}${"•".repeat(Math.max(2, digits.length - 5))}${tail}`;
}

export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) {
    return "•".repeat(email.length);
  }
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const firstChar = local.slice(0, 1);
  return `${firstChar}${"•".repeat(Math.max(2, local.length - 1))}@${domain}`;
}

export interface Contact {
  readonly phone: string | null;
  readonly email: string | null;
}

export function contactForRole(role: string, contact: Contact): Contact & {
  readonly masked: boolean;
} {
  if (can(role, "pii.contact")) {
    return { ...contact, masked: false };
  }
  return {
    phone: contact.phone === null ? null : maskPhone(contact.phone),
    email: contact.email === null ? null : maskEmail(contact.email),
    masked: true,
  };
}

export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

/**
 * Roughly 1 km of resolution — enough for a support agent to say "the ride was
 * on the mainland", not enough to put someone at an address.
 */
const COARSE_DECIMALS = 2;

export interface CoarseLocation {
  readonly lat: number;
  readonly lng: number;
  readonly precision: "exact" | "coarse";
}

export function locationForRole(
  role: string,
  point: GeoPoint | null,
): CoarseLocation | null {
  if (point === null) {
    return null;
  }
  if (can(role, "pii.location")) {
    return { lat: point.lat, lng: point.lng, precision: "exact" };
  }
  const factor = 10 ** COARSE_DECIMALS;
  return {
    lat: Math.round(point.lat * factor) / factor,
    lng: Math.round(point.lng * factor) / factor,
    precision: "coarse",
  };
}
