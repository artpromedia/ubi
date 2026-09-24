/**
 * Recipient directories: who is the requester / driver / traveller of an event
 * whose payload does not name them, and what is a recipient's OWN verified
 * phone for an SMS fallback.
 *
 * Why a lookup at all: ride-service's amendment, stop, award and bid payloads
 * carry award/request ids but not always the parties (e.g. mp.bid.submitted
 * and mp.award.confirmed name no requester; mp.amendment.* and mp.stop.* name
 * neither party), and travel-service's reservation.* payloads carry the
 * transfer id but not the traveller. The payload is always tried FIRST; the
 * directory is the fallback.
 *
 * Sources (read-only, by primary key):
 *   - ride-service's authoritative marketplace tables `mp.awards`
 *     (requester_id, driver_id) and `mp.requests` (requester_id). They live in
 *     the same Postgres database as the shared Prisma schema (the production
 *     compose gives both services the same DATABASE_URL); they are not Prisma
 *     models, so they are read with a parameterised raw query;
 *   - the shared Prisma models `AirportTransfer.userId` and `User.phone` /
 *     `phoneVerified`.
 *
 * A lookup that cannot run (the mp schema is absent, the database is down)
 * THROWS: the deliverer records the audience as unresolved in the dead-letter
 * queue for replay instead of guessing a recipient. Nothing here ever returns
 * a phone that is not the account holder's own verified number, and nothing
 * here can reach a guest passenger (who has no account).
 */
import type { PrismaClient } from "@prisma/client";

export interface AwardParties {
  readonly requesterId: string | null;
  readonly driverId: string | null;
}

export interface PartyDirectory {
  /** The award's requester and driver, or null when there is no such award. */
  award(awardId: string): Promise<AwardParties | null>;
  /** The request's requester, or null. */
  requester(requestId: string): Promise<string | null>;
  /** The airport transfer's traveller (owner), or null. */
  traveller(transferId: string): Promise<string | null>;
}

export interface PhoneDirectory {
  /** The account holder's own VERIFIED phone in E.164, or null. */
  verifiedPhone(userId: string): Promise<string | null>;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const E164_PATTERN = /^\+[1-9][0-9]{7,14}$/;
const MAX_TEXT_ID = 128;

interface PartyRow {
  readonly requester_id: string | null;
  readonly driver_id?: string | null;
}

/** Postgres/Prisma-backed directory. */
export class SqlPartyDirectory implements PartyDirectory, PhoneDirectory {
  private readonly schema: string;

  constructor(
    private readonly db: PrismaClient,
    options: {
      /** ride-service's marketplace schema; overridable for tests. */
      readonly marketplaceSchema?: string;
    } = {},
  ) {
    const schema = options.marketplaceSchema ?? "mp";
    if (!IDENTIFIER_PATTERN.test(schema)) {
      throw new Error(
        "marketplaceSchema must be a plain lower-case identifier",
      );
    }
    this.schema = schema;
  }

  async award(awardId: string): Promise<AwardParties | null> {
    if (!UUID_PATTERN.test(awardId)) {
      return null;
    }
    const rows = await this.db.$queryRawUnsafe<PartyRow[]>(
      `SELECT requester_id::text AS requester_id, driver_id::text AS driver_id
         FROM "${this.schema}".awards WHERE id = $1::uuid`,
      awardId,
    );
    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    return {
      requesterId: row.requester_id ?? null,
      driverId: row.driver_id ?? null,
    };
  }

  async requester(requestId: string): Promise<string | null> {
    if (!UUID_PATTERN.test(requestId)) {
      return null;
    }
    const rows = await this.db.$queryRawUnsafe<PartyRow[]>(
      `SELECT requester_id::text AS requester_id
         FROM "${this.schema}".requests WHERE id = $1::uuid`,
      requestId,
    );
    return rows[0]?.requester_id ?? null;
  }

  async traveller(transferId: string): Promise<string | null> {
    if (transferId.length === 0 || transferId.length > MAX_TEXT_ID) {
      return null;
    }
    const row = await this.db.airportTransfer.findUnique({
      where: { id: transferId },
      select: { userId: true },
    });
    return row?.userId ?? null;
  }

  async verifiedPhone(userId: string): Promise<string | null> {
    if (!UUID_PATTERN.test(userId)) {
      return null;
    }
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { phone: true, phoneVerified: true, deletedAt: true },
    });
    if (
      user === null ||
      !user.phoneVerified ||
      user.deletedAt !== null ||
      !E164_PATTERN.test(user.phone)
    ) {
      return null;
    }
    return user.phone;
  }
}
