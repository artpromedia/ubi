"use client";

/**
 * B7 — propose an assignment or shift change: the terms diff ("what the
 * driver will see"), the server's overlap and city-cap checks (a refused
 * proposal is never sent), then consent that stays pending until the driver
 * signs with their PIN, declines or lets it expire (48 h). Nothing takes
 * effect until the driver signs; the fleet never sees why a driver declined.
 * Managers propose only under the driver's currently signed terms; new
 * remittance terms are owner-only. Signed arrangements and (owner-only)
 * notice live here too.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import { useSelectedFleet } from "@/components/fleet/fleet-context";
import {
  EmptyState,
  PermissionNote,
  Pill,
  ReadGate,
} from "@/components/states/states";
import { commandErrorText, toReadState, type ReadState } from "@/lib/access";
import {
  checkCopy,
  consentTimeline,
  draftDiffRows,
  proposeRefusal,
  remittanceText,
  serverDiffRows,
  shiftInputKey,
  shiftInputText,
  validityText,
} from "@/lib/assignment-model";
import { fleetApi, fleetKeys } from "@/lib/fleet-api";
import { useCommand, useNow, useOnlineStatus } from "@/lib/hooks";
import { PROPOSAL_STATUS_LABELS, shiftName } from "@/lib/labels";
import { parseMajorToMinor } from "@/lib/money";
import { can, permissionCopy } from "@/lib/roles";
import { FLEET_TEST_IDS } from "@/lib/test-ids";
import { localDateOf, shortDate } from "@/lib/time";
import { cn } from "@/lib/utils";

import type {
  ArrangementView,
  AssignmentTerms,
  AssignmentTermsInput,
  FleetAssignments,
  FleetShiftInput,
  FleetVehicleView,
  FleetView,
  ProposalView,
  ProposeAssignmentInput,
  TerminationView,
} from "@/lib/fleet-types";

const input =
  "rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100";

export const ConsentStatus = ({
  proposal,
  zone,
}: {
  readonly proposal: ProposalView;
  readonly zone: string;
}) => (
  <ol
    data-testid={FLEET_TEST_IDS.assignment.consentStatus}
    className="space-y-2"
  >
    {consentTimeline(proposal, zone).map((step) => (
      <li key={step.key} className="flex gap-2 text-xs">
        <span
          aria-hidden
          className={cn(
            "mt-1 h-2.5 w-2.5 shrink-0 rounded-full border",
            step.state === "done" && "border-[#1DB954] bg-[#1DB954]",
            step.state === "current" && "border-[#5B73C4] bg-[#5B73C4]",
            step.state === "ended" && "border-zinc-500 bg-zinc-500",
            step.state === "todo" && "border-zinc-600",
          )}
        />
        <div>
          <p className="font-semibold text-zinc-100">
            {step.title}
            <span className="sr-only"> ({step.state})</span>
          </p>
          <p className="text-zinc-400">{step.detail}</p>
        </div>
      </li>
    ))}
  </ol>
);

interface ProposeFormState {
  vehicleId: string;
  driverChoice: string;
  otherDriverId: string;
  shiftKind: "full" | "day" | "night" | "custom";
  customStart: string;
  customEnd: string;
  validFrom: string;
  validTo: string;
  newTerms: boolean;
  termsType: "weekly_fixed" | "percent_of_net";
  amount: string;
  percent: string;
  maxWeeks: string;
  fuelBy: "driver" | "fleet";
  servicingBy: "driver" | "fleet";
}

/** Why the owner's typed terms can't be sent yet, or null. */
function termsInputProblem(
  type: ProposeFormState["termsType"],
  amountMinor: number | null,
  percent: number,
  maxWeeks: number,
): string | null {
  if (type === "weekly_fixed" && amountMinor === null) {
    return "Enter the weekly amount (for example 40,000).";
  }
  if (type === "percent_of_net" && !(percent > 0 && percent <= 100)) {
    return "Enter a percentage between 0 and 100.";
  }
  if (!(maxWeeks >= 1 && maxWeeks <= 52)) {
    return "Carry forward can be 1 to 52 weeks.";
  }
  return null;
}

function proposalTone(proposal: ProposalView): "ok" | "info" | "mute" {
  if (proposal.status === "signed") {
    return "ok";
  }
  return proposal.status === "sent" || proposal.status === "pending_signature"
    ? "info"
    : "mute";
}

export const ProposeForm = ({
  fleet,
  assignments,
  vehicles,
  online,
  today,
  initialVehicleId = "",
  onSent,
}: {
  readonly fleet: FleetView;
  readonly assignments: FleetAssignments;
  readonly vehicles: readonly FleetVehicleView[];
  readonly online: boolean;
  readonly today: string;
  readonly initialVehicleId?: string;
  readonly onSent?: () => void;
}) => {
  const isOwner = can(fleet.myRole, "propose_terms");
  const [form, setForm] = useState<ProposeFormState>({
    vehicleId: initialVehicleId,
    driverChoice: "",
    otherDriverId: "",
    shiftKind: "day",
    customStart: "14:00",
    customEnd: "22:00",
    validFrom: today,
    validTo: "",
    newTerms: false,
    termsType: "weekly_fixed",
    amount: "",
    percent: "",
    maxWeeks: "2",
    fuelBy: "driver",
    servicingBy: "fleet",
  });
  const command = useCommand<ProposalView>();
  const set = (next: Partial<ProposeFormState>) => {
    setForm({ ...form, ...next });
    if (command.state.status !== "pending") {
      command.reset();
    }
  };
  const drivers = useMemo(() => {
    const names = new Map<string, string>();
    for (const entry of [
      ...assignments.arrangements,
      ...assignments.proposals,
    ]) {
      names.set(entry.driverId, entry.driverDisplayName);
    }
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [assignments]);
  const driverId =
    form.driverChoice === "__other"
      ? form.otherDriverId.trim()
      : form.driverChoice;
  const driverName =
    drivers.find(([id]) => id === driverId)?.[1] ?? "the driver";
  const plates = new Map(
    vehicles.map((vehicle) => [vehicle.vehicleId, vehicle.plate]),
  );
  const current: ArrangementView | null =
    assignments.arrangements.find(
      (entry) =>
        entry.driverId === driverId &&
        entry.vehicleId === form.vehicleId &&
        (entry.status === "active" || entry.status === "notice"),
    ) ??
    assignments.arrangements.find(
      (entry) =>
        entry.driverId === driverId &&
        (entry.status === "active" || entry.status === "notice"),
    ) ??
    null;
  const shift: FleetShiftInput =
    form.shiftKind === "custom"
      ? { start: form.customStart, end: form.customEnd }
      : form.shiftKind;
  const amountMinor =
    form.termsType === "weekly_fixed"
      ? parseMajorToMinor(form.amount, fleet.currency)
      : null;
  const percent =
    form.termsType === "percent_of_net"
      ? Number.parseFloat(form.percent)
      : Number.NaN;
  const maxWeeks = Number.parseInt(form.maxWeeks, 10);
  const newTerms = isOwner && form.newTerms;
  const termsProblem = newTerms
    ? termsInputProblem(form.termsType, amountMinor, percent, maxWeeks)
    : null;
  const draftTerms: AssignmentTerms | null =
    newTerms && termsProblem === null
      ? {
          type: form.termsType,
          amountMinor: form.termsType === "weekly_fixed" ? amountMinor : null,
          currency: fleet.currency,
          percent: form.termsType === "percent_of_net" ? percent : null,
          shortfall: { policy: "carry_forward", maxWeeks },
          fuelBy: form.fuelBy,
          servicingBy: form.servicingBy,
        }
      : null;
  const diff = draftDiffRows(
    current,
    {
      vehiclePlate: plates.get(form.vehicleId) ?? "",
      shiftText: shiftInputText(shift),
      shiftKey: shiftInputKey(shift),
      validFrom: form.validFrom,
      validTo: form.validTo === "" ? null : form.validTo,
      terms: draftTerms,
    },
    plates,
  );
  const ready =
    form.vehicleId !== "" &&
    driverId !== "" &&
    form.validFrom !== "" &&
    termsProblem === null &&
    (!newTerms || draftTerms !== null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) {
      return;
    }
    const terms: AssignmentTermsInput | undefined =
      draftTerms === null
        ? undefined
        : {
            type: draftTerms.type,
            ...(draftTerms.type === "weekly_fixed"
              ? { amountMinor: draftTerms.amountMinor ?? undefined }
              : { percent: draftTerms.percent ?? undefined }),
            shortfall: draftTerms.shortfall,
            fuelBy: draftTerms.fuelBy,
            servicingBy: draftTerms.servicingBy,
          };
    const body: ProposeAssignmentInput = {
      vehicleId: form.vehicleId,
      driverId,
      shift,
      validFrom: form.validFrom,
      ...(form.validTo === "" ? {} : { validTo: form.validTo }),
      ...(terms === undefined ? {} : { terms }),
    };
    void command
      .run((key) => fleetApi.propose(fleet.fleetId, body, key), online)
      .then((result) => {
        if (result !== undefined) {
          onSent?.();
        }
      });
  };

  const refusal =
    command.state.status === "failed"
      ? proposeRefusal(command.state.error, shiftInputText(shift))
      : null;

  return (
    <form
      onSubmit={submit}
      className="grid gap-4 rounded-xl border border-[#222] bg-[#1A1A1A] p-4 text-sm xl:grid-cols-2"
    >
      <div className="space-y-3">
        <h2 className="font-semibold text-zinc-100">
          Propose an assignment or shift change
        </h2>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Vehicle
          <select
            required
            value={form.vehicleId}
            onChange={(event) => set({ vehicleId: event.target.value })}
            className={input}
          >
            <option value="">Choose…</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.vehicleId} value={vehicle.vehicleId}>
                {vehicle.plate}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Driver
          <select
            required
            value={form.driverChoice}
            onChange={(event) => set({ driverChoice: event.target.value })}
            className={input}
          >
            <option value="">Choose…</option>
            {drivers.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
            <option value="__other">Another UBI driver (by user ID)…</option>
          </select>
        </label>
        {form.driverChoice === "__other" ? (
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            Driver&apos;s UBI user ID
            <input
              value={form.otherDriverId}
              onChange={(event) => set({ otherDriverId: event.target.value })}
              className={input}
            />
          </label>
        ) : null}
        <div className="grid grid-cols-3 gap-2">
          <label className="col-span-3 flex flex-col gap-1 text-xs text-zinc-400 sm:col-span-1">
            Shift
            <select
              value={form.shiftKind}
              onChange={(event) =>
                set({
                  shiftKind: event.target
                    .value as ProposeFormState["shiftKind"],
                })
              }
              className={input}
            >
              <option value="day">Day (city window)</option>
              <option value="night">Night (city window)</option>
              <option value="full">Full day</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          {form.shiftKind === "custom" ? (
            <>
              <label className="flex flex-col gap-1 text-xs text-zinc-400">
                Starts
                <input
                  type="time"
                  value={form.customStart}
                  onChange={(event) => set({ customStart: event.target.value })}
                  className={input}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-zinc-400">
                Ends
                <input
                  type="time"
                  value={form.customEnd}
                  onChange={(event) => set({ customEnd: event.target.value })}
                  className={input}
                />
              </label>
            </>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            Valid from
            <input
              type="date"
              required
              min={today}
              value={form.validFrom}
              onChange={(event) => set({ validFrom: event.target.value })}
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            Valid to (optional)
            <input
              type="date"
              value={form.validTo}
              onChange={(event) => set({ validTo: event.target.value })}
              className={input}
            />
          </label>
        </div>
        {isOwner ? (
          <fieldset className="space-y-2 rounded-lg border border-[#262626] p-3">
            <legend className="px-1 text-xs text-zinc-400">
              Remittance terms
            </legend>
            <label className="flex items-center gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={form.newTerms}
                onChange={(event) => set({ newTerms: event.target.checked })}
              />
              Propose new remittance terms (otherwise the driver&apos;s signed
              terms are reused)
            </label>
            {form.newTerms ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs text-zinc-400">
                  Type
                  <select
                    value={form.termsType}
                    onChange={(event) =>
                      set({
                        termsType: event.target
                          .value as ProposeFormState["termsType"],
                      })
                    }
                    className={input}
                  >
                    <option value="weekly_fixed">Weekly fixed</option>
                    <option value="percent_of_net">Percent of net</option>
                  </select>
                </label>
                {form.termsType === "weekly_fixed" ? (
                  <label className="flex flex-col gap-1 text-xs text-zinc-400">
                    Weekly amount ({fleet.currency})
                    <input
                      inputMode="decimal"
                      value={form.amount}
                      onChange={(event) => set({ amount: event.target.value })}
                      className={input}
                    />
                  </label>
                ) : (
                  <label className="flex flex-col gap-1 text-xs text-zinc-400">
                    Percent
                    <input
                      inputMode="decimal"
                      value={form.percent}
                      onChange={(event) => set({ percent: event.target.value })}
                      className={input}
                    />
                  </label>
                )}
                <label className="flex flex-col gap-1 text-xs text-zinc-400">
                  Shortfall carried forward (weeks)
                  <input
                    inputMode="numeric"
                    value={form.maxWeeks}
                    onChange={(event) => set({ maxWeeks: event.target.value })}
                    className={input}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-400">
                  Fuel paid by
                  <select
                    value={form.fuelBy}
                    onChange={(event) =>
                      set({ fuelBy: event.target.value as "driver" | "fleet" })
                    }
                    className={input}
                  >
                    <option value="driver">Driver</option>
                    <option value="fleet">Fleet</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-400">
                  Servicing paid by
                  <select
                    value={form.servicingBy}
                    onChange={(event) =>
                      set({
                        servicingBy: event.target.value as "driver" | "fleet",
                      })
                    }
                    className={input}
                  >
                    <option value="driver">Driver</option>
                    <option value="fleet">Fleet</option>
                  </select>
                </label>
                {termsProblem !== null ? (
                  <p className="col-span-2 text-xs text-amber-200">
                    {termsProblem}
                  </p>
                ) : null}
                <p className="col-span-2 text-[11px] text-zinc-500">
                  UBI checks the amount against the city cap when you send.
                </p>
              </div>
            ) : null}
          </fieldset>
        ) : (
          <PermissionNote>{permissionCopy("propose_terms")}</PermissionNote>
        )}
      </div>
      <div className="space-y-3">
        <div data-testid={FLEET_TEST_IDS.assignment.termsDiff}>
          <h3 className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
            Terms diff (what {driverName} will see)
          </h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-zinc-500">
                <th scope="col" className="py-1 font-medium">
                  Term
                </th>
                <th scope="col" className="py-1 font-medium">
                  Current
                </th>
                <th scope="col" className="py-1 font-medium">
                  Proposed
                </th>
              </tr>
            </thead>
            <tbody>
              {diff.map((row) => (
                <tr key={row.term} className="border-t border-[#1F1F1F]">
                  <th
                    scope="row"
                    className="py-1 text-left font-medium text-zinc-300"
                  >
                    {row.term}
                  </th>
                  <td className="py-1 text-zinc-400">{row.current}</td>
                  <td
                    className={cn(
                      "py-1",
                      row.changed
                        ? "font-semibold text-[#86EFAC]"
                        : "text-zinc-400",
                    )}
                  >
                    {row.proposed}
                    {row.changed ? (
                      <span className="sr-only"> (changed)</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="submit"
          data-testid={FLEET_TEST_IDS.assignment.proposeSubmit}
          disabled={!ready || !online || command.state.status === "pending"}
          className="rounded-md bg-[#1DB954] px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
        >
          {command.state.status === "pending"
            ? "Checking with UBI…"
            : `Send to ${driverName}`}
        </button>
        <p className="text-[11px] text-zinc-500">
          Nothing takes effect until {driverName} signs with their PIN. A
          proposal is never counted as availability. If they decline, there is
          no penalty.
        </p>
        {command.state.status === "done" ? (
          <div
            role="status"
            className="space-y-2 rounded-lg border border-[#262626] p-3 text-xs"
          >
            <p className="text-[#86EFAC]">{checkCopy(command.state.result)}</p>
            <table className="w-full">
              <tbody>
                {serverDiffRows(command.state.result, plates).map((row) => (
                  <tr key={row.term} className="border-t border-[#1F1F1F]">
                    <th
                      scope="row"
                      className="py-1 text-left font-medium text-zinc-300"
                    >
                      {row.term}
                    </th>
                    <td className="py-1 text-zinc-200">{row.proposed}</td>
                    <td className="py-1 text-zinc-400">{row.consent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ConsentStatus proposal={command.state.result} zone={fleet.zone} />
          </div>
        ) : null}
        {command.state.status === "failed" ? (
          <p
            role="alert"
            className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200"
          >
            {refusal ?? commandErrorText(command.state.error, online)}
          </p>
        ) : null}
      </div>
    </form>
  );
};

const WithdrawButton = ({
  fleet,
  proposal,
  online,
  onChanged,
}: {
  readonly fleet: FleetView;
  readonly proposal: ProposalView;
  readonly online: boolean;
  readonly onChanged?: () => void;
}) => {
  const command = useCommand<ProposalView>();
  return (
    <span className="inline-flex flex-col gap-0.5">
      <button
        type="button"
        disabled={!online || command.state.status === "pending"}
        onClick={() =>
          void command
            .run(
              (key) =>
                fleetApi.withdrawProposal(
                  fleet.fleetId,
                  proposal.proposalId,
                  key,
                ),
              online,
            )
            .then((result) => {
              if (result !== undefined) {
                onChanged?.();
              }
            })
        }
        className="rounded border border-zinc-600 px-2 py-0.5 text-[11px] text-zinc-200 disabled:opacity-50"
      >
        {command.state.status === "pending"
          ? "Withdrawing…"
          : "Withdraw proposal"}
      </button>
      {command.state.status === "failed" ? (
        <span role="alert" className="text-[10.5px] text-red-300">
          {commandErrorText(command.state.error, online)}
        </span>
      ) : null}
    </span>
  );
};

const NoticeButton = ({
  fleet,
  arrangement,
  online,
  onChanged,
}: {
  readonly fleet: FleetView;
  readonly arrangement: ArrangementView;
  readonly online: boolean;
  readonly onChanged?: () => void;
}) => {
  const [confirming, setConfirming] = useState(false);
  const command = useCommand<TerminationView>();
  if (command.state.status === "done") {
    const result = command.state.result;
    return (
      <span className="text-[11px] text-zinc-300">
        Notice given · ends {shortDate(result.noticeEndsOn)}
        {result.bookingsAfterNotice.length > 0
          ? ` · ${result.bookingsAfterNotice.length} booking(s) after that date: the driver keeps each on another eligible vehicle or withdraws.`
          : ""}
      </span>
    );
  }
  return confirming ? (
    <span className="inline-flex flex-col gap-1 text-[11px] text-zinc-300">
      <span>
        Two weeks&apos; notice. Remittance stops when it ends and is never
        retroactive.
      </span>
      <span className="flex gap-1">
        <button
          type="button"
          disabled={!online || command.state.status === "pending"}
          onClick={() =>
            void command
              .run(
                (key) =>
                  fleetApi.terminate(
                    fleet.fleetId,
                    arrangement.assignmentId,
                    key,
                  ),
                online,
              )
              .then((result) => {
                if (result !== undefined) {
                  onChanged?.();
                }
              })
          }
          className="rounded bg-red-500 px-2 py-0.5 font-semibold text-black disabled:opacity-50"
        >
          Give notice
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded border border-zinc-600 px-2 py-0.5"
        >
          Keep
        </button>
      </span>
      {command.state.status === "failed" ? (
        <span role="alert" className="text-red-300">
          {commandErrorText(command.state.error, online)}
        </span>
      ) : null}
    </span>
  ) : (
    <button
      type="button"
      disabled={!online}
      onClick={() => setConfirming(true)}
      className="rounded border border-zinc-600 px-2 py-0.5 text-[11px] text-zinc-200 disabled:opacity-50"
    >
      Give notice…
    </button>
  );
};

export interface AssignmentsViewProps {
  readonly fleet: FleetView;
  readonly state: ReadState<FleetAssignments>;
  readonly vehicles: readonly FleetVehicleView[];
  readonly online: boolean;
  readonly today: string;
  readonly initialVehicleId?: string;
  readonly onChanged?: () => void;
  readonly onRetry?: () => void;
}

export const AssignmentsView = ({
  fleet,
  state,
  vehicles,
  online,
  today,
  initialVehicleId,
  onChanged,
  onRetry,
}: AssignmentsViewProps) => {
  const canPropose =
    can(fleet.myRole, "propose_assignment") && fleet.status === "active";
  const canTerminate =
    can(fleet.myRole, "terminate_arrangement") && fleet.status === "active";
  const plates = new Map(
    vehicles.map((vehicle) => [vehicle.vehicleId, vehicle.plate]),
  );
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-zinc-100">Assignments</h1>
      <ReadGate
        state={state}
        loadingLabel="Loading assignments…"
        context="assignments"
        zone={fleet.zone}
        onRetry={onRetry}
      >
        {(data) => {
          const live = data.proposals.filter(
            (proposal) =>
              proposal.status === "sent" ||
              proposal.status === "pending_signature",
          );
          const settled = data.proposals.filter(
            (proposal) => !live.includes(proposal),
          );
          return (
            <div className="space-y-4">
              {canPropose && vehicles.length === 0 ? (
                <EmptyState
                  title="Add a vehicle before proposing an assignment."
                  action={{ href: "/vehicles", label: "Add a vehicle" }}
                />
              ) : null}
              {canPropose && vehicles.length > 0 ? (
                <ProposeForm
                  fleet={fleet}
                  assignments={data}
                  vehicles={vehicles}
                  online={online}
                  today={today}
                  initialVehicleId={initialVehicleId}
                  onSent={onChanged}
                />
              ) : null}
              {canPropose ? null : (
                <PermissionNote>
                  {permissionCopy("propose_assignment")}
                </PermissionNote>
              )}
              <section className="space-y-2">
                <h2 className="text-sm font-semibold text-zinc-100">
                  Waiting for a signature · {live.length}
                </h2>
                {live.length === 0 ? (
                  <p className="text-xs text-zinc-500">
                    No proposal is waiting for a driver.
                  </p>
                ) : null}
                <div className="grid gap-3 lg:grid-cols-2">
                  {[...live, ...settled.slice(0, 10)].map((proposal) => (
                    <div
                      key={proposal.proposalId}
                      className="space-y-2 rounded-xl border border-[#222] bg-[#1A1A1A] p-3 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-zinc-100">
                          {proposal.driverDisplayName} ·{" "}
                          {plates.get(proposal.vehicleId) ?? "Vehicle"} ·{" "}
                          {shiftName(proposal.shift)}
                        </p>
                        <Pill tone={proposalTone(proposal)}>
                          {PROPOSAL_STATUS_LABELS[proposal.status]}
                        </Pill>
                      </div>
                      <p className="text-zinc-400">
                        Terms v{proposal.termsVersion} ·{" "}
                        {remittanceText(proposal.terms)} ·{" "}
                        {validityText(proposal.validFrom, proposal.validTo)} ·
                        proposed by {proposal.proposedByRole}
                      </p>
                      <ConsentStatus proposal={proposal} zone={fleet.zone} />
                      {canPropose && live.includes(proposal) ? (
                        <WithdrawButton
                          fleet={fleet}
                          proposal={proposal}
                          online={online}
                          onChanged={onChanged}
                        />
                      ) : null}
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-zinc-500">
                  The fleet never sees why a driver declined, and declining has
                  no effect on the driver&apos;s standing.
                </p>
              </section>
              <section className="space-y-2">
                <h2 className="text-sm font-semibold text-zinc-100">
                  Signed arrangements
                </h2>
                {data.arrangements.length === 0 ? (
                  <p className="text-xs text-zinc-500">
                    No signed arrangements yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-[#222] bg-[#141414]">
                    <table className="w-full min-w-[760px] text-xs">
                      <thead>
                        <tr className="border-b border-[#222] text-left text-zinc-500">
                          <th scope="col" className="px-3 py-2 font-medium">
                            Driver
                          </th>
                          <th scope="col" className="px-3 py-2 font-medium">
                            Vehicle · shift
                          </th>
                          <th scope="col" className="px-3 py-2 font-medium">
                            Validity
                          </th>
                          <th scope="col" className="px-3 py-2 font-medium">
                            Terms
                          </th>
                          <th scope="col" className="px-3 py-2 font-medium">
                            Status
                          </th>
                          <th scope="col" className="px-3 py-2 font-medium">
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.arrangements.map((arrangement) => (
                          <tr
                            key={arrangement.assignmentId}
                            className="border-b border-[#1F1F1F] text-zinc-300"
                          >
                            <td className="px-3 py-2 font-semibold text-zinc-100">
                              {arrangement.driverDisplayName}
                            </td>
                            <td className="px-3 py-2">
                              {plates.get(arrangement.vehicleId) ?? "Vehicle"} ·{" "}
                              {shiftName(arrangement.shift)}
                            </td>
                            <td className="px-3 py-2">
                              {validityText(
                                arrangement.validFrom,
                                arrangement.validTo,
                              )}
                            </td>
                            <td className="px-3 py-2">
                              v{arrangement.termsVersion} ·{" "}
                              {remittanceText(arrangement.terms)}
                            </td>
                            <td className="px-3 py-2">
                              {arrangement.status === "notice" &&
                              arrangement.validTo !== null
                                ? `On notice · ends ${shortDate(arrangement.validTo)}`
                                : arrangement.status.charAt(0).toUpperCase() +
                                  arrangement.status.slice(1)}
                            </td>
                            <td className="px-3 py-2">
                              {canTerminate &&
                              arrangement.status === "active" ? (
                                <NoticeButton
                                  fleet={fleet}
                                  arrangement={arrangement}
                                  online={online}
                                  onChanged={onChanged}
                                />
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          );
        }}
      </ReadGate>
    </div>
  );
};

export const AssignmentsScreen = () => {
  const fleet = useSelectedFleet();
  const online = useOnlineStatus();
  const now = useNow(60_000);
  const client = useQueryClient();
  const params = useSearchParams();
  const assignments = useQuery({
    queryKey: fleetKeys.assignments(fleet.fleetId),
    queryFn: ({ signal }) => fleetApi.assignments(fleet.fleetId, signal),
    refetchInterval: 60_000,
  });
  const vehicles = useQuery({
    queryKey: fleetKeys.vehicles(fleet.fleetId),
    queryFn: ({ signal }) => fleetApi.vehicles(fleet.fleetId, signal),
  });
  return (
    <AssignmentsView
      fleet={fleet}
      state={toReadState(assignments, online, "assignments")}
      vehicles={vehicles.data?.vehicles ?? []}
      online={online}
      today={localDateOf(now, fleet.zone)}
      initialVehicleId={params.get("vehicleId") ?? ""}
      onChanged={() =>
        void client.invalidateQueries({
          queryKey: fleetKeys.all(fleet.fleetId),
        })
      }
      onRetry={() => void assignments.refetch()}
    />
  );
};
