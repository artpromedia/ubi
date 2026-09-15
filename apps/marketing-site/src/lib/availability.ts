/**
 * Server-only. Everything the site says about availability comes from
 * config-service at request time, through the Next.js data cache:
 *
 *  - `GET /v1/config/cities`            city rows with `status`
 *  - `GET /v1/config/cities/{cityId}`   the active config version
 *  - `GET /v1/flags?cityId=`            evaluated flags (deny-by-default)
 *
 * Each read is cached for REVALIDATE_SECONDS under the "availability" tag and
 * purged on demand by POST /api/revalidate (driven by config.version_activated,
 * flag.changed and city.status_changed events). A failed read THROWS inside the
 * cached function so an outage is never cached as an answer; the page then
 * states that availability cannot be confirmed. Fares are never returned to a
 * page: `rideFacts` picks the fields a card may print.
 */
import "server-only";

import {
  CityConfigSchema,
  CitySummarySchema,
  DENY_ALL,
  FLAG_KEYS,
  type CityConfig,
  type CityStatus,
  type CitySummary,
  type FlagSet,
} from "@ubi/contracts";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { z } from "zod";

import {
  type ServiceInfo,
  findCityRow,
  servicesFrom,
} from "./availability-pure";
import { AVAILABILITY_TAG, REVALIDATE_SECONDS } from "./cache-tags";

export { AVAILABILITY_TAG, REVALIDATE_SECONDS };

export type CityRow = CitySummary;
export type { CityStatus };

export type CityAvailability =
  | {
      readonly status: "pre_launch";
      readonly cityId: string;
      readonly cityName: string;
      readonly stage: "launching" | "planned" | "paused";
      /** Every city in the same launch group, in row order (they go live together). */
      readonly launchGroupNames: readonly string[];
    }
  | {
      readonly status: "ok";
      readonly cityId: string;
      readonly cityName: string;
      readonly region: string | null;
      readonly timezone: string;
      readonly config: CityConfig;
      readonly flags: FlagSet;
      readonly services: readonly ServiceInfo[];
      readonly checkedAt: string;
    }
  | { readonly status: "unknown_city"; readonly cityId: string }
  | {
      readonly status: "error";
      readonly cityId: string;
      readonly cityName?: string;
      readonly reason: string;
    };

/**
 * Everything about a city that does not need its flags: rows and the active
 * config. The page shell renders from this immediately; flags stream behind
 * Suspense through `getCityAvailability`.
 */
export type CityContext =
  | Extract<
      CityAvailability,
      { status: "pre_launch" | "unknown_city" | "error" }
    >
  | {
      readonly status: "ok";
      readonly cityId: string;
      readonly cityName: string;
      readonly region: string | null;
      readonly timezone: string;
      readonly config: CityConfig;
    };

/** Thrown inside a cached read so the failure is never stored. */
export class UpstreamError extends Error {
  constructor(
    readonly reason: string,
    readonly httpStatus: number,
  ) {
    super(reason);
    this.name = "UpstreamError";
  }
}

type Fetched =
  | { readonly ok: true; readonly json: unknown }
  | { readonly ok: false; readonly status: number };

async function readConfigService(path: string): Promise<Fetched> {
  const base = process.env.UBI_CONFIG_BASE_URL?.trim();
  if (!base) return { ok: false, status: 0 };
  const token = process.env.UBI_CONFIG_SERVICE_TOKEN?.trim();
  try {
    const response = await fetch(new URL(path, base), {
      headers: {
        accept: "application/json",
        ...(token
          ? { "x-service-key": token, authorization: `Bearer ${token}` }
          : {}),
      },
      // The data cache is the unstable_cache wrapper around each reader; the
      // fetch itself must not add a second, tagless layer.
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, json: (await response.json()) as unknown };
  } catch {
    return { ok: false, status: 0 };
  }
}

const cityRowsRead = unstable_cache(
  async (): Promise<CitySummary[]> => {
    const result = await readConfigService("/v1/config/cities");
    if (!result.ok) {
      throw new UpstreamError(
        `cities_unreachable_${result.status}`,
        result.status,
      );
    }
    const parsed = z.array(CitySummarySchema).safeParse(result.json);
    if (!parsed.success) throw new UpstreamError("cities_invalid", 200);
    return parsed.data;
  },
  ["marketing", "config-cities"],
  { revalidate: REVALIDATE_SECONDS, tags: [AVAILABILITY_TAG] },
);

const cityConfigRead = unstable_cache(
  async (cityId: string): Promise<CityConfig | null> => {
    const result = await readConfigService(
      `/v1/config/cities/${encodeURIComponent(cityId)}`,
    );
    if (!result.ok) {
      // 404 is a real answer (no such city / no activated config): cacheable,
      // and purged by the next city.status_changed or activation event.
      if (result.status === 404) return null;
      throw new UpstreamError(
        `config_unreachable_${result.status}`,
        result.status,
      );
    }
    const parsed = CityConfigSchema.safeParse(result.json);
    if (!parsed.success) throw new UpstreamError("config_invalid", 200);
    return parsed.data;
  },
  ["marketing", "config-city"],
  { revalidate: REVALIDATE_SECONDS, tags: [AVAILABILITY_TAG] },
);

const flagsRead = unstable_cache(
  async (cityId: string): Promise<FlagSet> => {
    const result = await readConfigService(
      `/v1/flags?cityId=${encodeURIComponent(cityId)}`,
    );
    // Unreachable flags ⇒ DENY_ALL ⇒ nothing may be called live. The page shows
    // the "cannot confirm" notice instead of a grid, so this throws.
    if (!result.ok) {
      throw new UpstreamError(
        `flags_unreachable_${result.status}`,
        result.status,
      );
    }
    const parsed = z.record(z.boolean()).safeParse(result.json);
    if (!parsed.success) throw new UpstreamError("flags_invalid", 200);
    const flags: Record<string, boolean> = { ...DENY_ALL };
    for (const key of FLAG_KEYS) flags[key] = parsed.data[key] === true;
    return flags as FlagSet;
  },
  ["marketing", "config-flags"],
  { revalidate: REVALIDATE_SECONDS, tags: [AVAILABILITY_TAG] },
);

/** All city rows with status. Unreachable ⇒ [] (callers render a status notice). */
export async function listCities(): Promise<CityRow[]> {
  try {
    return await cityRowsRead();
  } catch {
    return [];
  }
}

/** Cities that are live: footer links, carousel on /cities, driver page default. */
export async function listActiveCities(): Promise<CityRow[]> {
  return (await listCities()).filter((city) => city.status === "active");
}

/** Rows and config only (no flags). Memoised per request with React cache(). */
export const getCityContext = cache(
  async (cityParam: string): Promise<CityContext> => {
    let rows: CitySummary[];
    try {
      rows = await cityRowsRead();
    } catch (error) {
      return {
        status: "error",
        cityId: cityParam.toUpperCase(),
        reason:
          error instanceof UpstreamError ? error.reason : "cities_unreachable",
      };
    }
    // A slug of the name (/cities/lagos) or the id in any case (/cities/los).
    const row = findCityRow(rows, cityParam);
    if (row === undefined) {
      return { status: "unknown_city", cityId: cityParam.toUpperCase() };
    }
    const cityId = row.id;

    if (row.status !== "active") {
      const launchGroupNames =
        row.launchGroup === null
          ? [row.name]
          : rows
              .filter((city) => city.launchGroup === row.launchGroup)
              .map((city) => city.name);
      return {
        status: "pre_launch",
        cityId,
        cityName: row.name,
        stage: row.status,
        launchGroupNames,
      };
    }

    try {
      const config = await cityConfigRead(cityId);
      if (config === null) return { status: "unknown_city", cityId };
      return {
        status: "ok",
        cityId,
        cityName: row.name,
        region: row.region,
        timezone: config.timezone,
        config,
      };
    } catch (error) {
      return {
        status: "error",
        cityId,
        cityName: row.name,
        reason:
          error instanceof UpstreamError ? error.reason : "config_unreachable",
      };
    }
  },
);

/** Context plus evaluated flags. Memoised per request with React cache(). */
export const getCityAvailability = cache(
  async (cityIdRaw: string): Promise<CityAvailability> => {
    const context = await getCityContext(cityIdRaw);
    if (context.status !== "ok") return context;
    try {
      const flags = await flagsRead(context.cityId);
      return {
        ...context,
        flags,
        services: servicesFrom(flags),
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: "error",
        cityId: context.cityId,
        cityName: context.cityName,
        reason:
          error instanceof UpstreamError ? error.reason : "flags_unreachable",
      };
    }
  },
);

export {
  SERVICE_LABEL,
  cityPath,
  citySlug,
  findCityRow,
  joinNames,
  liveServices,
  rideFacts,
  servicesFrom,
  type RideFacts,
  type ServiceInfo,
  type ServiceKey,
  type ServiceStatus,
} from "./availability-pure";
