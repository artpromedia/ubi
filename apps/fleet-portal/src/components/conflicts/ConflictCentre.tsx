"use client";

/**
 * B6 — the conflict centre: severity, conflict, subject, who resolves,
 * deadline (city time, zone labelled) and actions. Actions come only from
 * each conflict's `allowedActions`; a driver's or UBI's conflict is view
 * only (the fleet can look or send a reminder when the server allows it,
 * never resolve it for them). The server computes and sorts by deadline.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { useSelectedFleet } from "@/components/fleet/fleet-context";
import { EmptyState, Pill, ReadGate } from "@/components/states/states";
import { toReadState, type ReadState } from "@/lib/access";
import {
  conflictRow,
  conflictSummary,
  type ConflictNames,
} from "@/lib/conflicts-model";
import { fleetApi, fleetKeys } from "@/lib/fleet-api";
import { useNow, useOnlineStatus } from "@/lib/hooks";
import { FLEET_TEST_IDS } from "@/lib/test-ids";
import { localTimeOf, zoneShort } from "@/lib/time";

import { ConflictActions } from "./ConflictActions";

import type {
  ConflictList,
  ConflictStatus,
  FleetVehicleView,
  FleetView,
} from "@/lib/fleet-types";

const SEVERITY_TONE = {
  critical: "bad",
  high: "warn",
  medium: "info",
  blocked: "mute",
  status: "mute",
} as const;

export interface ConflictCentreViewProps {
  readonly fleet: FleetView;
  readonly state: ReadState<ConflictList>;
  readonly status: ConflictStatus | undefined;
  readonly onStatus: (status: ConflictStatus | undefined) => void;
  readonly names: ConflictNames;
  readonly vehicles: readonly FleetVehicleView[];
  readonly online: boolean;
  readonly onChanged?: () => void;
  readonly onRetry?: () => void;
}

const FILTERS: readonly { value: ConflictStatus | undefined; label: string }[] =
  [
    { value: "open", label: "Open" },
    { value: "resolving", label: "Resolving" },
    { value: "resolved", label: "Resolved" },
    { value: "lapsed", label: "Lapsed" },
    { value: undefined, label: "All" },
  ];

export const ConflictCentreView = ({
  fleet,
  state,
  status,
  onStatus,
  names,
  vehicles,
  online,
  onChanged,
  onRetry,
}: ConflictCentreViewProps) => (
  <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3">
      <h1 className="text-xl font-bold text-zinc-100">Conflict centre</h1>
      {state.kind === "ready" ? (
        <span className="text-xs text-zinc-400">
          {conflictSummary(state.data.conflicts)}
        </span>
      ) : null}
      {state.kind === "ready" ? (
        <span className="ml-auto text-xs text-zinc-500">
          Computed by server · {localTimeOf(state.updatedAt, fleet.zone)}{" "}
          {zoneShort(fleet.zone, state.updatedAt)}
        </span>
      ) : null}
    </div>
    <div className="flex gap-1" role="group" aria-label="Conflict status">
      {FILTERS.map((filter) => (
        <button
          key={filter.label}
          type="button"
          aria-pressed={status === filter.value}
          onClick={() => onStatus(filter.value)}
          className={
            status === filter.value
              ? "rounded-full bg-[#1DB954] px-3 py-1 text-xs font-semibold text-black"
              : "rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300"
          }
        >
          {filter.label}
        </button>
      ))}
    </div>
    <ReadGate
      state={state}
      loadingLabel="Loading conflicts…"
      context="conflicts"
      zone={fleet.zone}
      onRetry={onRetry}
    >
      {(data) =>
        data.conflicts.length === 0 ? (
          <EmptyState
            title={
              status === "open" || status === undefined
                ? "No open conflicts."
                : `No ${status} conflicts.`
            }
            body="The server opens a conflict when maintenance, a breakdown, a document or a notice period meets a booking."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#222] bg-[#141414]">
            <table className="w-full min-w-[900px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#222] text-left text-zinc-500">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Severity
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Conflict
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Who resolves
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Deadline ({zoneShort(fleet.zone, Date.now())})
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.conflicts.map((conflict) => {
                  const row = conflictRow(conflict, fleet.zone, names);
                  return (
                    <tr
                      key={conflict.conflictId}
                      data-testid={FLEET_TEST_IDS.conflicts.row}
                      className="border-b border-[#1F1F1F] align-top"
                    >
                      <td className="px-3 py-2">
                        <Pill tone={SEVERITY_TONE[row.severityKey]}>
                          {row.severity}
                        </Pill>
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-semibold text-zinc-100">
                          {row.title}
                        </p>
                        <p className="text-zinc-400">{row.subject}</p>
                        <p className="text-zinc-500">{row.status}</p>
                      </td>
                      <td className="px-3 py-2 text-zinc-300">
                        {row.resolver}
                      </td>
                      <td className="px-3 py-2 font-mono text-zinc-300">
                        {row.deadline}
                      </td>
                      <td className="px-3 py-2">
                        {row.noActionText !== null ? (
                          <span className="text-zinc-500">
                            {row.noActionText}
                          </span>
                        ) : (
                          <ConflictActions
                            fleetId={fleet.fleetId}
                            conflict={conflict}
                            zone={fleet.zone}
                            online={online}
                            vehicles={vehicles}
                            onDone={onChanged}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      }
    </ReadGate>
  </div>
);

export const ConflictCentreScreen = () => {
  const fleet = useSelectedFleet();
  const online = useOnlineStatus();
  useNow(60_000);
  const client = useQueryClient();
  const [status, setStatus] = useState<ConflictStatus | undefined>("open");
  const conflicts = useQuery({
    queryKey: fleetKeys.conflicts(fleet.fleetId, status),
    queryFn: ({ signal }) => fleetApi.conflicts(fleet.fleetId, status, signal),
    refetchInterval: 60_000,
  });
  const vehicles = useQuery({
    queryKey: fleetKeys.vehicles(fleet.fleetId),
    queryFn: ({ signal }) => fleetApi.vehicles(fleet.fleetId, signal),
  });
  const assignments = useQuery({
    queryKey: fleetKeys.assignments(fleet.fleetId),
    queryFn: ({ signal }) => fleetApi.assignments(fleet.fleetId, signal),
  });
  const names = useMemo<ConflictNames>(
    () => ({
      plates: new Map(
        (vehicles.data?.vehicles ?? []).map((vehicle) => [
          vehicle.vehicleId,
          vehicle.plate,
        ]),
      ),
      drivers: new Map(
        (assignments.data?.arrangements ?? []).map((arrangement) => [
          arrangement.driverId,
          arrangement.driverDisplayName,
        ]),
      ),
    }),
    [vehicles.data, assignments.data],
  );
  return (
    <ConflictCentreView
      fleet={fleet}
      state={toReadState(conflicts, online, "conflicts")}
      status={status}
      onStatus={setStatus}
      names={names}
      vehicles={vehicles.data?.vehicles ?? []}
      online={online}
      onChanged={() =>
        void client.invalidateQueries({
          queryKey: fleetKeys.all(fleet.fleetId),
        })
      }
      onRetry={() => void conflicts.refetch()}
    />
  );
};
