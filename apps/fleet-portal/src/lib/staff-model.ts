/**
 * Staff roles (B9): the owner edits the WHOLE staff list and the portal
 * sends it with `PUT /v1/fleets/:id/staff` (fleet-service replaces the list,
 * checks every user exists and keeps at least one owner). The checks here
 * only stop an obviously invalid list from being sent; the server's answer
 * is the authority.
 */
import type {
  FleetStaffMember,
  FleetStaffRole,
  PutFleetStaffInput,
} from "./fleet-types";

export interface StaffDraftEntry {
  readonly userId: string;
  readonly role: FleetStaffRole;
  readonly displayName: string | null;
}

export const draftFromStaff = (
  staff: readonly FleetStaffMember[],
): StaffDraftEntry[] =>
  staff.map((member) => ({
    userId: member.userId,
    role: member.role,
    displayName: member.displayName,
  }));

export function staffProblems(draft: readonly StaffDraftEntry[]): string[] {
  const problems: string[] = [];
  if (!draft.some((entry) => entry.role === "owner")) {
    problems.push("A fleet must keep at least one owner.");
  }
  const seen = new Set<string>();
  for (const entry of draft) {
    const id = entry.userId.trim();
    if (id.length === 0) {
      problems.push("Every staff member needs a UBI user ID.");
    } else if (seen.has(id)) {
      problems.push(`${id} is listed twice.`);
    }
    seen.add(id);
  }
  return problems;
}

export const staffBody = (
  draft: readonly StaffDraftEntry[],
): PutFleetStaffInput => ({
  staff: draft.map((entry) => ({
    userId: entry.userId.trim(),
    role: entry.role,
  })),
});
