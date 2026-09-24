"use client";

/**
 * "Report off-road" (B5, decisions Q5 and correction 4): the ONLY fleet
 * action that affects a confirmed booking. The block takes effect at once;
 * overlapping bookings become at risk with UBI's decision deadline — never
 * cancelled — and the driver and rider then decide (swap or withdraw). Every
 * report is audited, visible to UBI and flagged if the vehicle goes online
 * during the claimed breakdown. Owners and managers only.
 *
 * No remittance copy here: breakdowns follow the signed terms' shortfall
 * rule, not pro-rating (decisions Q8), and amounts are UBI's.
 */
import { useState, type FormEvent } from "react";

import { PermissionNote, ReadGate } from "@/components/states/states";
import { commandErrorText, type ReadState } from "@/lib/access";
import { fleetApi } from "@/lib/fleet-api";
import { useCommand } from "@/lib/hooks";
import { offRoadOutcome } from "@/lib/maintenance-model";
import { can, permissionCopy } from "@/lib/roles";
import { FLEET_TEST_IDS } from "@/lib/test-ids";
import { localDateOf, localInputToIso, zoneShort } from "@/lib/time";

import type {
  FleetVehicleList,
  FleetView,
  OffRoadView,
  ReportOffRoadInput,
} from "@/lib/fleet-types";

const input =
  "rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100";

export const OffRoadPanel = ({
  fleet,
  vehicles,
  online,
  now,
  defaultVehicleId = "",
  onReported,
}: {
  readonly fleet: FleetView;
  readonly vehicles: ReadState<FleetVehicleList>;
  readonly online: boolean;
  readonly now: number;
  readonly defaultVehicleId?: string;
  readonly onReported?: () => void;
}) => {
  const [vehicleId, setVehicleId] = useState(defaultVehicleId);
  const [expectedDate, setExpectedDate] = useState("");
  const [expectedTime, setExpectedTime] = useState("");
  const [note, setNote] = useState("");
  const command = useCommand<OffRoadView>();
  const canReport =
    can(fleet.myRole, "report_off_road") && fleet.status === "active";
  const zone = fleet.zone;

  if (!canReport) {
    return <PermissionNote>{permissionCopy("report_off_road")}</PermissionNote>;
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body: ReportOffRoadInput = {
      vehicleId,
      ...(expectedDate !== "" && expectedTime !== ""
        ? { expectedEndsAt: localInputToIso(expectedDate, expectedTime, zone) }
        : {}),
      ...(note.trim() === "" ? {} : { note: note.trim() }),
    };
    void command
      .run((key) => fleetApi.reportOffRoad(fleet.fleetId, body, key), online)
      .then((result) => {
        if (result !== undefined) {
          onReported?.();
        }
      });
  };

  return (
    <ReadGate
      state={vehicles}
      loadingLabel="Loading vehicles…"
      context="vehicles"
      zone={zone}
    >
      {(list) => (
        <form
          onSubmit={submit}
          className="max-w-xl space-y-3 rounded-xl border border-red-500/30 bg-[#1A1A1A] p-4 text-sm"
        >
          <h1 className="text-lg font-bold text-zinc-100">Report off-road</h1>
          <p className="text-xs text-zinc-400">
            For a breakdown or anything that stops the vehicle now. It takes
            effect immediately: bookings that overlap become at risk (never
            cancelled) and the driver and rider decide what happens. UBI reviews
            every report.
          </p>
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            Vehicle
            <select
              required
              value={vehicleId}
              onChange={(event) => setVehicleId(event.target.value)}
              className={input}
            >
              <option value="">Choose…</option>
              {list.vehicles.map((vehicle) => (
                <option key={vehicle.vehicleId} value={vehicle.vehicleId}>
                  {vehicle.plate}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-zinc-400">
              Expected back ({zoneShort(zone, now)}), optional
              <input
                type="date"
                min={localDateOf(now, zone)}
                value={expectedDate}
                onChange={(event) => setExpectedDate(event.target.value)}
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-400">
              <span className="sr-only">Expected back time</span>
              <span aria-hidden>&nbsp;</span>
              <input
                type="time"
                value={expectedTime}
                onChange={(event) => setExpectedTime(event.target.value)}
                className={input}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            Note (optional)
            <input
              value={note}
              maxLength={280}
              onChange={(event) => setNote(event.target.value)}
              className={input}
            />
          </label>
          <p className="text-[11px] text-zinc-500">
            If anyone is unsafe, the driver should use the SOS button. This form
            only reports the vehicle.
          </p>
          <button
            type="submit"
            data-testid={FLEET_TEST_IDS.offRoad.report}
            disabled={
              !online ||
              vehicleId === "" ||
              command.state.status === "pending" ||
              command.state.status === "done"
            }
            className="rounded-md bg-red-500 px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
          >
            {command.state.status === "pending"
              ? "Reporting…"
              : "Report breakdown"}
          </button>
          {command.state.status === "done" ? (
            <div role="status" className="space-y-1 text-xs text-zinc-200">
              {offRoadOutcome(command.state.result.atRiskBookings, zone).map(
                (line) => (
                  <p key={line}>{line}</p>
                ),
              )}
            </div>
          ) : null}
          {command.state.status === "failed" ? (
            <p role="alert" className="text-xs text-red-300">
              {commandErrorText(command.state.error, online)}
            </p>
          ) : null}
        </form>
      )}
    </ReadGate>
  );
};
