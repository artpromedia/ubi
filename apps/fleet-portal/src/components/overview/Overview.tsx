"use client";

/**
 * The fleet overview: the server's counts (vehicles, documents, maintenance,
 * arrangements, open conflicts by severity) with their asOf, and links to
 * each screen. Money is not shown: fleet-service answers that payment-service
 * owns it and has not published it to fleets, so nothing is estimated.
 */
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { useSelectedFleet } from "@/components/fleet/fleet-context";
import { ReadGate } from "@/components/states/states";
import { toReadState, type ReadState } from "@/lib/access";
import { fleetApi, fleetKeys } from "@/lib/fleet-api";
import { useOnlineStatus } from "@/lib/hooks";
import { ROLE_LABELS } from "@/lib/roles";
import { dateTimeIn, zoneLabel, zoneShort } from "@/lib/time";

import type { FleetOverview, FleetView } from "@/lib/fleet-types";

const Stat = ({
  label,
  value,
  href,
}: {
  readonly label: string;
  readonly value: number;
  readonly href: string;
}) => (
  <Link
    href={href}
    className="rounded-xl border border-[#222] bg-[#1A1A1A] p-4 hover:border-[#1DB954]/50"
  >
    <p className="text-xs text-zinc-400">{label}</p>
    <p className="mt-1 text-2xl font-bold text-zinc-100">{value}</p>
  </Link>
);

export const OverviewView = ({
  fleet,
  state,
  now,
  onRetry,
}: {
  readonly fleet: FleetView;
  readonly state: ReadState<FleetOverview>;
  readonly now: number;
  readonly onRetry?: () => void;
}) => (
  <div className="space-y-4">
    <div>
      <h1 className="text-xl font-bold text-zinc-100">{fleet.name}</h1>
      <p className="text-xs text-zinc-400">
        {ROLE_LABELS[fleet.myRole]} · {zoneLabel(fleet.zone, now)}
      </p>
    </div>
    <ReadGate
      state={state}
      loadingLabel="Loading overview…"
      context="the overview"
      zone={fleet.zone}
      onRetry={onRetry}
    >
      {(data) => (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Vehicles"
              value={data.vehicles.total}
              href="/vehicles"
            />
            <Stat
              label="In maintenance now"
              value={data.vehicles.inMaintenance}
              href="/calendar?status=maintenance"
            />
            <Stat
              label="Documents expiring"
              value={data.vehicles.docExpiring}
              href="/vehicles"
            />
            <Stat
              label="Documents expired"
              value={data.vehicles.docExpired}
              href="/vehicles"
            />
            <Stat
              label="Active arrangements"
              value={data.arrangements.active}
              href="/assignments"
            />
            <Stat
              label="On notice"
              value={data.arrangements.onNotice}
              href="/assignments"
            />
            <Stat
              label="Waiting for a signature"
              value={data.arrangements.pendingProposals}
              href="/assignments"
            />
            <Stat
              label="Open conflicts (critical · high · medium)"
              value={
                data.openConflicts.critical +
                data.openConflicts.high +
                data.openConflicts.medium
              }
              href="/conflicts"
            />
          </div>
          <p className="text-xs text-zinc-400">
            Conflicts by severity: {data.openConflicts.critical} critical ·{" "}
            {data.openConflicts.high} high · {data.openConflicts.medium} medium
            · {data.openConflicts.status} status only
          </p>
          <div className="rounded-xl border border-[#222] bg-[#141414] p-4 text-xs text-zinc-400">
            <p className="font-semibold text-zinc-200">Money</p>
            <p>
              Gross, UBI commission and your remittance are settled by UBI and
              aren&apos;t published to the portal yet. Nothing is estimated
              here, and fleets never see a driver&apos;s net earnings.
            </p>
          </div>
          <p className="text-[11px] text-zinc-500">
            From the server · {dateTimeIn(data.asOf, data.zone)}{" "}
            {zoneShort(data.zone, new Date(data.asOf).getTime())}
          </p>
        </div>
      )}
    </ReadGate>
  </div>
);

export const OverviewScreen = () => {
  const fleet = useSelectedFleet();
  const online = useOnlineStatus();
  const query = useQuery({
    queryKey: fleetKeys.overview(fleet.fleetId),
    queryFn: ({ signal }) => fleetApi.overview(fleet.fleetId, signal),
    refetchInterval: 60_000,
  });
  return (
    <OverviewView
      fleet={fleet}
      state={toReadState(query, online, "the overview")}
      now={Date.now()}
      onRetry={() => void query.refetch()}
    />
  );
};
