/**
 * The fleet-service routes the portal uses, through the API gateway
 * (`/v1/fleets*`, services/api-gateway/src/routes/proxy-map.ts), typed with
 * the contract's response shapes (fleet-types.ts).
 *
 * Every response passes `stripForbidden` (privacy.ts) and every booking is
 * rebuilt from the OccupiedBlock allowlist before a screen sees it — and so
 * does every refusal's `details` (a 409 `needs_resolution` names the
 * bookings that hold a block, a 422 the shift it overlaps). Every
 * state-changing call takes the caller's idempotency key (idempotency.ts).
 *
 * Routes (services/fleet-service/src/routes/fleets.ts):
 *   GET  /v1/fleets                                   my fleets (with myRole)
 *   GET  /v1/fleets/:id                               one fleet
 *   GET  /v1/fleets/:id/overview                      counts; money unavailable
 *   GET  /v1/fleets/:id/calendar?…                    B1–B3
 *   GET  /v1/fleets/:id/vehicles  · POST (add)
 *   GET  /v1/fleets/:id/vehicles/:vid                 B4
 *   GET  /v1/fleets/:id/vehicles/:vid/availability    B4 (30 days)
 *   GET  /v1/fleets/:id/maintenance?vehicleId&status  B4 lists
 *   POST /v1/fleets/:id/maintenance:preview           B5 impact preview
 *   POST /v1/fleets/:id/maintenance                   B5 (201 | 409 needs_resolution)
 *   PATCH /v1/fleets/:id/maintenance/:bid             move (re-preview)
 *   POST /v1/fleets/:id/maintenance/:bid/confirm      re-check a held block
 *   POST /v1/fleets/:id/maintenance/:bid/cancel|complete
 *   POST /v1/fleets/:id/off-road                      B5 "Report off-road"
 *   GET  /v1/fleets/:id/conflicts?status              B6
 *   POST /v1/fleets/:id/conflicts/:cid/remind         ask_driver / remind
 *   POST /v1/fleets/:id/bookings/:blockId/vehicle-swaps  propose_vehicle_swap
 *   GET  /v1/fleets/:id/assignments                   B7 lists
 *   POST /v1/fleets/:id/assignments/propose           B7 (422 shift_overlap | above_city_cap)
 *   POST /v1/fleets/:id/assignments/proposals/:pid/withdraw
 *   POST /v1/fleets/:id/assignments/:aid/terminate    owner only
 *   GET  /v1/fleets/:id/utilisation?from&to           B8
 *   GET|PUT /v1/fleets/:id/staff                      B9
 */
import {
  ApiError,
  apiClient,
  type FleetApiClient,
  type RequestOptions,
} from "./api-client";
import { projectOccupiedBlocks, stripForbidden } from "./privacy";

import type {
  AddFleetVehicleInput,
  CalendarQuery,
  ConflictList,
  ConflictStatus,
  CreateMaintenanceInput,
  FleetAssignments,
  FleetCalendar,
  FleetList,
  FleetOverview,
  FleetStaffList,
  FleetVehicleList,
  FleetVehicleView,
  FleetView,
  MaintenanceBlockView,
  MaintenanceList,
  MaintenancePreviewView,
  MaintenanceWindowInput,
  OffRoadView,
  PatchMaintenanceInput,
  ProposalView,
  ProposeAssignmentInput,
  PutFleetStaffInput,
  ReminderView,
  ReportOffRoadInput,
  TerminationView,
  Utilisation,
  VehicleSwapRequestView,
} from "./fleet-types";

const enc = encodeURIComponent;

function query(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && entry[1] !== "",
  );
  return entries.length === 0
    ? ""
    : "?" +
        entries.map(([key, value]) => `${enc(key)}=${enc(value)}`).join("&");
}

/** A calendar with every booking rebuilt from the OccupiedBlock allowlist. */
export function sanitizeCalendar(raw: FleetCalendar): FleetCalendar {
  const clean = stripForbidden(raw);
  return {
    ...clean,
    rows: (clean.rows ?? []).map((row) => ({
      ...row,
      occupied: projectOccupiedBlocks(row.occupied),
    })),
  };
}

export function sanitizePreview(
  raw: MaintenancePreviewView,
): MaintenancePreviewView {
  const clean = stripForbidden(raw);
  return {
    ...clean,
    affectedBlocks: projectOccupiedBlocks(clean.affectedBlocks),
  };
}

/** Refusal details that list bookings (rebuilt from the allowlist). */
const BOOKING_LIST_DETAILS = ["affectedBlocks", "bookingsAfterNotice"] as const;

/**
 * A refusal with its `details` walked like a response body: forbidden keys
 * removed at any depth and every listed booking rebuilt from the
 * OccupiedBlock allowlist. Anything else is returned unchanged.
 */
export function sanitizeError(error: unknown): unknown {
  if (!(error instanceof ApiError) || error.details === null) {
    return error;
  }
  const details: Record<string, unknown> = {
    ...stripForbidden(error.details),
  };
  for (const key of BOOKING_LIST_DETAILS) {
    const list = details[key];
    if (Array.isArray(list)) {
      details[key] = projectOccupiedBlocks(list);
    }
  }
  return new ApiError(error.status, error.code, error.detail, details);
}

const rethrowSanitized = (error: unknown): never => {
  throw sanitizeError(error);
};

/** The client with every refusal sanitized before a screen can read it. */
function sanitizingClient(client: FleetApiClient): FleetApiClient {
  return {
    get: <T>(path: string, options?: RequestOptions) =>
      client.get<T>(path, options).catch(rethrowSanitized),
    post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
      client.post<T>(path, body, options).catch(rethrowSanitized),
    put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
      client.put<T>(path, body, options).catch(rethrowSanitized),
    patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
      client.patch<T>(path, body, options).catch(rethrowSanitized),
  };
}

export function calendarPath(fleetId: string, q: CalendarQuery): string {
  return (
    `/v1/fleets/${enc(fleetId)}/calendar` +
    query({
      from: q.from,
      to: q.to,
      zoom: q.zoom,
      rows: q.rows,
      layers: q.layers.join(","),
      class: q.vehicleClass,
      status: q.status,
      conflictsOnly: q.conflictsOnly ? "true" : undefined,
      q: q.q?.trim(),
      cursor: q.cursor,
      limit: String(q.limit),
    })
  );
}

export function createFleetApi(raw: FleetApiClient = apiClient) {
  const client = sanitizingClient(raw);
  const get = async <T>(path: string, signal?: AbortSignal): Promise<T> =>
    stripForbidden(await client.get<T>(path, { signal }));
  const post = async <T>(
    path: string,
    body: unknown,
    idempotencyKey: string,
  ): Promise<T> =>
    stripForbidden(await client.post<T>(path, body, { idempotencyKey }));
  const base = (fleetId: string) => `/v1/fleets/${enc(fleetId)}`;

  return {
    listFleets: (signal?: AbortSignal) => get<FleetList>("/v1/fleets", signal),
    fleet: (fleetId: string, signal?: AbortSignal) =>
      get<FleetView>(base(fleetId), signal),
    overview: (fleetId: string, signal?: AbortSignal) =>
      get<FleetOverview>(`${base(fleetId)}/overview`, signal),
    calendar: async (fleetId: string, q: CalendarQuery, signal?: AbortSignal) =>
      sanitizeCalendar(
        await get<FleetCalendar>(calendarPath(fleetId, q), signal),
      ),
    vehicles: (fleetId: string, signal?: AbortSignal) =>
      get<FleetVehicleList>(`${base(fleetId)}/vehicles`, signal),
    vehicle: (fleetId: string, vehicleId: string, signal?: AbortSignal) =>
      get<FleetVehicleView>(
        `${base(fleetId)}/vehicles/${enc(vehicleId)}`,
        signal,
      ),
    vehicleAvailability: async (
      fleetId: string,
      vehicleId: string,
      range: { from: string; to: string },
      signal?: AbortSignal,
    ) =>
      sanitizeCalendar(
        await get<FleetCalendar>(
          `${base(fleetId)}/vehicles/${enc(vehicleId)}/availability` +
            query(range),
          signal,
        ),
      ),
    addVehicle: (fleetId: string, body: AddFleetVehicleInput, key: string) =>
      post<FleetVehicleView>(`${base(fleetId)}/vehicles`, body, key),
    maintenance: (
      fleetId: string,
      filter: { vehicleId?: string; status?: string },
      signal?: AbortSignal,
    ) =>
      get<MaintenanceList>(
        `${base(fleetId)}/maintenance` + query(filter),
        signal,
      ),
    previewMaintenance: async (fleetId: string, body: MaintenanceWindowInput) =>
      // A preview changes nothing, so it carries no idempotency key.
      sanitizePreview(
        stripForbidden(
          await client.post<MaintenancePreviewView>(
            `${base(fleetId)}/maintenance:preview`,
            body,
          ),
        ),
      ),
    createMaintenance: (
      fleetId: string,
      body: CreateMaintenanceInput,
      key: string,
    ) => post<MaintenanceBlockView>(`${base(fleetId)}/maintenance`, body, key),
    moveMaintenance: async (
      fleetId: string,
      blockId: string,
      body: PatchMaintenanceInput,
      key: string,
    ) =>
      stripForbidden(
        await client.patch<MaintenanceBlockView>(
          `${base(fleetId)}/maintenance/${enc(blockId)}`,
          body,
          { idempotencyKey: key },
        ),
      ),
    confirmMaintenance: (
      fleetId: string,
      blockId: string,
      previewToken: string,
      key: string,
    ) =>
      post<MaintenanceBlockView>(
        `${base(fleetId)}/maintenance/${enc(blockId)}/confirm`,
        { previewToken },
        key,
      ),
    cancelMaintenance: (fleetId: string, blockId: string, key: string) =>
      post<MaintenanceBlockView>(
        `${base(fleetId)}/maintenance/${enc(blockId)}/cancel`,
        {},
        key,
      ),
    completeMaintenance: (fleetId: string, blockId: string, key: string) =>
      post<MaintenanceBlockView>(
        `${base(fleetId)}/maintenance/${enc(blockId)}/complete`,
        {},
        key,
      ),
    reportOffRoad: (fleetId: string, body: ReportOffRoadInput, key: string) =>
      post<OffRoadView>(`${base(fleetId)}/off-road`, body, key),
    conflicts: (
      fleetId: string,
      status: ConflictStatus | undefined,
      signal?: AbortSignal,
    ) =>
      get<ConflictList>(
        `${base(fleetId)}/conflicts` + query({ status }),
        signal,
      ),
    remind: (fleetId: string, conflictId: string, key: string) =>
      post<ReminderView>(
        `${base(fleetId)}/conflicts/${enc(conflictId)}/remind`,
        {},
        key,
      ),
    requestVehicleSwap: (
      fleetId: string,
      bookingBlockId: string,
      toVehicleId: string,
      key: string,
    ) =>
      post<VehicleSwapRequestView>(
        `${base(fleetId)}/bookings/${enc(bookingBlockId)}/vehicle-swaps`,
        { toVehicleId },
        key,
      ),
    assignments: (fleetId: string, signal?: AbortSignal) =>
      get<FleetAssignments>(`${base(fleetId)}/assignments`, signal),
    propose: (fleetId: string, body: ProposeAssignmentInput, key: string) =>
      post<ProposalView>(`${base(fleetId)}/assignments/propose`, body, key),
    withdrawProposal: (fleetId: string, proposalId: string, key: string) =>
      post<ProposalView>(
        `${base(fleetId)}/assignments/proposals/${enc(proposalId)}/withdraw`,
        {},
        key,
      ),
    terminate: async (fleetId: string, assignmentId: string, key: string) => {
      const view = await post<TerminationView>(
        `${base(fleetId)}/assignments/${enc(assignmentId)}/terminate`,
        {},
        key,
      );
      return {
        ...view,
        bookingsAfterNotice: projectOccupiedBlocks(view.bookingsAfterNotice),
      };
    },
    utilisation: (
      fleetId: string,
      range: { from?: string; to?: string },
      signal?: AbortSignal,
    ) =>
      get<Utilisation>(`${base(fleetId)}/utilisation` + query(range), signal),
    staff: (fleetId: string, signal?: AbortSignal) =>
      get<FleetStaffList>(`${base(fleetId)}/staff`, signal),
    putStaff: async (fleetId: string, body: PutFleetStaffInput, key: string) =>
      stripForbidden(
        await client.put<FleetStaffList>(`${base(fleetId)}/staff`, body, {
          idempotencyKey: key,
        }),
      ),
  };
}

export type FleetApi = ReturnType<typeof createFleetApi>;

export const fleetApi = createFleetApi();

/** TanStack query keys, one family per fleet so a switch never mixes caches. */
export const fleetKeys = {
  fleets: () => ["fleets"] as const,
  all: (fleetId: string) => ["fleet", fleetId] as const,
  overview: (fleetId: string) => ["fleet", fleetId, "overview"] as const,
  calendar: (fleetId: string, q: Omit<CalendarQuery, "cursor">) =>
    ["fleet", fleetId, "calendar", q] as const,
  vehicles: (fleetId: string) => ["fleet", fleetId, "vehicles"] as const,
  vehicle: (fleetId: string, vehicleId: string) =>
    ["fleet", fleetId, "vehicle", vehicleId] as const,
  vehicleAvailability: (fleetId: string, vehicleId: string, from: string) =>
    ["fleet", fleetId, "vehicle", vehicleId, "availability", from] as const,
  maintenance: (fleetId: string, vehicleId?: string) =>
    ["fleet", fleetId, "maintenance", vehicleId ?? "all"] as const,
  conflicts: (fleetId: string, status?: string) =>
    ["fleet", fleetId, "conflicts", status ?? "all"] as const,
  assignments: (fleetId: string) => ["fleet", fleetId, "assignments"] as const,
  utilisation: (fleetId: string) => ["fleet", fleetId, "utilisation"] as const,
  staff: (fleetId: string) => ["fleet", fleetId, "staff"] as const,
};
