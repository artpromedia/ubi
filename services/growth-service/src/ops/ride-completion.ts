/**
 * Ride-completion reward pipeline (CC-A12 / P2-10).
 *
 * Evaluates a completed ride (`event:ride.completed`) against:
 *  1. Rider referrals (`qualifyReferral`): when the `referrals` flag is on for
 *     the ride's city and the rider has an `installed` or `qualifying`
 *     referral, qualifies the referral against the completed ride.
 *  2. Driver commission incentives (`postRebate`, `postWindowWaiver`,
 *     `postMilestone`): when `driver_commission_rebates` is on for the ride's
 *     city, posts any eligible rebate or commission-free-window waiver as a
 *     separate ledger line and, when a campaign version defines a trip
 *     milestone (`milestoneTrips` + `milestoneBonus`) that this trip reaches,
 *     posts the milestone bonus.
 */
import { money, type EventEnvelope } from "@ubi/contracts";
import { subscribeOutbox, type OutboxSubscription } from "@ubi/outbox";

import {
  postMilestone,
  postRebate,
  postWindowWaiver,
  type PostingResult,
  type TripBreakdown,
} from "./incentives";
import {
  qualifyReferral,
  type AbuseSignal,
  type QualifyResult,
} from "./referrals";
import { logger } from "../lib/logger";

import type { GrowthDeps } from "./context";
import type { Actor } from "./types";
import type { Redis } from "ioredis";

const SYSTEM_ACTOR: Actor = { id: "sys_growth_pipeline", role: "growth_admin" };

export interface RideCompletedEventInput {
  readonly tripId: string;
  readonly riderId: string | null;
  readonly driverId: string | null;
  readonly cityId: string | null;
  readonly fareMinor: number;
  readonly tipsMinor?: number;
  readonly tollsMinor?: number;
  readonly taxesMinor?: number;
  readonly baseCommissionMinor?: number;
  readonly currency: string;
  readonly paymentMethod: string;
  readonly startedAt?: Date;
  readonly signals?: readonly AbuseSignal[];
  readonly correlationId: string | null;
}

export interface RideCompletedOutcome {
  readonly referral: QualifyResult | null;
  readonly incentives: readonly PostingResult[];
  readonly milestones: readonly PostingResult[];
}

export async function handleRideCompleted(
  deps: GrowthDeps,
  input: RideCompletedEventInput,
): Promise<RideCompletedOutcome> {
  const flags =
    input.cityId === null ? null : await deps.flags.flagsFor(input.cityId);
  const referralsEnabled = flags === null || flags.referrals === true;
  const incentivesEnabled =
    flags === null || flags.driver_commission_rebates === true;

  let referralOutcome: QualifyResult | null = null;
  if (referralsEnabled && input.riderId !== null && input.riderId.length > 0) {
    const candidate = await deps.db.referral.findFirst({
      where: {
        refereeId: input.riderId,
        stage: { in: ["installed", "qualifying"] },
        OR: [{ qualifyingRideId: null }, { qualifyingRideId: input.tripId }],
      },
      orderBy: { createdAt: "asc" },
    });
    if (candidate !== null) {
      referralOutcome = await qualifyReferral(deps, {
        actor: SYSTEM_ACTOR,
        cityId: input.cityId,
        referralId: candidate.id,
        qualifyingRideId: input.tripId,
        ...(input.signals === undefined ? {} : { signals: input.signals }),
        correlationId: input.correlationId,
      });
    }
  }

  const incentives: PostingResult[] = [];
  const milestones: PostingResult[] = [];

  if (
    incentivesEnabled &&
    input.driverId !== null &&
    input.driverId.length > 0 &&
    input.fareMinor > 0
  ) {
    const rules = await deps.db.driverIncentiveRule.findMany({
      where: {
        campaignVersion: {
          currency: input.currency,
          campaign: { state: "active" },
        },
      },
      include: { campaignVersion: true },
      orderBy: { campaignVersion: { createdAt: "desc" } },
    });

    const trip: TripBreakdown = {
      fareMinor: input.fareMinor,
      ...(input.tipsMinor === undefined ? {} : { tipsMinor: input.tipsMinor }),
      ...(input.tollsMinor === undefined
        ? {}
        : { tollsMinor: input.tollsMinor }),
      ...(input.taxesMinor === undefined
        ? {}
        : { taxesMinor: input.taxesMinor }),
      ...(input.baseCommissionMinor === undefined
        ? {}
        : { baseCommissionMinor: input.baseCommissionMinor }),
      currency: input.currency,
      paymentMethod: input.paymentMethod,
      ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
    };

    const postedKinds = new Set<"rebate" | "window_waiver">();
    for (const rule of rules) {
      const targetKind = rule.kind === "window" ? "window_waiver" : "rebate";
      if (postedKinds.has(targetKind)) {
        continue;
      }
      const posting =
        rule.kind === "window"
          ? await postWindowWaiver(deps, {
              actor: SYSTEM_ACTOR,
              cityId: input.cityId,
              ruleId: rule.id,
              driverId: input.driverId,
              tripId: input.tripId,
              trip,
              correlationId: input.correlationId,
            })
          : await postRebate(deps, {
              actor: SYSTEM_ACTOR,
              cityId: input.cityId,
              ruleId: rule.id,
              driverId: input.driverId,
              tripId: input.tripId,
              trip,
              correlationId: input.correlationId,
            });
      incentives.push(posting);
      if (posting.posted) {
        postedKinds.add(targetKind);
      }

      const value = rule.campaignVersion.value as {
        milestoneTrips?: number;
        milestoneBonus?: { amountMinor?: number; currency?: string };
      } | null;
      const milestoneTrips = value?.milestoneTrips;
      const bonusMinor = value?.milestoneBonus?.amountMinor ?? 0;
      const bonusCurrency =
        value?.milestoneBonus?.currency ?? rule.campaignVersion.currency;
      if (
        typeof milestoneTrips === "number" &&
        milestoneTrips > 0 &&
        bonusMinor > 0 &&
        posting.posted
      ) {
        const completedCount = await deps.db.driverIncentivePosting.count({
          where: {
            ruleId: rule.id,
            driverId: input.driverId,
            kind: rule.kind === "window" ? "window_waiver" : "rebate",
          },
        });
        if (completedCount === milestoneTrips) {
          const milestonePosting = await postMilestone(deps, {
            actor: SYSTEM_ACTOR,
            cityId: input.cityId,
            ruleId: rule.id,
            driverId: input.driverId,
            tripId: input.tripId,
            amount: money(bonusMinor, bonusCurrency),
            milestone: `${milestoneTrips}_trips`,
            correlationId: input.correlationId,
          });
          milestones.push(milestonePosting);
        }
      }
    }
  }

  return { referral: referralOutcome, incentives, milestones };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value)
    ? value
    : 0;
}

export async function handleRideCompletedEnvelope(
  deps: GrowthDeps,
  envelope: EventEnvelope,
): Promise<RideCompletedOutcome | null> {
  if (envelope.name !== "ride.completed") {
    return null;
  }
  const payload = envelope.payload as Record<string, unknown>;
  const tripId =
    stringOrNull(payload.rideId) ??
    stringOrNull(payload.tripId) ??
    envelope.subject.id;
  const riderId = stringOrNull(payload.riderId);
  const driverId =
    stringOrNull(payload.driverId) ??
    (envelope.actor.type === "driver" ? stringOrNull(envelope.actor.id) : null);
  const fareMinor =
    numberOrZero(payload.fareMinor) || numberOrZero(payload.totalMinor);
  const currency = stringOrNull(payload.currency) ?? "NGN";
  const rawPaymentMethod =
    stringOrNull(payload.paymentMethod) ??
    stringOrNull(payload.paymentMethodId) ??
    "wallet";
  const paymentMethod = rawPaymentMethod === "cash" ? "cash" : "wallet";
  const startedAtRaw = stringOrNull(payload.startedAt);
  const startedAt =
    startedAtRaw !== null && !Number.isNaN(Date.parse(startedAtRaw))
      ? new Date(startedAtRaw)
      : undefined;

  return handleRideCompleted(deps, {
    tripId,
    riderId,
    driverId,
    cityId: envelope.cityId ?? null,
    fareMinor,
    currency,
    paymentMethod,
    ...(startedAt === undefined ? {} : { startedAt }),
    correlationId: envelope.correlationId ?? envelope.id,
  });
}

export async function startRideCompletionConsumer(
  deps: GrowthDeps,
  redisClient: Redis,
): Promise<OutboxSubscription> {
  const subscriber = redisClient.duplicate();
  return subscribeOutbox(
    subscriber,
    "event:ride.completed",
    async (envelope) => {
      await handleRideCompletedEnvelope(deps, envelope);
    },
    {
      dedupeKeyPrefix: "growth:outbox:seen:",
      onError: (err, channel) => {
        logger.error(
          { err, channel },
          "growth ride-completion outbox consumer error",
        );
      },
    },
  );
}
