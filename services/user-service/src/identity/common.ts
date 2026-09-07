/**
 * Shared bits every identity operation needs: who the actor is in event terms,
 * and a monotonic revision for aggregates that carry no version column of their
 * own.
 */
import type { ActorType } from "@ubi/contracts";

import type { Tx } from "./audit";

/**
 * Maps a UBI user role onto the closed `ActorType` set from
 * contracts/events/catalog.md. An operator or admin acts as `agent`; a
 * scheduled sweep acts as `system`.
 */
export function actorTypeFor(role: string): ActorType {
  switch (role.toLowerCase()) {
    case "rider":
      return "rider";
    case "driver":
      return "driver";
    case "merchant":
      return "merchant";
    case "restaurant":
      return "merchant";
    case "hotel":
      return "hotel";
    case "fleet":
    case "fleet_manager":
      return "fleet";
    case "service":
    case "system":
      return "system";
    default:
      return "agent";
  }
}

/**
 * How many times this subject has already been audited. Devices, safe-mode
 * holds and documents have no version column, so their events use the audit
 * count either side of the change as fromVersion/toVersion. It is monotonic,
 * which is all a consumer needs to detect a gap.
 */
export async function auditRevision(
  tx: Tx,
  subjectType: string,
  subjectId: string,
): Promise<number> {
  return tx.auditLog.count({ where: { subjectType, subjectId } });
}
