/**
 * Roles and permissions for the growth service (CLAUDE.md #5, #6, #19, #22).
 *
 * A role is never read from a request body — the gateway asserts it in
 * `X-User-Role` and this module decides what that role may do. Deny by default:
 * an unrecognised role gets nothing.
 *
 * Two of these rules are load-bearing and enforced here rather than in each
 * handler:
 *  - The AI marketing assistant (`marketing_ai`) may only DRAFT. It has no
 *    permission to submit, approve, activate or change a budget, so an
 *    AI-authored campaign can never leave `draft` on the model's own authority
 *    (CLAUDE.md #19, #22).
 *  - Every human approver role can approve, but the two-person check
 *    (approver ≠ author) is a separate guard in the campaign module; a
 *    permission is necessary, never sufficient, to approve.
 */
import { ContractError } from "@ubi/contracts";

export const GROWTH_ADMIN_ROLES = [
  "growth_admin",
  "growth_editor",
  "marketing_ai",
] as const;
export type GrowthAdminRole = (typeof GROWTH_ADMIN_ROLES)[number];

/** Roles that belong to an end user rather than to the growth organisation. */
export const END_USER_ROLES = ["rider", "driver"] as const;
export type EndUserRole = (typeof END_USER_ROLES)[number];

export const PERMISSIONS = [
  /** Read campaigns, versions, liability, outcome. */
  "campaign.read",
  /** Create a campaign (always as a draft). */
  "campaign.create",
  /** Run a liability simulation on a version. */
  "campaign.simulate",
  /** Submit a version for two-person approval. */
  "campaign.submit",
  /** Approve/activate/pause/resume/end/raise-budget — needs approver ≠ author. */
  "campaign.approve",
  /** See and decide referral abuse review cases. */
  "referral.review.read",
  "referral.review.decide",
  /** Read the live commission-incentive spend board and daily recon. */
  "commission.read",
  "recon.read",
  /** Draft marketing material (never activate/send). */
  "marketing.draft",
  /** A rider reading their own benefits / referrals, or claiming attribution. */
  "benefits.read.self",
  "referrals.self",
  /** A driver reading their own incentives and statements. */
  "driver.incentives.self",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Readonly<
  Record<GrowthAdminRole | EndUserRole, readonly Permission[]>
> = {
  growth_admin: [
    "campaign.read",
    "campaign.create",
    "campaign.simulate",
    "campaign.submit",
    "campaign.approve",
    "referral.review.read",
    "referral.review.decide",
    "commission.read",
    "recon.read",
    "marketing.draft",
  ],
  growth_editor: [
    "campaign.read",
    "campaign.create",
    "campaign.simulate",
    "campaign.submit",
    "campaign.approve",
    "referral.review.read",
    "commission.read",
    "recon.read",
    "marketing.draft",
  ],
  // The AI marketing assistant: it can look and it can draft. It cannot submit,
  // approve or change money. Deny-by-default does the rest (CLAUDE.md #19, #22).
  marketing_ai: ["campaign.read", "campaign.create", "marketing.draft"],
  // ---- end users -------------------------------------------------------
  rider: ["benefits.read.self", "referrals.self"],
  driver: ["driver.incentives.self", "referrals.self"],
};

const ROLE_SET: ReadonlySet<string> = new Set([
  ...GROWTH_ADMIN_ROLES,
  ...END_USER_ROLES,
]);

export function isKnownRole(role: string): role is GrowthAdminRole | EndUserRole {
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
      { role, permission },
    );
  }
}

/** True for the AI marketing assistant; it is allowed to draft, never to move money. */
export function isAiActor(role: string): boolean {
  return role === "marketing_ai";
}

/** The actor type an event envelope carries for this role. */
export function actorTypeFor(role: string): string {
  switch (role) {
    case "rider":
    case "driver":
      return role;
    case "marketing_ai":
      return "system";
    default:
      return "agent";
  }
}
