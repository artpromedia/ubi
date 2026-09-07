/**
 * Versioned city configuration.
 *
 * Invariants this module exists to hold:
 *  - An activated version is immutable. A change never UPDATEs a row; it
 *    inserts version N+1 and the previous rows stay exactly as they were.
 *  - A patch is validated against `CityConfigSchema` when the change request is
 *    created *and* again at activation, so a config the apps cannot parse can
 *    never become active.
 *  - Two distinct approvers who are not the author are required, and the
 *    activation, its audit row and its outbox row are one transaction.
 */
import { Prisma } from "@prisma/client";
import {
  type CityConfig,
  CityConfigSchema,
  ContractError,
  scopedIdempotencyKey,
} from "@ubi/contracts";

import { configCache } from "../lib/cache";
import { strongEtag } from "../lib/etag";
import { deterministicId, newId } from "../lib/ids";
import {
  type DiffEntry,
  type JsonObject,
  applyPatch,
  asJsonObject,
  diffJson,
  jsonEqual,
} from "../lib/json";
import { configLogger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import type { Actor } from "../middleware/actor";
import { type Tx, writeAudit } from "./audit";
import { writeOutboxEvent } from "./outbox";

/** Approvals required before a change request activates, the author excluded. */
export const REQUIRED_APPROVALS = 2;

const CHANGE_REQUEST_STATUS = {
  pending: "pending",
  approved: "approved",
  rejected: "rejected",
  activated: "activated",
} as const;

/** Server-assigned fields: a patch that tries to set them is refused. */
const SERVER_OWNED_KEYS = ["cityId", "version"] as const;

export interface ActiveConfig {
  readonly version: number;
  readonly config: CityConfig;
  readonly etag: string;
  readonly activatedAt: string;
}

export interface ChangeRequestView {
  readonly id: string;
  readonly cityId: string;
  readonly status: string;
  readonly reason: string;
  readonly authorId: string;
  readonly createdAt: string;
  readonly approvalsRequired: number;
  readonly approvals: number;
  readonly replayed: boolean;
}

export interface ApprovalResult {
  readonly requestId: string;
  readonly cityId: string;
  readonly status: string;
  readonly approvals: number;
  readonly approvalsRequired: number;
  readonly activated: boolean;
  readonly version: number | null;
  readonly diff: readonly DiffEntry[];
}

export interface HistoryEntry {
  readonly version: number;
  readonly activatedAt: string | null;
  readonly authoredBy: string;
  readonly approvedBy: string | null;
  readonly approvers: readonly string[];
  readonly reason: string | null;
}

function parseStoredConfig(cityId: string, version: number, stored: unknown): CityConfig {
  const parsed = CityConfigSchema.safeParse(stored);
  if (!parsed.success) {
    // Only reachable if a row was written around this service.
    configLogger.error({ cityId, version }, "activated config row does not parse");
    throw new ContractError("internal_error", "stored city config is not readable");
  }
  return parsed.data;
}

async function cityExists(cityId: string): Promise<boolean> {
  return (await prisma.city.count({ where: { id: cityId } })) > 0;
}

/** The active version is the highest-numbered activated one; nothing is mutated to "deactivate". */
async function loadActiveRow(
  client: Tx,
  cityId: string,
): Promise<{ version: number; config: unknown; activatedAt: Date } | undefined> {
  const row = await client.cityConfigVersion.findFirst({
    where: { cityId, activatedAt: { not: null } },
    orderBy: { version: "desc" },
  });
  if (row === null || row.activatedAt === null) return undefined;
  return { version: row.version, config: row.config, activatedAt: row.activatedAt };
}

async function loadActiveConfig(cityId: string): Promise<ActiveConfig> {
  const row = await loadActiveRow(prisma, cityId);
  if (row === undefined) {
    if (!(await cityExists(cityId))) {
      throw new ContractError("city_unsupported", "city is not configured", { cityId });
    }
    throw new ContractError("not_found", "city has no activated config version", { cityId });
  }
  const config = parseStoredConfig(cityId, row.version, row.config);
  return {
    version: row.version,
    config,
    etag: strongEtag(config),
    activatedAt: row.activatedAt.toISOString(),
  };
}

/** Read-through Redis cache; a miss after an activation can never serve the old version. */
export async function getActiveConfig(cityId: string): Promise<ActiveConfig> {
  return configCache.read<ActiveConfig>(
    { kind: "config", scopeId: cityId },
    () => loadActiveConfig(cityId),
    (raw) => {
      if (typeof raw !== "object" || raw === null) return undefined;
      const candidate = raw as Partial<ActiveConfig>;
      const parsed = CityConfigSchema.safeParse(candidate.config);
      if (!parsed.success) return undefined;
      if (typeof candidate.version !== "number" || typeof candidate.activatedAt !== "string") {
        return undefined;
      }
      return {
        version: candidate.version,
        config: parsed.data,
        etag: strongEtag(parsed.data),
        activatedAt: candidate.activatedAt,
      };
    },
  );
}

async function nextVersion(client: Tx, cityId: string): Promise<number> {
  const highest = await client.cityConfigVersion.findFirst({
    where: { cityId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return (highest?.version ?? 0) + 1;
}

/**
 * Merge the patch onto the current active config and validate the result.
 * Throws `validation_failed` with the schema issues when the patch would
 * produce a config the apps cannot parse.
 */
export function buildCandidate(
  cityId: string,
  version: number,
  base: JsonObject,
  patch: JsonObject,
): CityConfig {
  const merged = applyPatch(base, patch);
  merged["cityId"] = cityId;
  merged["version"] = version;
  const parsed = CityConfigSchema.safeParse(merged);
  if (!parsed.success) {
    throw new ContractError(
      "validation_failed",
      "patch does not produce a valid city config",
      {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    );
  }
  return parsed.data;
}

function rejectServerOwnedKeys(patch: JsonObject): void {
  const attempted = SERVER_OWNED_KEYS.filter((key) => key in patch);
  if (attempted.length > 0) {
    throw new ContractError(
      "validation_failed",
      "cityId and version are assigned by the server",
      { fields: attempted },
    );
  }
}

export interface CreateChangeRequestInput {
  readonly cityId: string;
  readonly patch: JsonObject;
  readonly reason: string;
  readonly actor: Actor;
  readonly idempotencyKey: string;
}

export async function createChangeRequest(
  input: CreateChangeRequestInput,
): Promise<ChangeRequestView> {
  const { cityId, patch, reason, actor } = input;
  if (!(await cityExists(cityId))) {
    throw new ContractError("city_unsupported", "city is not configured", { cityId });
  }
  rejectServerOwnedKeys(patch);

  const active = await loadActiveRow(prisma, cityId);
  const base = active === undefined ? {} : asJsonObject(active.config);
  // Validated now, at request time — not at activation.
  buildCandidate(cityId, (active?.version ?? 0) + 1, base, patch);

  const id = deterministicId(
    "ccr",
    scopedIdempotencyKey("config.change_request", actor.id, input.idempotencyKey),
  );

  const existing = await prisma.configChangeRequest.findUnique({
    where: { id },
    include: { _count: { select: { approvals: true } } },
  });
  if (existing !== null) {
    const sameRequest =
      existing.cityId === cityId &&
      existing.authorId === actor.id &&
      existing.reason === reason &&
      jsonEqual(existing.patch, patch);
    if (!sameRequest) {
      throw new ContractError(
        "idempotency_key_reuse",
        "idempotency key was already used with a different change request",
        { requestId: existing.id },
      );
    }
    return {
      id: existing.id,
      cityId: existing.cityId,
      status: existing.status,
      reason: existing.reason,
      authorId: existing.authorId,
      createdAt: existing.createdAt.toISOString(),
      approvalsRequired: REQUIRED_APPROVALS,
      approvals: existing._count.approvals,
      replayed: true,
    };
  }

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.configChangeRequest.create({
      data: {
        id,
        cityId,
        patch: patch as Prisma.InputJsonValue,
        reason,
        authorId: actor.id,
        status: CHANGE_REQUEST_STATUS.pending,
      },
    });
    // A proposal changes no config, so it raises no domain event — EVENT_NAMES is
    // closed and has none for it — but it is still audited.
    await writeAudit(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      action: "config.change_requested",
      subjectType: "config",
      subjectId: row.id,
      after: patch as Prisma.InputJsonValue,
      reason,
    });
    return row;
  });

  return {
    id: created.id,
    cityId: created.cityId,
    status: created.status,
    reason: created.reason,
    authorId: created.authorId,
    createdAt: created.createdAt.toISOString(),
    approvalsRequired: REQUIRED_APPROVALS,
    approvals: 0,
    replayed: false,
  };
}

export interface ApproveChangeRequestInput {
  readonly requestId: string;
  readonly actor: Actor;
}

export async function approveChangeRequest(
  input: ApproveChangeRequestInput,
): Promise<ApprovalResult> {
  const { requestId, actor } = input;

  const request = await prisma.configChangeRequest.findUnique({ where: { id: requestId } });
  if (request === null) {
    throw new ContractError("not_found", "change request not found", { requestId });
  }
  if (request.authorId === actor.id) {
    throw new ContractError(
      "approver_is_author",
      "the author of a change request cannot approve it",
      { requestId },
    );
  }
  if (request.status !== CHANGE_REQUEST_STATUS.pending) {
    throw new ContractError("conflict", `change request is ${request.status}`, {
      requestId,
      status: request.status,
    });
  }

  const result = await prisma
    .$transaction(
      async (tx) => {
        const current = await tx.configChangeRequest.findUnique({ where: { id: requestId } });
        if (current === null || current.status !== CHANGE_REQUEST_STATUS.pending) {
          throw new ContractError("conflict", "change request is no longer pending", {
            requestId,
            status: current?.status ?? "missing",
          });
        }

        const approvalId = deterministicId("cap", requestId, actor.id);
        try {
          await tx.configApproval.create({
            data: { id: approvalId, requestId, approverId: actor.id },
          });
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            (err.code === "P2002" || err.code === "P2010")
          ) {
            throw new ContractError("already_approved", "this approver already approved", {
              requestId,
            });
          }
          throw err;
        }

        const approvals = await tx.configApproval.count({ where: { requestId } });
        if (approvals < REQUIRED_APPROVALS) {
          return {
            requestId,
            cityId: current.cityId,
            status: current.status,
            approvals,
            approvalsRequired: REQUIRED_APPROVALS,
            activated: false,
            version: null,
            diff: [] as DiffEntry[],
          } satisfies ApprovalResult;
        }

        const approvers = (
          await tx.configApproval.findMany({
            where: { requestId },
            orderBy: { createdAt: "asc" },
            select: { approverId: true },
          })
        ).map((row) => row.approverId);

        const active = await loadActiveRow(tx, current.cityId);
        const baseConfig = active === undefined ? {} : asJsonObject(active.config);
        const version = await nextVersion(tx, current.cityId);
        // Re-validated against the config that is active *now*, not the one that
        // was active when the request was raised.
        const candidate = buildCandidate(
          current.cityId,
          version,
          baseConfig,
          asJsonObject(current.patch),
        );
        const diff = diffJson(baseConfig, candidate as unknown as JsonObject);

        const activatedAt = new Date();
        const created = await tx.cityConfigVersion.create({
          data: {
            id: newId("ccv"),
            cityId: current.cityId,
            version,
            config: candidate as unknown as Prisma.InputJsonValue,
            activatedAt,
            createdBy: current.authorId,
            approvedBy: actor.id,
          },
        });

        await tx.configChangeRequest.update({
          where: { id: requestId },
          data: { status: CHANGE_REQUEST_STATUS.activated },
        });

        await writeAudit(tx, {
          actorId: actor.id,
          actorRole: actor.role,
          action: "config.version_activated",
          subjectType: "config",
          subjectId: created.id,
          before:
            active === undefined
              ? undefined
              : ({ version: active.version, config: baseConfig } as Prisma.InputJsonValue),
          after: {
            version,
            config: candidate,
            requestId,
            authoredBy: current.authorId,
            approvers,
          } as unknown as Prisma.InputJsonValue,
          reason: current.reason,
        });

        await writeOutboxEvent(tx, {
          name: "config.version_activated",
          subjectType: "config",
          subjectId: current.cityId,
          actorType: "agent",
          actorId: actor.id,
          // Derived from the request, so a retry of the same activation can never
          // produce a second event.
          idempotencyKey: `config.version_activated:${requestId}`,
          fromVersion: active?.version ?? null,
          toVersion: version,
          cityId: current.cityId,
          payload: {
            cityId: current.cityId,
            version,
            diff,
            by: [current.authorId, ...approvers],
          },
          occurredAt: activatedAt,
        });

        return {
          requestId,
          cityId: current.cityId,
          status: CHANGE_REQUEST_STATUS.activated,
          approvals,
          approvalsRequired: REQUIRED_APPROVALS,
          activated: true,
          version,
          diff,
        } satisfies ApprovalResult;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    .catch((err: unknown) => {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2002") {
          // A concurrent activation took this version number or this approval.
          throw new ContractError("conflict", "concurrent config change; retry", {
            requestId,
          });
        }
        if (err.code === "P2034") {
          throw new ContractError("conflict", "concurrent config change; retry", { requestId });
        }
      }
      throw err;
    });

  if (result.activated) {
    await configCache.invalidate(
      { kind: "config", scopeId: result.cityId },
      { kind: "config", scopeId: result.cityId, ...(result.version === null ? {} : { version: result.version }) },
    );
    configLogger.info(
      { cityId: result.cityId, version: result.version, requestId },
      "city config version activated",
    );
  }

  return result;
}

export async function getHistory(cityId: string): Promise<readonly HistoryEntry[]> {
  if (!(await cityExists(cityId))) {
    throw new ContractError("city_unsupported", "city is not configured", { cityId });
  }
  const versions = await prisma.cityConfigVersion.findMany({
    where: { cityId },
    orderBy: { version: "desc" },
  });
  if (versions.length === 0) return [];

  // The version row records the activating approver; the full approver list
  // lives on the audit row written in the same transaction.
  const audits = await prisma.auditLog.findMany({
    where: {
      subjectType: "config",
      subjectId: { in: versions.map((version) => version.id) },
      action: "config.version_activated",
    },
  });
  const auditBySubject = new Map(audits.map((row) => [row.subjectId, row]));

  return versions.map((version) => {
    const audit = auditBySubject.get(version.id);
    const after = asJsonObject(audit?.after);
    const approvers = Array.isArray(after["approvers"])
      ? (after["approvers"] as unknown[]).filter((value): value is string => typeof value === "string")
      : [];
    return {
      version: version.version,
      activatedAt: version.activatedAt?.toISOString() ?? null,
      authoredBy: version.createdBy,
      approvedBy: version.approvedBy,
      approvers,
      reason: audit?.reason ?? null,
    } satisfies HistoryEntry;
  });
}
