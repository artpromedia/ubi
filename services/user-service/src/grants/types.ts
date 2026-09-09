/**
 * What the action-grant and mandate code needs from the outside world.
 *
 * Everything is passed in rather than reached for at the point of use, so the
 * integration tests run the real handlers against a real Postgres while
 * supplying only a clock of their own. There is no stub on any production path.
 */
import type { PrismaClient } from "@prisma/client";

export interface AiActionDeps {
  readonly prisma: PrismaClient;
  /** The clock, so expiry windows are exercised rather than slept through. */
  readonly now: () => Date;
}
