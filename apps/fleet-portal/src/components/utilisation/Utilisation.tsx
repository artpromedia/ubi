"use client";

/**
 * B8 — utilisation per vehicle: the hours the server measured for each
 * metric, each metric's definition, the data's asOf, and "Not enough data"
 * for a vehicle with less than 7 days. A metric the server can't measure yet
 * is named as unavailable (with the server's reason), never drawn as zero.
 * No benchmarks or targets are shown.
 */
import { useQuery } from "@tanstack/react-query";

import { useSelectedFleet } from "@/components/fleet/fleet-context";
import { EmptyState, ReadGate } from "@/components/states/states";
import { toReadState, type ReadState } from "@/lib/access";
import { fleetApi, fleetKeys } from "@/lib/fleet-api";
import { useOnlineStatus } from "@/lib/hooks";
import { FLEET_TEST_IDS } from "@/lib/test-ids";
import { dateTimeIn, localDateOf, shortDate, zoneShort } from "@/lib/time";
import { definitionList, utilisationRows } from "@/lib/utilisation-model";
import { cn } from "@/lib/utils";

import type {
  FleetView,
  Utilisation,
  UtilisationMetric,
} from "@/lib/fleet-types";

const SEGMENT: Readonly<Record<UtilisationMetric, string>> = {
  onTrip: "bg-[#1DB954] text-black",
  onlineIdle: "bg-[#86EFAC] text-black",
  bookedAhead: "bg-[#8FA3E6] text-black",
  maintenance: "fleet-block-maintenance",
  offline: "bg-zinc-700 text-zinc-100",
};

export const UtilisationView = ({
  fleet,
  state,
  onRetry,
}: {
  readonly fleet: FleetView;
  readonly state: ReadState<Utilisation>;
  readonly onRetry?: () => void;
}) => (
  <div className="space-y-4">
    <h1 className="text-xl font-bold text-zinc-100">Utilisation</h1>
    <ReadGate
      state={state}
      loadingLabel="Loading utilisation…"
      context="utilisation"
      zone={fleet.zone}
      onRetry={onRetry}
    >
      {(data) => {
        const rows = utilisationRows(data);
        const from = localDateOf(new Date(data.from).getTime(), data.zone);
        const to = localDateOf(new Date(data.to).getTime() - 1, data.zone);
        return (
          <div className="space-y-4">
            <p className="text-xs text-zinc-400">
              {shortDate(from)} – {shortDate(to)} · Data as of{" "}
              {dateTimeIn(data.asOf, data.zone)}{" "}
              {zoneShort(data.zone, new Date(data.asOf).getTime())}
            </p>
            {rows.length === 0 ? (
              <EmptyState title="No vehicles yet. Add a vehicle to start planning." />
            ) : (
              <ul className="space-y-2 rounded-xl border border-[#222] bg-[#141414] p-3">
                {rows.map((row) => (
                  <li
                    key={row.vehicleId}
                    data-testid={FLEET_TEST_IDS.utilisation.vehicleBar}
                    className="grid grid-cols-[110px_1fr] items-start gap-3 text-xs"
                  >
                    <span className="pt-1 font-mono font-semibold text-zinc-100">
                      {row.plate}
                    </span>
                    <div className="space-y-1">
                      {row.enoughData ? (
                        <>
                          <div className="flex h-6 overflow-hidden rounded bg-[#1C1C1C]">
                            {row.segments.map((segment) => (
                              <span
                                key={segment.metric}
                                className={cn(
                                  "flex items-center truncate px-1 text-[10.5px] font-medium",
                                  SEGMENT[segment.metric],
                                )}
                                style={{
                                  width: `${Math.max(segment.pct, segment.pct > 0 ? 6 : 0)}%`,
                                }}
                              >
                                {segment.pct > 0 ? segment.text : ""}
                              </span>
                            ))}
                          </div>
                          <p className="text-zinc-300">
                            {row.segments
                              .map((segment) => segment.text)
                              .join(" · ") || "No measured hours in this range"}
                          </p>
                          {row.unavailable.length > 0 ? (
                            <p className="text-zinc-500">
                              Not available yet:{" "}
                              {row.unavailable
                                .map(
                                  (entry) =>
                                    `${entry.metric} (${entry.reason})`,
                                )
                                .join("; ")}
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <p className="pt-1 text-zinc-400">{row.note}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <dl className="grid gap-2 text-xs sm:grid-cols-2">
              {definitionList(data).map((definition) => (
                <div key={definition.label}>
                  <dt className="font-semibold text-zinc-200">
                    {definition.label}
                  </dt>
                  <dd className="text-zinc-400">{definition.text}</dd>
                </div>
              ))}
            </dl>
            <p className="text-[11px] text-zinc-500">
              No benchmarks or targets are shown. A vehicle with less than 7
              days of data shows &quot;Not enough data&quot;.
            </p>
          </div>
        );
      }}
    </ReadGate>
  </div>
);

export const UtilisationScreen = () => {
  const fleet = useSelectedFleet();
  const online = useOnlineStatus();
  const query = useQuery({
    queryKey: fleetKeys.utilisation(fleet.fleetId),
    queryFn: ({ signal }) => fleetApi.utilisation(fleet.fleetId, {}, signal),
  });
  return (
    <UtilisationView
      fleet={fleet}
      state={toReadState(query, online, "utilisation")}
      onRetry={() => void query.refetch()}
    />
  );
};
