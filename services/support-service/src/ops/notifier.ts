/**
 * Safety notification port.
 *
 * CLAUDE.md #9: SOS is durable — retried, with SMS fallback. Push is a
 * best-effort channel on a phone that may be off, out of credit, or in the
 * attacker's hand, so it is never the only channel and never the thing that
 * decides whether the incident exists.
 *
 * The contract here is deliberately blunt: `deliver` either resolves (the
 * channel accepted the alert) or throws (it did not). The caller decides what a
 * failure means, records it durably and retries; this port has no opinion.
 */
import { ContractError } from "@ubi/contracts";

import { safetyLogger } from "../lib/logger";

import type { SafetySeverity } from "./city-config";

export const NOTIFY_CHANNELS = ["push", "sms"] as const;
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];

export interface SafetyAlert {
  readonly caseId: string;
  readonly severity: SafetySeverity;
  readonly cityId: string;
  /** Who must be woken up: the 24/7 responder queue, and the person who raised it. */
  readonly audience: readonly {
    readonly userType: string;
    readonly userId: string;
  }[];
  /**
   * The number a responder is told to call. It comes from city config (Lagos:
   * 112) and is null only when the config could not be read — in which case the
   * responder is told that, rather than being given a number from a code
   * constant.
   */
  readonly emergencyNumber: string | null;
  readonly rideId: string | null;
}

export interface SafetyNotifier {
  deliver(channel: NotifyChannel, alert: SafetyAlert): Promise<void>;
}

interface NotifierHttpOptions {
  readonly baseUrl: string;
  readonly path?: string;
  readonly serviceKey?: string | undefined;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Posts the alert to notification-service. The body carries ids, a severity and
 * an emergency number — never the location, the names or anything else a
 * notification pipeline has no business logging (CLAUDE.md #6, #12).
 */
export function createHttpNotifier(options: NotifierHttpOptions): SafetyNotifier {
  const doFetch = options.fetchImpl ?? fetch;
  const path = options.path ?? "/v1/notifications/safety";
  const timeoutMs = options.timeoutMs ?? 5_000;

  return {
    async deliver(channel: NotifyChannel, alert: SafetyAlert): Promise<void> {
      const url = `${options.baseUrl.replace(/\/+$/, "")}${path}`;
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "X-City-ID": alert.cityId,
      };
      if (options.serviceKey !== undefined) {
        headers["X-Service-Key"] = options.serviceKey;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      try {
        const response = await doFetch(url, {
          method: "POST",
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            channel,
            caseId: alert.caseId,
            severity: alert.severity,
            rideId: alert.rideId,
            emergencyNumber: alert.emergencyNumber,
            audience: alert.audience,
          }),
        });
        if (!response.ok) {
          throw new ContractError(
            "service_unavailable",
            `notification channel ${channel} refused the alert`,
            { status: response.status, channel },
          );
        }
      } catch (error) {
        if (error instanceof ContractError) {
          throw error;
        }
        safetyLogger.error({ err: error, channel }, "safety notification failed");
        throw new ContractError(
          "service_unavailable",
          `notification channel ${channel} is not reachable`,
          { channel },
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
