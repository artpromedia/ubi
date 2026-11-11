"use client";

/**
 * Weekly Remittance Statement & Fleet Wallet View (CC-C03 / P1-09, DEC-9 = A).
 *
 * All monetary figures are server-authoritative integer minor units from
 * payment-service (`GET /v1/fleets/:id/remittance`), formatted strictly via
 * `formatMoney` with zero client-side arithmetic. Driver net earnings and
 * per-trip splits are never displayed.
 */
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { useSelectedFleet } from "@/components/fleet/fleet-context";
import { EmptyState, Pill, ReadGate } from "@/components/states/states";
import { toReadState, type ReadState } from "@/lib/access";
import { fleetApi, fleetKeys } from "@/lib/fleet-api";
import { useNow, useOnlineStatus } from "@/lib/hooks";
import { formatMoney } from "@/lib/money";
import { ROLE_LABELS } from "@/lib/roles";
import { FLEET_ACCOUNT_TEST_IDS } from "@/lib/test-ids";
import {
  addDays,
  dateTimeIn,
  localDateOf,
  mondayOf,
  zoneLabel,
  zoneShort,
} from "@/lib/time";

import type {
  FleetRemittanceAdjustmentView,
  FleetRemittanceAssignmentRow,
  FleetRemittanceStatement,
  FleetRemittanceStatementAvailable,
  FleetView,
} from "@/lib/fleet-types";

const RECENT_WEEKS_COUNT = 8;

const STATUS_TONE: Readonly<Record<string, "ok" | "warn" | "bad" | "mute">> = {
  Settled: "ok",
  "Carried forward": "warn",
  "Cap applied": "warn",
  "In progress": "mute",
};

const TERMS_TYPE_LABELS: Readonly<
  Record<"weekly_fixed" | "percent_of_net", string>
> = {
  weekly_fixed: "Weekly fixed",
  percent_of_net: "Percent of net",
};

export interface WeekOption {
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly isCurrent: boolean;
}

export function recentWeekOptions(now: number, zone: string): WeekOption[] {
  const today = localDateOf(now, zone);
  const currentMonday = mondayOf(today);
  const options: WeekOption[] = [];
  for (let step = 0; step < RECENT_WEEKS_COUNT; step += 1) {
    const start = addDays(currentMonday, -7 * step);
    const end = addDays(start, 6);
    options.push({
      weekStart: start,
      weekEnd: end,
      isCurrent: step === 0,
    });
  }
  return options;
}

const AdjustmentSubrow = ({
  adjustment,
}: {
  readonly adjustment: FleetRemittanceAdjustmentView;
}) => {
  const prevText = formatMoney(adjustment.previousDue);
  const nextText = formatMoney(adjustment.adjustedDue);
  const deltaText = formatMoney(adjustment.deltaDue);
  return (
    <li className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-zinc-300">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-amber-200">
          Closed-week adjustment #{adjustment.sequence} (
          {adjustment.closedWeekStart} → {adjustment.appliesToWeekStart})
        </span>
        <span className="font-mono text-[11px] text-zinc-400">
          {adjustment.journalReference}
        </span>
      </div>
      <p className="mt-1 text-zinc-300">
        Planned maintenance: {adjustment.previousPlannedMaintenanceHours}h →{" "}
        {adjustment.adjustedPlannedMaintenanceHours}h · Due: {prevText} →{" "}
        {nextText} (delta {deltaText})
      </p>
    </li>
  );
};

const AssignmentStatementCard = ({
  row,
  zone,
}: {
  readonly row: FleetRemittanceAssignmentRow;
  readonly zone: string;
}) => {
  const dueText = formatMoney(row.remittance.due);
  const collectedText = formatMoney(row.remittance.collected);
  const shortfallText = formatMoney(row.remittance.shortfall);
  const carriedText = formatMoney(row.remittance.carried);
  const refundedText = formatMoney(row.remittance.refunded);
  const grossText = formatMoney(row.weekGross);
  const commissionText = formatMoney(row.ubiCommission);
  const tone = STATUS_TONE[row.remittanceStatus] ?? "mute";
  const termsLabel =
    row.termsType !== null ? TERMS_TYPE_LABELS[row.termsType] : "Arrangement";

  return (
    <article
      data-testid={FLEET_ACCOUNT_TEST_IDS.remittance.assignmentRow}
      className="rounded-xl border border-[#222] bg-[#1A1A1A] p-4 text-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#222] pb-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-zinc-100">
              {row.driverDisplayName}
            </span>
            <Link
              href={`/vehicles/${encodeURIComponent(row.vehicleId)}`}
              className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-200 hover:bg-zinc-700"
            >
              {row.plate}
            </Link>
            <Pill tone={tone}>{row.remittanceStatus}</Pill>
            {row.capApplied ? <Pill tone="warn">70% cap applied</Pill> : null}
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            {termsLabel}
            {row.termsVersion !== null ? ` · v${row.termsVersion}` : ""}
            {row.shiftHours !== null
              ? ` · ${row.shiftHours}h signed shift`
              : ""}
            {row.plannedMaintenanceHours !== null
              ? ` · ${row.plannedMaintenanceHours}h planned maintenance`
              : ""}
          </p>
        </div>
        <div className="text-right text-xs text-zinc-400">
          {row.settled && row.settledAt ? (
            <p>
              Settled {dateTimeIn(row.settledAt, zone)}{" "}
              {zoneShort(zone, new Date(row.settledAt).getTime())}
            </p>
          ) : (
            <p>Provisional (settles at week close)</p>
          )}
          {row.journalReference ? (
            <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
              Ref: {row.journalReference}
            </p>
          ) : null}
        </div>
      </div>

      <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-zinc-400">Remittance due</dt>
          <dd className="mt-0.5 font-semibold text-zinc-100">{dueText}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-400">Collected</dt>
          <dd className="mt-0.5 font-semibold text-[#1DB954]">
            {collectedText}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-400">Shortfall / carried</dt>
          <dd className="mt-0.5 font-semibold text-zinc-100">
            {shortfallText}
            <span className="ml-1 text-xs font-normal text-zinc-400">
              (carried {carriedText})
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-400">Refunded</dt>
          <dd className="mt-0.5 font-semibold text-zinc-100">{refundedText}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-400">Week gross (non-cash)</dt>
          <dd className="mt-0.5 text-zinc-200">{grossText}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-400">UBI commission</dt>
          <dd className="mt-0.5 text-zinc-200">{commissionText}</dd>
        </div>
      </dl>

      {row.adjustments.length > 0 ? (
        <ul className="mt-3 space-y-2 border-t border-[#222] pt-3">
          {row.adjustments.map((adjustment) => (
            <AdjustmentSubrow
              key={adjustment.adjustmentId}
              adjustment={adjustment}
            />
          ))}
        </ul>
      ) : null}
    </article>
  );
};

const AvailableStatementBody = ({
  data,
}: {
  readonly data: FleetRemittanceStatementAvailable;
}) => {
  const walletBalanceText = formatMoney(data.wallet.balance);
  const fleetGrossText = formatMoney(data.fleet.weekGross);
  const fleetCommissionText = formatMoney(data.fleet.ubiCommission);
  const fleetRemittanceText = formatMoney(data.fleet.fleetRemittance);
  const dueText = formatMoney(data.fleet.remittance.due);
  const collectedText = formatMoney(data.fleet.remittance.collected);
  const shortfallText = formatMoney(data.fleet.remittance.shortfall);
  const carriedText = formatMoney(data.fleet.remittance.carried);
  const refundedText = formatMoney(data.fleet.remittance.refunded);
  const statusTone = STATUS_TONE[data.fleet.remittanceStatus] ?? "mute";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <section
          data-testid={FLEET_ACCOUNT_TEST_IDS.remittance.walletCard}
          className="rounded-xl border border-[#222] bg-[#1A1A1A] p-4 lg:col-span-1"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs text-zinc-400">Fleet ledger wallet</p>
              <p className="mt-1 text-2xl font-bold text-zinc-100">
                {walletBalanceText}
              </p>
            </div>
            <Pill tone="mute">Cash-out not available yet</Pill>
          </div>
          <p className="mt-3 text-xs text-zinc-400">
            Settled weekly remittances are credited to this fleet ledger account
            ({data.wallet.walletId}). Direct bank cash-out is not available in
            the portal yet.
          </p>
          <p className="mt-2 text-[11px] text-zinc-500">
            Balance as of {dateTimeIn(data.wallet.asOf, data.zone)}{" "}
            {zoneShort(data.zone, new Date(data.wallet.asOf).getTime())}
          </p>
        </section>

        <section className="rounded-xl border border-[#222] bg-[#1A1A1A] p-4 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-zinc-100">
                Week {data.weekStart} – {data.weekEnd}
              </h2>
              <p className="text-xs text-zinc-400">
                Excludes cash fares and tips · Fleets never see a driver&apos;s
                net earnings or per-trip split.
              </p>
            </div>
            <Pill tone={statusTone}>{data.fleet.remittanceStatus}</Pill>
          </div>

          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-[#222] bg-[#141414] p-3">
              <dt className="text-xs text-zinc-400">Week gross</dt>
              <dd className="mt-1 text-lg font-semibold text-zinc-100">
                {fleetGrossText}
              </dd>
            </div>
            <div className="rounded-lg border border-[#222] bg-[#141414] p-3">
              <dt className="text-xs text-zinc-400">UBI commission</dt>
              <dd className="mt-1 text-lg font-semibold text-zinc-100">
                {fleetCommissionText}
              </dd>
            </div>
            <div className="rounded-lg border border-[#222] bg-[#141414] p-3">
              <dt className="text-xs text-zinc-400">Fleet remittance</dt>
              <dd className="mt-1 text-lg font-semibold text-[#1DB954]">
                {fleetRemittanceText}
              </dd>
            </div>
          </dl>

          <dl className="mt-3 grid gap-2 border-t border-[#222] pt-3 text-xs sm:grid-cols-5">
            <div>
              <dt className="text-zinc-400">Due</dt>
              <dd className="mt-0.5 font-semibold text-zinc-200">{dueText}</dd>
            </div>
            <div>
              <dt className="text-zinc-400">Collected</dt>
              <dd className="mt-0.5 font-semibold text-zinc-200">
                {collectedText}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-400">Shortfall</dt>
              <dd className="mt-0.5 font-semibold text-zinc-200">
                {shortfallText}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-400">Carried forward</dt>
              <dd className="mt-0.5 font-semibold text-zinc-200">
                {carriedText}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-400">Refunded</dt>
              <dd className="mt-0.5 font-semibold text-zinc-200">
                {refundedText}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-100">
          Arrangements in this week ({data.assignments.length})
        </h2>
        {data.assignments.length === 0 ? (
          <EmptyState
            title="No active arrangements in this week"
            body="Signed driver arrangements that overlap this Monday–Sunday week appear here with their remittance breakdown."
          />
        ) : (
          <div className="space-y-3">
            {data.assignments.map((row) => (
              <AssignmentStatementCard
                key={row.assignmentId}
                row={row}
                zone={data.zone}
              />
            ))}
          </div>
        )}
      </section>

      <p className="text-[11px] text-zinc-500">
        From the server · {dateTimeIn(data.asOf, data.zone)}{" "}
        {zoneShort(data.zone, new Date(data.asOf).getTime())}
      </p>
    </div>
  );
};

export interface RemittanceStatementViewProps {
  readonly fleet: FleetView;
  readonly state: ReadState<FleetRemittanceStatement>;
  readonly selectedWeekStart: string;
  readonly weekOptions: readonly WeekOption[];
  readonly now: number;
  readonly onSelectWeek?: (weekStart: string) => void;
  readonly onRetry?: () => void;
}

export const RemittanceStatementView = ({
  fleet,
  state,
  selectedWeekStart,
  weekOptions,
  now,
  onSelectWeek,
  onRetry,
}: RemittanceStatementViewProps) => (
  <div
    data-testid={FLEET_ACCOUNT_TEST_IDS.remittance.statement}
    className="space-y-4"
  >
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">
          Remittance &amp; fleet wallet
        </h1>
        <p className="text-xs text-zinc-400">
          {fleet.name} · {ROLE_LABELS[fleet.myRole]} ·{" "}
          {zoneLabel(fleet.zone, now)}
        </p>
      </div>
      <label className="flex items-center gap-2 text-xs text-zinc-300">
        <span>Week (Mon–Sun)</span>
        <select
          data-testid={FLEET_ACCOUNT_TEST_IDS.remittance.weekSelect}
          value={selectedWeekStart}
          onChange={(event) => onSelectWeek?.(event.target.value)}
          className="rounded-lg border border-zinc-700 bg-[#141414] px-3 py-1.5 text-xs text-zinc-100"
        >
          {weekOptions.map((option) => (
            <option key={option.weekStart} value={option.weekStart}>
              {option.weekStart} – {option.weekEnd}
              {option.isCurrent ? " (current)" : ""}
            </option>
          ))}
        </select>
      </label>
    </div>

    <ReadGate
      state={state}
      loadingLabel="Loading remittance statement…"
      context="the remittance statement"
      zone={fleet.zone}
      onRetry={onRetry}
    >
      {(statement) =>
        statement.available ? (
          <AvailableStatementBody data={statement} />
        ) : (
          <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-100">
            <p className="font-semibold">
              Remittance statement unavailable ({statement.weekStart} –{" "}
              {statement.weekEnd})
            </p>
            <p className="mt-1 text-amber-200/90">
              Payment settlement figures from {statement.source} are temporarily
              unavailable ({statement.reason}). Nothing is estimated in the
              browser; please retry shortly.
            </p>
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 rounded bg-amber-400 px-3 py-1 text-xs font-semibold text-black"
              >
                Retry
              </button>
            ) : null}
          </section>
        )
      }
    </ReadGate>
  </div>
);

export const RemittanceStatementScreen = () => {
  const fleet = useSelectedFleet();
  const online = useOnlineStatus();
  const now = useNow();
  const options = recentWeekOptions(now, fleet.zone);
  const defaultWeekStart =
    options[0]?.weekStart ?? mondayOf(localDateOf(now, fleet.zone));
  const [selectedWeekStart, setSelectedWeekStart] =
    useState<string>(defaultWeekStart);

  const query = useQuery({
    queryKey: fleetKeys.remittance(fleet.fleetId, selectedWeekStart),
    queryFn: ({ signal }) =>
      fleetApi.remittance(fleet.fleetId, selectedWeekStart, signal),
    refetchInterval: 60_000,
  });

  return (
    <RemittanceStatementView
      fleet={fleet}
      state={toReadState(query, online, "the remittance statement")}
      selectedWeekStart={selectedWeekStart}
      weekOptions={options}
      now={now}
      onSelectWeek={setSelectedWeekStart}
      onRetry={() => void query.refetch()}
    />
  );
};
