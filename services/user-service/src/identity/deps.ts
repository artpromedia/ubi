/**
 * What the identity module needs from the outside world, and how production
 * wires it.
 *
 * Everything is passed in rather than imported at the point of use, so the
 * tests can run the real handlers against a real Postgres and a real Redis
 * while supplying a city config and an SMS sink of their own. No production
 * path contains a stub.
 */
import type { PrismaClient } from "@prisma/client";
import { ConfigClient } from "@ubi/config-client";
import { ContractError } from "@ubi/contracts";
import { z } from "zod";

import { notificationClient } from "../lib/notification-client.js";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { createPolicyProvider, type PolicyProvider } from "./policy";
import type { FaceVerification, FaceVerifier } from "./step-up";

/** The subset of a Redis client the identity module uses. `ioredis` satisfies it. */
export interface IdentityCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttlSeconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
}

export interface Notifier {
  sendSms(params: { userId?: string; phone: string; message: string }): Promise<void>;
}

export interface IdentityDeps {
  readonly prisma: PrismaClient;
  readonly cache: IdentityCache;
  readonly policy: PolicyProvider;
  readonly notifier: Notifier;
  readonly faceVerifier: FaceVerifier;
  readonly now: () => Date;
}

/**
 * The biometric provider. The selfie is posted to it and the response is a
 * pair of scores; nothing here keeps the image, and the provider URL must be
 * configured — there is no local "always pass" path.
 */
function httpFaceVerifier(): FaceVerifier {
  return {
    async verify(input): Promise<FaceVerification> {
      const url = process.env.IDENTITY_FACE_PROVIDER_URL;
      if (url === undefined || url.length === 0) {
        throw new ContractError(
          "service_unavailable",
          "Identity checks are unavailable right now. Please try again shortly.",
        );
      }

      const response = await fetch(`${url.replace(/\/+$/, "")}/v1/face/verify`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env.IDENTITY_FACE_PROVIDER_KEY === undefined
            ? {}
            : { authorization: `Bearer ${process.env.IDENTITY_FACE_PROVIDER_KEY}` }),
        },
        body: JSON.stringify({
          reference: input.userId,
          nin: input.nin,
          image: input.imageBase64,
        }),
      });

      if (!response.ok) {
        throw new ContractError(
          "service_unavailable",
          "Identity checks are unavailable right now. Please try again shortly.",
          { status: response.status },
        );
      }

      const parsed = FaceProviderResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new ContractError(
          "service_unavailable",
          "Identity checks are unavailable right now. Please try again shortly.",
          { cause: "unparseable_provider_response" },
        );
      }
      return {
        livenessScore: parsed.data.livenessScore,
        matchScore: parsed.data.matchScore,
        providerRef: parsed.data.providerRef,
      };
    },
  };
}

const FaceProviderResponseSchema = z.object({
  livenessScore: z.number().min(0).max(1),
  matchScore: z.number().min(0).max(1),
  providerRef: z.string().min(1),
});

let cachedDeps: IdentityDeps | undefined;

export function defaultIdentityDeps(): IdentityDeps {
  if (cachedDeps !== undefined) return cachedDeps;

  const baseUrl = process.env.CONFIG_SERVICE_URL;
  if (baseUrl === undefined || baseUrl.length === 0) {
    throw new Error(
      "CONFIG_SERVICE_URL is required — identity policy (PIN attempts, limits) comes from city config",
    );
  }

  cachedDeps = {
    prisma,
    cache: redis,
    policy: createPolicyProvider(new ConfigClient({ baseUrl, cache: redis })),
    notifier: {
      async sendSms(params) {
        await notificationClient.sendSMS(params);
      },
    },
    faceVerifier: httpFaceVerifier(),
    now: () => new Date(),
  };
  return cachedDeps;
}
