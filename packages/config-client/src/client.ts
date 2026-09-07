/**
 * The reader every other service and the gateway use for city config and flags.
 *
 * Two behaviours matter more than anything else here:
 *
 *   getFlags  FAILS CLOSED. Unreachable service, timeout, 5xx, unparseable
 *             body — all resolve to DENY_ALL. A vertical is never rendered
 *             because the config service was down (CLAUDE.md #5, #12).
 *   getCityConfig REJECTS. It never invents a currency, fare or emergency
 *             number, and it never serves a cached config it could not
 *             revalidate. A caller that cannot get config must fail the
 *             request, not guess (CLAUDE.md #1, #6).
 */
import {
  type CityConfig,
  CityConfigSchema,
  ContractError,
  DENY_ALL,
  type ErrorCode,
  ERROR_CODES,
  type FlagSet,
} from "@ubi/contracts";
import { z } from "zod";

import { MemoryCache } from "./memory-cache";
import type {
  CacheStore,
  ConfigClientOptions,
  FetchLike,
  FlagQuery,
  InvalidationSubscriber,
} from "./types";

/**
 * Published by the config service on every activation and flag change. The
 * literal is duplicated there; both sides state it so neither package has to
 * depend on the other.
 */
export const CONFIG_INVALIDATION_CHANNEL = "ubi.config.invalidate";

const DEFAULT_TTL_SEC = 60;
const DEFAULT_TIMEOUT_MS = 2_000;

const FlagMapSchema = z.record(z.boolean());

const InvalidationMessageSchema = z.object({
  kind: z.enum(["config", "flags"]),
  scopeId: z.string().min(1),
});

const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);

interface CachedConfig {
  readonly config: CityConfig;
  readonly etag: string | undefined;
}

function configUnavailable(cityId: string, cause: string): ContractError {
  return new ContractError("config_unavailable", "city config is unavailable", {
    cityId,
    cause,
  });
}

/** Maps a service error body onto a canonical code, defaulting to config_unavailable. */
function codeFromBody(body: unknown): ErrorCode | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" && ERROR_CODE_SET.has(code)
    ? (code as ErrorCode)
    : undefined;
}

export class ConfigClient {
  private readonly baseUrl: string;
  private readonly ttlSec: number;
  private readonly timeoutMs: number;
  private readonly doFetch: FetchLike;
  private readonly store: CacheStore | undefined;
  private readonly serviceKey: string | undefined;
  private readonly now: () => number;

  private readonly configs = new MemoryCache<CachedConfig>(64);
  private readonly flags = new MemoryCache<FlagSet>(1_024);
  private readonly inFlight = new Map<string, Promise<CityConfig>>();

  constructor(options: ConfigClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.ttlSec = options.ttlSec ?? DEFAULT_TTL_SEC;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.doFetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.store = options.cache;
    this.serviceKey = options.serviceKey;
    this.now = options.now ?? (() => Date.now());
  }

  private configKey(cityId: string): string {
    return `ubi:config-client:city:${cityId}`;
  }

  private flagKey(query: FlagQuery): string {
    return `ubi:config-client:flags:${query.cityId ?? "-"}:${query.userId ?? "-"}`;
  }

  private async request(
    path: string,
    headers: Record<string, string>,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);
    try {
      return await this.doFetch(`${this.baseUrl}${path}`, {
        headers: { accept: "application/json", ...headers },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async readStore<T>(
    key: string,
    revive: (raw: unknown) => T | undefined,
  ): Promise<T | undefined> {
    if (this.store === undefined) return undefined;
    try {
      const raw = await this.store.get(key);
      if (raw === null) return undefined;
      return revive(JSON.parse(raw) as unknown);
    } catch {
      return undefined;
    }
  }

  private async writeStore(key: string, value: unknown): Promise<void> {
    if (this.store === undefined) return;
    try {
      await this.store.set(key, JSON.stringify(value), "EX", this.ttlSec);
    } catch {
      // A shared cache that is down is not a reason to fail a request.
    }
  }

  /**
   * The active config for a city. Resolves from the in-process cache, then the
   * shared cache, then the service with an ETag revalidation. Rejects rather
   * than returning anything it could not confirm.
   */
  async getCityConfig(cityId: string): Promise<CityConfig> {
    const key = this.configKey(cityId);
    const fresh = this.configs.fresh(key, this.now());
    if (fresh !== undefined) return fresh.value.config;

    const pending = this.inFlight.get(key);
    if (pending !== undefined) return pending;

    const load = this.loadCityConfig(cityId, key).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, load);
    return load;
  }

  private async loadCityConfig(
    cityId: string,
    key: string,
  ): Promise<CityConfig> {
    const shared = await this.readStore<CachedConfig>(key, (raw) => {
      if (typeof raw !== "object" || raw === null) return undefined;
      const candidate = raw as { config?: unknown; etag?: unknown };
      const parsed = CityConfigSchema.safeParse(candidate.config);
      if (!parsed.success) return undefined;
      return {
        config: parsed.data,
        etag: typeof candidate.etag === "string" ? candidate.etag : undefined,
      };
    });
    if (shared !== undefined) {
      this.configs.set(key, {
        value: shared,
        etag: shared.etag,
        expiresAt: this.now() + this.ttlSec * 1_000,
      });
      return shared.config;
    }

    const stale = this.configs.peek(key);
    const etag = stale?.etag;

    let response: Response;
    try {
      response = await this.request(
        `/v1/config/cities/${encodeURIComponent(cityId)}`,
        etag === undefined ? {} : { "if-none-match": etag },
      );
    } catch (err) {
      throw configUnavailable(
        cityId,
        err instanceof Error ? err.name : "request_failed",
      );
    }

    if (response.status === 304 && stale !== undefined) {
      this.configs.set(key, {
        ...stale,
        expiresAt: this.now() + this.ttlSec * 1_000,
      });
      await this.writeStore(key, stale.value);
      return stale.value.config;
    }

    if (!response.ok) {
      // A definitive 4xx is reported as itself — an unconfigured city is an
      // answer, not an outage — but it still rejects: no config is invented.
      const code =
        response.status < 500
          ? codeFromBody(await this.safeJson(response))
          : undefined;
      if (code !== undefined) {
        throw new ContractError(code, "city config is unavailable", { cityId });
      }
      throw configUnavailable(cityId, `http_${response.status}`);
    }

    const parsed = CityConfigSchema.safeParse(await this.safeJson(response));
    if (!parsed.success) {
      throw configUnavailable(cityId, "unparseable_config");
    }

    const entry: CachedConfig = {
      config: parsed.data,
      etag: response.headers.get("etag") ?? undefined,
    };
    this.configs.set(key, {
      value: entry,
      etag: entry.etag,
      expiresAt: this.now() + this.ttlSec * 1_000,
    });
    await this.writeStore(key, entry);
    return entry.config;
  }

  private async safeJson(response: Response): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch {
      return undefined;
    }
  }

  /**
   * Evaluated flags. Never throws: every failure resolves to DENY_ALL, so a
   * caller cannot accidentally open a vertical because config was unreachable.
   */
  async getFlags(query: FlagQuery = {}): Promise<FlagSet> {
    const key = this.flagKey(query);
    const fresh = this.flags.fresh(key, this.now());
    if (fresh !== undefined) return fresh.value;

    const shared = await this.readStore<FlagSet>(key, (raw) => {
      const parsed = FlagMapSchema.safeParse(raw);
      return parsed.success
        ? (Object.freeze(parsed.data) as FlagSet)
        : undefined;
    });
    if (shared !== undefined) {
      this.flags.set(key, {
        value: shared,
        etag: undefined,
        expiresAt: this.now() + this.ttlSec * 1_000,
      });
      return shared;
    }

    const search = new URLSearchParams();
    if (query.cityId !== undefined) search.set("cityId", query.cityId);
    if (query.userId !== undefined) search.set("userId", query.userId);
    const suffix = search.size === 0 ? "" : `?${search.toString()}`;

    try {
      const response = await this.request(`/v1/flags${suffix}`, {
        ...(this.serviceKey === undefined
          ? {}
          : { "x-service-key": this.serviceKey }),
        ...(query.userId === undefined ? {} : { "x-user-id": query.userId }),
      });
      if (!response.ok) return DENY_ALL;
      const parsed = FlagMapSchema.safeParse(await this.safeJson(response));
      if (!parsed.success) return DENY_ALL;
      const flags = Object.freeze(parsed.data) as FlagSet;
      this.flags.set(key, {
        value: flags,
        etag: undefined,
        expiresAt: this.now() + this.ttlSec * 1_000,
      });
      await this.writeStore(key, flags);
      return flags;
    } catch {
      return DENY_ALL;
    }
  }

  /**
   * Follow the service's invalidation channel so an activation is visible
   * immediately instead of after the TTL. Optional: the TTL alone is already
   * correct, this only makes it faster.
   */
  async watchInvalidations(subscriber: InvalidationSubscriber): Promise<void> {
    await subscriber.subscribe(CONFIG_INVALIDATION_CHANNEL);
    subscriber.on("message", (channel, message) => {
      if (channel !== CONFIG_INVALIDATION_CHANNEL) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(message) as unknown;
      } catch {
        // An unreadable notification is treated as "something changed".
        this.clearCache();
        return;
      }
      const result = InvalidationMessageSchema.safeParse(parsed);
      if (!result.success) {
        this.clearCache();
        return;
      }
      if (result.data.kind === "config") {
        this.configs.delete(this.configKey(result.data.scopeId));
        void this.dropShared(this.configKey(result.data.scopeId));
      } else {
        // Flag entries are per (city, user); drop every user of that city plus
        // the city-less evaluation. Shared entries are dropped for the keys this
        // process knows about — every other subscriber drops its own, and the
        // TTL bounds anything neither of them saw.
        const dropped = [
          ...this.flags.deleteByPrefix(
            `ubi:config-client:flags:${result.data.scopeId}:`,
          ),
          ...this.flags.deleteByPrefix("ubi:config-client:flags:-:"),
        ];
        void this.dropShared(...dropped);
      }
    });
  }

  private async dropShared(...keys: string[]): Promise<void> {
    if (this.store === undefined || keys.length === 0) return;
    try {
      await this.store.del(...keys);
    } catch {
      // Best effort; the TTL still bounds staleness.
    }
  }

  /** Drops the in-process caches. The shared cache is left to its TTL. */
  clearCache(): void {
    this.configs.clear();
    this.flags.clear();
  }
}

export function createConfigClient(options: ConfigClientOptions): ConfigClient {
  return new ConfigClient(options);
}
