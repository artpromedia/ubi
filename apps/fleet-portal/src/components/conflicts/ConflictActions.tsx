"use client";

/**
 * The action buttons of one conflict — exactly the server's `allowedActions`
 * (conflicts-model.ts `planAction`), each wired to the one route that
 * performs it. A vehicle swap is only REQUESTED here: the driver accepts,
 * then the rider always confirms the new vehicle (decisions Q3); nothing
 * changes until both agree, at an unchanged fare with no new commission.
 */
import Link from "next/link";
import { useState } from "react";

import { commandErrorText } from "@/lib/access";
import { planAction, type ActionPlan } from "@/lib/conflicts-model";
import { fleetApi } from "@/lib/fleet-api";
import { useCommand } from "@/lib/hooks";
import { reasonLabel } from "@/lib/labels";
import { FLEET_TEST_IDS } from "@/lib/test-ids";
import { dateTimeIn } from "@/lib/time";

import type { ApiError } from "@/lib/api-client";
import type {
  ConflictView,
  FleetVehicleView,
  ReminderView,
  VehicleSwapRequestView,
} from "@/lib/fleet-types";

const buttonClass =
  "rounded-md px-2.5 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50";

const RemindButton = ({
  fleetId,
  plan,
  zone,
  online,
  onDone,
}: {
  readonly fleetId: string;
  readonly plan: Extract<ActionPlan, { kind: "remind" }>;
  readonly zone: string;
  readonly online: boolean;
  readonly onDone?: () => void;
}) => {
  const command = useCommand<ReminderView>();
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        data-testid={FLEET_TEST_IDS.conflicts.action}
        data-action={plan.action}
        disabled={!online || command.state.status === "pending"}
        onClick={() =>
          void command
            .run(
              (key) => fleetApi.remind(fleetId, plan.conflictId, key),
              online,
            )
            .then((result) => {
              if (result !== undefined) {
                onDone?.();
              }
            })
        }
        className={`${buttonClass} bg-[#1DB954] text-black`}
      >
        {command.state.status === "pending" ? "Sending…" : plan.label}
      </button>
      {command.state.status === "done" ? (
        <span className="text-[11px] text-[#86EFAC]">
          Reminder sent {dateTimeIn(command.state.result.remindedAt, zone)}
        </span>
      ) : null}
      {command.state.status === "failed" ? (
        <span role="alert" className="text-[11px] text-red-300">
          {commandErrorText(command.state.error, online)}
        </span>
      ) : null}
    </span>
  );
};

const SwapButton = ({
  fleetId,
  plan,
  vehicles,
  online,
  onDone,
}: {
  readonly fleetId: string;
  readonly plan: Extract<ActionPlan, { kind: "swap" }>;
  readonly vehicles: readonly FleetVehicleView[];
  readonly online: boolean;
  readonly onDone?: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const command = useCommand<VehicleSwapRequestView>();
  const options = vehicles.filter(
    (vehicle) => vehicle.vehicleId !== plan.fromVehicleId,
  );
  const refusal =
    command.state.status === "failed" &&
    (command.state.error as ApiError | undefined)?.code === "swap_ineligible"
      ? (((command.state.error as ApiError).details?.reasons as
          | string[]
          | undefined) ?? [])
      : null;
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        data-testid={FLEET_TEST_IDS.conflicts.action}
        data-action={plan.action}
        disabled={!online}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`${buttonClass} border border-zinc-600 text-zinc-100`}
      >
        {plan.label}
      </button>
      {open ? (
        <span className="flex flex-col gap-1 rounded-md border border-zinc-700 bg-zinc-900 p-2 text-[11px] text-zinc-300">
          <label className="flex items-center gap-1">
            To vehicle
            <select
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 text-zinc-100"
            >
              <option value="">Choose…</option>
              {options.map((vehicle) => (
                <option key={vehicle.vehicleId} value={vehicle.vehicleId}>
                  {vehicle.plate} · {vehicle.classes.join(", ")} ·{" "}
                  {vehicle.capacity} seats
                </option>
              ))}
            </select>
          </label>
          <span>
            The server checks eligibility. The driver accepts first, then the
            rider confirms the new vehicle. Nothing changes until both agree.
          </span>
          <button
            type="button"
            disabled={
              target === "" || !online || command.state.status === "pending"
            }
            onClick={() =>
              void command
                .run(
                  (key) =>
                    fleetApi.requestVehicleSwap(
                      fleetId,
                      plan.bookingBlockId,
                      target,
                      key,
                    ),
                  online,
                )
                .then((result) => {
                  if (result !== undefined) {
                    onDone?.();
                  }
                })
            }
            className={`${buttonClass} self-start bg-[#1DB954] text-black`}
          >
            {command.state.status === "pending"
              ? "Checking with UBI…"
              : "Request swap"}
          </button>
          {command.state.status === "done" ? (
            <span className="text-[#86EFAC]">
              {command.state.result.status === "proposed"
                ? "Swap requested. Waiting for the driver, then the rider's confirmation."
                : `Not eligible: ${command.state.result.reasons.map(reasonLabel).join(", ")}`}
            </span>
          ) : null}
          {refusal !== null ? (
            <span role="alert" className="text-red-300">
              Not eligible:{" "}
              {refusal.map(reasonLabel).join(", ") ||
                "the server refused this vehicle"}
            </span>
          ) : null}
          {refusal === null && command.state.status === "failed" ? (
            <span role="alert" className="text-red-300">
              {commandErrorText(command.state.error, online)}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
};

export const ConflictActions = ({
  fleetId,
  conflict,
  zone,
  online,
  vehicles,
  onDone,
}: {
  readonly fleetId: string;
  readonly conflict: ConflictView;
  readonly zone: string;
  readonly online: boolean;
  readonly vehicles: readonly FleetVehicleView[];
  readonly onDone?: () => void;
}) => {
  const plans = conflict.allowedActions.map((action) =>
    planAction(conflict, action),
  );
  if (plans.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-start gap-2">
      {plans.map((plan) => {
        switch (plan.kind) {
          case "remind":
            return (
              <RemindButton
                key={plan.action}
                fleetId={fleetId}
                plan={plan}
                zone={zone}
                online={online}
                onDone={onDone}
              />
            );
          case "swap":
            return (
              <SwapButton
                key={plan.action}
                fleetId={fleetId}
                plan={plan}
                vehicles={vehicles}
                online={online}
                onDone={onDone}
              />
            );
          case "maintenance":
            return (
              <Link
                key={plan.action}
                href={plan.href}
                data-testid={FLEET_TEST_IDS.conflicts.action}
                data-action={plan.action}
                className={`${buttonClass} border border-zinc-600 text-zinc-100`}
              >
                {plan.label}
              </Link>
            );
          default:
            return (
              <span key={plan.action} className="inline-flex flex-col gap-1">
                <button
                  type="button"
                  disabled
                  data-testid={FLEET_TEST_IDS.conflicts.action}
                  data-action={plan.action}
                  className={`${buttonClass} border border-zinc-700 text-zinc-400`}
                >
                  {plan.label}
                </button>
                <span className="max-w-[220px] text-[11px] text-zinc-500">
                  {plan.reason}
                </span>
              </span>
            );
        }
      })}
    </div>
  );
};
