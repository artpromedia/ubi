"use client";

/**
 * The fleet's vehicles (entry to B4) and "Add a vehicle" (owners and
 * managers). Status and documents are the server's; a vehicle only takes
 * trips once UBI holds verified documents for it.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { useSelectedFleet } from "@/components/fleet/fleet-context";
import {
  EmptyState,
  PermissionNote,
  Pill,
  ReadGate,
} from "@/components/states/states";
import { commandErrorText, toReadState, type ReadState } from "@/lib/access";
import { fleetApi, fleetKeys } from "@/lib/fleet-api";
import {
  FLEET_VEHICLE_CLASSES,
  type AddFleetVehicleInput,
  type FleetVehicleList,
  type FleetVehicleView,
  type FleetView,
} from "@/lib/fleet-types";
import { useCommand, useOnlineStatus } from "@/lib/hooks";
import { documentLabel, STATUS_NOW_LABELS } from "@/lib/labels";
import { can, permissionCopy } from "@/lib/roles";

const TYPES: readonly AddFleetVehicleInput["type"][] = [
  "SEDAN",
  "SUV",
  "VAN",
  "MOTORCYCLE",
  "ELECTRIC",
];

const field =
  "rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100";

export const AddVehicleForm = ({
  fleet,
  online,
  onAdded,
}: {
  readonly fleet: FleetView;
  readonly online: boolean;
  readonly onAdded?: () => void;
}) => {
  const [form, setForm] = useState({
    plate: "",
    make: "",
    model: "",
    year: "",
    color: "",
    type: "SEDAN" as AddFleetVehicleInput["type"],
    capacity: "4",
    classes: ["go"] as string[],
  });
  const command = useCommand<FleetVehicleView>();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body: AddFleetVehicleInput = {
      plate: form.plate.trim().toUpperCase(),
      make: form.make.trim(),
      model: form.model.trim(),
      year: Number.parseInt(form.year, 10),
      color: form.color.trim(),
      type: form.type,
      capacity: Number.parseInt(form.capacity, 10),
      classes: form.classes,
    };
    void command
      .run((key) => fleetApi.addVehicle(fleet.fleetId, body, key), online)
      .then((result) => {
        if (result !== undefined) {
          onAdded?.();
        }
      });
  };
  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-xl border border-[#222] bg-[#1A1A1A] p-4 text-sm"
    >
      <h2 className="font-semibold text-zinc-100">Add a vehicle</h2>
      <div className="grid gap-2 sm:grid-cols-4">
        {(
          [
            ["plate", "Plate"],
            ["make", "Make"],
            ["model", "Model"],
            ["year", "Year"],
            ["color", "Colour"],
          ] as const
        ).map(([key, label]) => (
          <label
            key={key}
            className="flex flex-col gap-1 text-xs text-zinc-400"
          >
            {label}
            <input
              required
              value={form[key]}
              inputMode={key === "year" ? "numeric" : undefined}
              onChange={(event) =>
                setForm({ ...form, [key]: event.target.value })
              }
              className={field}
            />
          </label>
        ))}
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Type
          <select
            value={form.type}
            onChange={(event) =>
              setForm({
                ...form,
                type: event.target.value as AddFleetVehicleInput["type"],
              })
            }
            className={field}
          >
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {type.toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Seats
          <input
            required
            inputMode="numeric"
            value={form.capacity}
            onChange={(event) =>
              setForm({ ...form, capacity: event.target.value })
            }
            className={field}
          />
        </label>
      </div>
      <fieldset className="flex flex-wrap gap-3 text-xs text-zinc-300">
        <legend className="mb-1 text-zinc-400">Classes</legend>
        {FLEET_VEHICLE_CLASSES.map((cls) => (
          <label key={cls} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={form.classes.includes(cls)}
              onChange={(event) =>
                setForm({
                  ...form,
                  classes: event.target.checked
                    ? [...form.classes, cls]
                    : form.classes.filter((entry) => entry !== cls),
                })
              }
            />
            {cls}
          </label>
        ))}
      </fieldset>
      <p className="text-[11px] text-zinc-500">
        UBI verifies the vehicle&apos;s documents before it can take trips.
      </p>
      <button
        type="submit"
        disabled={
          !online ||
          command.state.status === "pending" ||
          form.classes.length === 0
        }
        className="rounded-md bg-[#1DB954] px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
      >
        {command.state.status === "pending" ? "Adding…" : "Add vehicle"}
      </button>
      {command.state.status === "done" ? (
        <p className="text-xs text-[#86EFAC]">
          {command.state.result.plate} added.
        </p>
      ) : null}
      {command.state.status === "failed" ? (
        <p role="alert" className="text-xs text-red-300">
          {commandErrorText(command.state.error, online)}
        </p>
      ) : null}
    </form>
  );
};

export const VehiclesListView = ({
  fleet,
  state,
  online,
  onAdded,
  onRetry,
}: {
  readonly fleet: FleetView;
  readonly state: ReadState<FleetVehicleList>;
  readonly online: boolean;
  readonly onAdded?: () => void;
  readonly onRetry?: () => void;
}) => {
  const canAdd =
    can(fleet.myRole, "manage_vehicles") && fleet.status === "active";
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-zinc-100">Vehicles</h1>
      <ReadGate
        state={state}
        loadingLabel="Loading vehicles…"
        context="vehicles"
        zone={fleet.zone}
        onRetry={onRetry}
      >
        {(data) =>
          data.vehicles.length === 0 ? (
            <EmptyState title="No vehicles yet. Add a vehicle to start planning." />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[#222] bg-[#141414]">
              <table className="w-full min-w-[760px] text-xs">
                <thead>
                  <tr className="border-b border-[#222] text-left text-zinc-500">
                    <th scope="col" className="px-3 py-2 font-medium">
                      Plate
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Vehicle
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Status now
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Documents
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Drivers today
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.vehicles.map((vehicle) => (
                    <tr
                      key={vehicle.vehicleId}
                      className="border-b border-[#1F1F1F] text-zinc-300"
                    >
                      <td className="px-3 py-2 font-mono font-semibold">
                        <Link
                          href={`/vehicles/${encodeURIComponent(vehicle.vehicleId)}`}
                          className="text-zinc-100 hover:underline"
                        >
                          {vehicle.plate}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        {vehicle.make} {vehicle.model} ·{" "}
                        {vehicle.classes.join(", ")} · {vehicle.capacity} seats
                      </td>
                      <td className="px-3 py-2">
                        <Pill
                          tone={
                            vehicle.statusNow === "in_service" ? "ok" : "mute"
                          }
                        >
                          {STATUS_NOW_LABELS[vehicle.statusNow]}
                        </Pill>
                      </td>
                      <td className="px-3 py-2">
                        {vehicle.documents
                          .map((doc) => documentLabel(doc, fleet.zone))
                          .join(" · ")}
                      </td>
                      <td className="px-3 py-2">
                        {vehicle.drivers.length === 0
                          ? "—"
                          : vehicle.drivers
                              .map((driver) => driver.displayName)
                              .join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </ReadGate>
      {state.kind === "ready" && canAdd ? (
        <AddVehicleForm fleet={fleet} online={online} onAdded={onAdded} />
      ) : null}
      {state.kind === "ready" && !canAdd && fleet.status === "active" ? (
        <PermissionNote>{permissionCopy("manage_vehicles")}</PermissionNote>
      ) : null}
    </div>
  );
};

export const VehiclesScreen = () => {
  const fleet = useSelectedFleet();
  const online = useOnlineStatus();
  const client = useQueryClient();
  const vehicles = useQuery({
    queryKey: fleetKeys.vehicles(fleet.fleetId),
    queryFn: ({ signal }) => fleetApi.vehicles(fleet.fleetId, signal),
  });
  return (
    <VehiclesListView
      fleet={fleet}
      state={toReadState(vehicles, online, "vehicles")}
      online={online}
      onAdded={() =>
        void client.invalidateQueries({
          queryKey: fleetKeys.all(fleet.fleetId),
        })
      }
      onRetry={() => void vehicles.refetch()}
    />
  );
};
