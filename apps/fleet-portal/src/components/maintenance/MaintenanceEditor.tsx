"use client";

/**
 * B5 — the maintenance editor: form (vehicle, kind, start and end in the
 * city's local time) → "Checking impact with the server…" → the impact
 * preview (affected signed shifts, opaque bookings, the server's suggested
 * resolutions) → "Confirm block", disabled until the server says the window
 * is free. A block that meets a booking is HELD (needs_resolution) and its
 * conflicts are resolved with the server's allowed actions. Includes the
 * "Report off-road" path for a breakdown.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { ConflictActions } from "@/components/conflicts/ConflictActions";
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
  useCommand,
  useIdempotencyKey,
  useNow,
  useOnlineStatus,
} from "@/lib/hooks";
import {
  CONFLICT_TITLES,
  MAINTENANCE_KIND_LABELS,
  MAINTENANCE_STATUS_LABELS,
  reasonLabel,
} from "@/lib/labels";
import {
  PLANNED_NEVER_CANCELS,
  affectedAssignmentLines,
  bookingLabel,
  confirmControl,
  formFromWindow,
  formWindow,
  refusalState,
  sameWindow,
  suggestionModels,
  type EditorState,
  type MaintenanceForm,
  type SuggestionModel,
} from "@/lib/maintenance-model";
import { can, permissionCopy } from "@/lib/roles";
import { FLEET_TEST_IDS } from "@/lib/test-ids";
import {
  localDateOf,
  localTimeOf,
  timeRangeIn,
  zoneLabel,
  zoneShort,
} from "@/lib/time";
import { cn } from "@/lib/utils";

import { OffRoadPanel } from "./OffRoadPanel";

import type { ApiError } from "@/lib/api-client";
import type {
  ConflictView,
  FleetVehicleList,
  FleetVehicleView,
  FleetView,
  MaintenanceBlockView,
  MaintenanceWindowInput,
  VehicleSwapRequestView,
} from "@/lib/fleet-types";

const input =
  "rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100";

const SwapChoice = ({
  fleet,
  suggestion,
  online,
}: {
  readonly fleet: FleetView;
  readonly suggestion: Extract<SuggestionModel, { kind: "swap" }>;
  readonly online: boolean;
}) => {
  const command = useCommand<VehicleSwapRequestView>();
  const refusal =
    command.state.status === "failed" &&
    (command.state.error as ApiError | undefined)?.code === "swap_ineligible"
      ? (((command.state.error as ApiError).details?.reasons as
          | string[]
          | undefined) ?? [])
      : null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {suggestion.eligible.map((candidate) => (
        <button
          key={candidate.vehicleId}
          type="button"
          disabled={!online || command.state.status === "pending"}
          onClick={() =>
            void command.run(
              (key) =>
                fleetApi.requestVehicleSwap(
                  fleet.fleetId,
                  suggestion.bookingBlockId,
                  candidate.vehicleId,
                  key,
                ),
              online,
            )
          }
          className="rounded-md border border-zinc-600 px-2 py-0.5 text-[11px] text-zinc-100 disabled:opacity-50"
        >
          Request swap to {candidate.plate}
        </button>
      ))}
      {command.state.status === "done" ? (
        <span className="text-[11px] text-[#86EFAC]">
          {command.state.result.status === "proposed"
            ? "Swap requested. The driver accepts first, then the rider confirms the new vehicle. Check the impact again once they have."
            : `Not eligible: ${command.state.result.reasons.map(reasonLabel).join(", ")}`}
        </span>
      ) : null}
      {refusal !== null ? (
        <span role="alert" className="text-[11px] text-red-300">
          Not eligible: {refusal.map(reasonLabel).join(", ")}
        </span>
      ) : null}
      {refusal === null && command.state.status === "failed" ? (
        <span role="alert" className="text-[11px] text-red-300">
          {commandErrorText(command.state.error, online)}
        </span>
      ) : null}
    </div>
  );
};

export interface MaintenanceEditorViewProps {
  readonly fleet: FleetView;
  readonly vehicles: ReadState<FleetVehicleList>;
  readonly form: MaintenanceForm;
  readonly onForm: (next: Partial<MaintenanceForm>) => void;
  readonly editor: EditorState;
  readonly existingBlock: MaintenanceBlockView | null;
  readonly heldConflicts: readonly ConflictView[];
  readonly online: boolean;
  readonly now: number;
  readonly problem: string | null;
  readonly onCheck: () => void;
  readonly onConfirm: () => void;
  readonly onMoveAndConfirm: (window: {
    readonly startsAt: string;
    readonly endsAt: string;
  }) => void;
  readonly onHold: () => void;
  readonly onRecheck: () => void;
  readonly onCancelBlock: () => void;
  readonly onBack: () => void;
  readonly onChanged?: () => void;
}

const WindowSummary = ({
  fleet,
  window,
  vehicles,
}: {
  readonly fleet: FleetView;
  readonly window: MaintenanceWindowInput;
  readonly vehicles: readonly FleetVehicleView[];
}) => (
  <p className="font-mono text-xs text-zinc-400">
    {vehicles.find((vehicle) => vehicle.vehicleId === window.vehicleId)
      ?.plate ?? "Vehicle"}{" "}
    · {MAINTENANCE_KIND_LABELS[window.kind]} ·{" "}
    {timeRangeIn(window.startsAt, window.endsAt, fleet.zone)}{" "}
    {zoneShort(fleet.zone, new Date(window.startsAt).getTime())}
  </p>
);

export const MaintenanceEditorView = ({
  fleet,
  vehicles,
  form,
  onForm,
  editor,
  existingBlock,
  heldConflicts,
  online,
  now,
  problem,
  onCheck,
  onConfirm,
  onMoveAndConfirm,
  onHold,
  onRecheck,
  onCancelBlock,
  onBack,
  onChanged,
}: MaintenanceEditorViewProps) => {
  const canManage =
    can(fleet.myRole, "manage_maintenance") && fleet.status === "active";
  const control = confirmControl(editor, online, canManage);
  const zone = fleet.zone;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-zinc-100">
          {existingBlock === null
            ? "New maintenance block"
            : "Resolve maintenance block"}
        </h1>
        <span className="font-mono text-xs text-zinc-400">
          {zoneLabel(zone, now)}
        </span>
      </div>
      {!canManage ? (
        <PermissionNote>{permissionCopy("manage_maintenance")}</PermissionNote>
      ) : (
        <ReadGate
          state={vehicles}
          loadingLabel="Loading vehicles…"
          context="vehicles"
          zone={zone}
        >
          {(list) =>
            list.vehicles.length === 0 ? (
              <EmptyState
                title="No vehicles yet. Add a vehicle to start planning."
                action={{ href: "/vehicles", label: "Add a vehicle" }}
              />
            ) : (
              <div className="grid gap-4 xl:grid-cols-[minmax(320px,1fr)_1.4fr]">
                <form
                  data-testid={FLEET_TEST_IDS.maintenance.form}
                  onSubmit={(event) => {
                    event.preventDefault();
                    onCheck();
                  }}
                  className="space-y-3 rounded-xl border border-[#222] bg-[#1A1A1A] p-4 text-sm"
                >
                  <label className="flex flex-col gap-1 text-xs text-zinc-400">
                    Vehicle
                    <select
                      value={form.vehicleId}
                      disabled={existingBlock !== null}
                      onChange={(event) =>
                        onForm({ vehicleId: event.target.value })
                      }
                      className={input}
                    >
                      <option value="">Choose…</option>
                      {list.vehicles.map((vehicle) => (
                        <option
                          key={vehicle.vehicleId}
                          value={vehicle.vehicleId}
                        >
                          {vehicle.plate}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-zinc-400">
                    Type
                    <select
                      value={form.kind}
                      disabled={existingBlock !== null}
                      onChange={(event) =>
                        onForm({
                          kind: event.target.value as MaintenanceForm["kind"],
                        })
                      }
                      className={input}
                    >
                      <option value="planned_service">Planned service</option>
                      <option value="inspection">Inspection</option>
                      <option value="repair">Repair</option>
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1 text-xs text-zinc-400">
                      Starts ({zoneShort(zone, now)})
                      <input
                        type="date"
                        value={form.startDate}
                        onChange={(event) =>
                          onForm({ startDate: event.target.value })
                        }
                        className={input}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-zinc-400">
                      <span className="sr-only">Start time</span>
                      <span aria-hidden>&nbsp;</span>
                      <input
                        type="time"
                        value={form.startTime}
                        onChange={(event) =>
                          onForm({ startTime: event.target.value })
                        }
                        className={input}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-zinc-400">
                      Ends ({zoneShort(zone, now)})
                      <input
                        type="date"
                        value={form.endDate}
                        onChange={(event) =>
                          onForm({ endDate: event.target.value })
                        }
                        className={input}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-zinc-400">
                      <span className="sr-only">End time</span>
                      <span aria-hidden>&nbsp;</span>
                      <input
                        type="time"
                        value={form.endTime}
                        onChange={(event) =>
                          onForm({ endTime: event.target.value })
                        }
                        className={input}
                      />
                    </label>
                  </div>
                  <label className="flex flex-col gap-1 text-xs text-zinc-400">
                    Note (optional)
                    <input
                      value={form.note}
                      maxLength={280}
                      onChange={(event) => onForm({ note: event.target.value })}
                      className={input}
                    />
                  </label>
                  {problem !== null ? (
                    <p role="alert" className="text-xs text-amber-200">
                      {problem}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="submit"
                      disabled={
                        !online ||
                        editor.phase === "checking" ||
                        editor.phase === "saving"
                      }
                      className="rounded-md border border-zinc-600 px-3 py-1.5 text-xs font-semibold text-zinc-100 disabled:opacity-50"
                    >
                      Check impact
                    </button>
                    {control.visible ? (
                      <button
                        type="button"
                        data-testid={FLEET_TEST_IDS.maintenance.confirm}
                        disabled={!control.enabled}
                        aria-describedby="confirm-reason"
                        onClick={onConfirm}
                        className="rounded-md bg-[#1DB954] px-3 py-1.5 text-xs font-semibold text-black disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
                      >
                        {control.label}
                      </button>
                    ) : null}
                  </div>
                  {control.reason !== null ? (
                    <p
                      id="confirm-reason"
                      className="text-[11px] text-zinc-500"
                    >
                      {control.reason}
                    </p>
                  ) : null}
                  <p className="text-[11px] text-zinc-500">
                    {PLANNED_NEVER_CANCELS}
                  </p>
                </form>

                <section
                  data-testid={FLEET_TEST_IDS.maintenance.impactPreview}
                  aria-live="polite"
                  className="space-y-3 rounded-xl border border-[#222] bg-[#1A1A1A] p-4 text-sm"
                >
                  {editor.phase === "form" ? (
                    <p className="text-xs text-zinc-400">
                      Set the window and check its impact. We don&apos;t assume
                      anything is free until the server confirms it.
                    </p>
                  ) : null}
                  {editor.phase === "checking" ? (
                    <div role="status" className="space-y-2">
                      <p className="flex items-center gap-2 text-zinc-200">
                        <span
                          className="h-2 w-2 animate-pulse rounded-full bg-[#5B73C4]"
                          aria-hidden
                        />
                        Checking impact with the server…
                      </p>
                      <WindowSummary
                        fleet={fleet}
                        window={editor.window}
                        vehicles={list.vehicles}
                      />
                      <p className="text-xs text-zinc-500">
                        We don&apos;t assume anything is free until the server
                        confirms it.
                      </p>
                    </div>
                  ) : null}
                  {editor.phase === "preview" || editor.phase === "saving" ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="font-semibold text-zinc-100">
                          Impact preview
                        </h2>
                        <Pill tone={editor.preview.feasible ? "ok" : "bad"}>
                          {editor.preview.feasible
                            ? "No overlap · ready to confirm"
                            : "Must be resolved first"}
                        </Pill>
                      </div>
                      <WindowSummary
                        fleet={fleet}
                        window={editor.window}
                        vehicles={list.vehicles}
                      />
                      <div>
                        <h3 className="text-xs uppercase tracking-wide text-zinc-500">
                          Affected assignment ·{" "}
                          {editor.preview.affectedAssignments.length}
                        </h3>
                        {affectedAssignmentLines(editor.preview, zone).map(
                          (line) => (
                            <div
                              key={`${line.driver}-${line.lost}`}
                              className="mt-1 rounded-md border border-[#262626] p-2 text-xs"
                            >
                              <p className="flex justify-between gap-2 text-zinc-200">
                                <span>{line.driver}</span>
                                <span className="font-mono text-amber-200">
                                  {line.lost}
                                </span>
                              </p>
                              <p className="text-zinc-400">{line.note}</p>
                            </div>
                          ),
                        )}
                      </div>
                      <div>
                        <h3 className="text-xs uppercase tracking-wide text-zinc-500">
                          Affected booking ·{" "}
                          {editor.preview.affectedBlocks.length}
                        </h3>
                        {editor.preview.affectedBlocks.map((block) => (
                          <p
                            key={block.blockId}
                            className="mt-1 flex justify-between gap-2 rounded-md fleet-block-risk px-2 py-1 text-xs"
                          >
                            <span className="font-mono">
                              {bookingLabel(block, zone)}
                            </span>
                            <span>Must be resolved first</span>
                          </p>
                        ))}
                      </div>
                      {editor.preview.suggestions.length > 0 ? (
                        <div>
                          <h3 className="text-xs uppercase tracking-wide text-zinc-500">
                            Choose a resolution
                          </h3>
                          <ul className="mt-1 space-y-2">
                            {suggestionModels(editor.preview, zone).map(
                              (suggestion) => (
                                <li
                                  key={suggestion.key}
                                  data-testid={
                                    FLEET_TEST_IDS.maintenance.resolutionOption
                                  }
                                  data-kind={suggestion.kind}
                                  className="rounded-md border border-[#262626] p-2 text-xs"
                                >
                                  <p className="font-semibold text-zinc-100">
                                    {suggestion.title}
                                  </p>
                                  <p className="text-zinc-400">
                                    {suggestion.detail}
                                  </p>
                                  {suggestion.kind === "move" ? (
                                    <button
                                      type="button"
                                      disabled={
                                        !online || editor.phase === "saving"
                                      }
                                      onClick={() =>
                                        onMoveAndConfirm(suggestion.window)
                                      }
                                      className="mt-2 rounded-md bg-[#1DB954] px-2 py-0.5 text-[11px] font-semibold text-black disabled:opacity-50"
                                    >
                                      Move &amp; confirm
                                    </button>
                                  ) : null}
                                  {suggestion.kind === "swap" ? (
                                    <SwapChoice
                                      fleet={fleet}
                                      suggestion={suggestion}
                                      online={online}
                                    />
                                  ) : null}
                                  {suggestion.kind === "ask_driver" ? (
                                    <button
                                      type="button"
                                      disabled={
                                        !online || editor.phase === "saving"
                                      }
                                      onClick={onHold}
                                      className="mt-2 rounded-md border border-zinc-600 px-2 py-0.5 text-[11px] text-zinc-100 disabled:opacity-50"
                                    >
                                      Hold the block and ask {suggestion.driver}
                                    </button>
                                  ) : null}
                                </li>
                              ),
                            )}
                          </ul>
                        </div>
                      ) : null}
                      <p className="text-[11px] text-zinc-500">
                        Checked by the server at{" "}
                        {localTimeOf(
                          new Date(editor.preview.checkedAt).getTime(),
                          zone,
                        )}{" "}
                        {zoneShort(
                          zone,
                          new Date(editor.preview.checkedAt).getTime(),
                        )}
                        .
                      </p>
                      <button
                        type="button"
                        onClick={onBack}
                        className="text-xs text-zinc-400 underline"
                      >
                        Back to the form
                      </button>
                    </div>
                  ) : null}
                  {editor.phase === "scheduled" ? (
                    <div role="status" className="space-y-1">
                      <Pill tone="ok">
                        {MAINTENANCE_STATUS_LABELS[editor.block.status]}
                      </Pill>
                      <p className="text-zinc-100">
                        {MAINTENANCE_KIND_LABELS[editor.block.kind]} confirmed
                        for{" "}
                        {timeRangeIn(
                          editor.block.startsAt,
                          editor.block.endsAt,
                          zone,
                        )}{" "}
                        {zoneShort(
                          zone,
                          new Date(editor.block.startsAt).getTime(),
                        )}
                        .
                      </p>
                      <p className="text-xs text-zinc-400">
                        The vehicle is held for this window. Drivers on the
                        affected shifts are notified; their signed terms
                        don&apos;t change.
                      </p>
                    </div>
                  ) : null}
                  {editor.phase === "held" ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="font-semibold text-zinc-100">
                          Held · needs resolution
                        </h2>
                        <Pill tone="bad">
                          {MAINTENANCE_STATUS_LABELS.needs_resolution}
                        </Pill>
                      </div>
                      <WindowSummary
                        fleet={fleet}
                        window={editor.window}
                        vehicles={list.vehicles}
                      />
                      <p className="text-xs text-zinc-400">
                        This block overlaps a confirmed booking, so it
                        doesn&apos;t hold the vehicle yet. Resolve each booking
                        below, then re-check.
                      </p>
                      {editor.details.affectedBlocks.map((block) => (
                        <p
                          key={block.blockId}
                          className="flex justify-between gap-2 rounded-md fleet-block-risk px-2 py-1 text-xs"
                        >
                          <span className="font-mono">
                            {bookingLabel(block, zone)}
                          </span>
                          <span>Must be resolved first</span>
                        </p>
                      ))}
                      {heldConflicts.map((conflict) => (
                        <div
                          key={conflict.conflictId}
                          className="rounded-md border border-[#262626] p-2 text-xs"
                        >
                          <p className="mb-1 font-semibold text-zinc-100">
                            {CONFLICT_TITLES[conflict.type]}
                          </p>
                          {conflict.allowedActions.length === 0 ? (
                            <p className="text-zinc-500">View only</p>
                          ) : (
                            <ConflictActions
                              fleetId={fleet.fleetId}
                              conflict={conflict}
                              zone={zone}
                              online={online}
                              vehicles={list.vehicles}
                              onDone={onChanged}
                            />
                          )}
                        </div>
                      ))}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={!online}
                          onClick={onRecheck}
                          className="rounded-md bg-[#1DB954] px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
                        >
                          Re-check with the server
                        </button>
                        <button
                          type="button"
                          disabled={!online}
                          onClick={onCancelBlock}
                          className="rounded-md border border-zinc-600 px-3 py-1.5 text-xs text-zinc-200 disabled:opacity-50"
                        >
                          Cancel block
                        </button>
                      </div>
                      <p className="text-[11px] text-zinc-500">
                        Only the driver can withdraw from a booking. Planned
                        maintenance never cancels one.
                      </p>
                    </div>
                  ) : null}
                  {editor.phase === "refused" ? (
                    <p
                      role="alert"
                      className={cn(
                        "rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200",
                      )}
                    >
                      {editor.message}
                    </p>
                  ) : null}
                </section>
              </div>
            )
          }
        </ReadGate>
      )}
    </div>
  );
};

const emptyForm = (vehicleId: string, today: string): MaintenanceForm => ({
  vehicleId,
  kind: "planned_service",
  startDate: today,
  startTime: "10:00",
  endDate: today,
  endTime: "15:00",
  note: "",
});

export const MaintenanceEditorScreen = () => {
  const fleet = useSelectedFleet();
  const online = useOnlineStatus();
  const now = useNow(60_000);
  const client = useQueryClient();
  const params = useSearchParams();
  const blockId = params.get("blockId");
  const initialVehicle = params.get("vehicleId") ?? "";
  const [mode, setMode] = useState<"planned" | "off_road">(
    params.get("mode") === "off-road" ? "off_road" : "planned",
  );
  const [form, setForm] = useState<MaintenanceForm>(() =>
    emptyForm(initialVehicle, localDateOf(now, fleet.zone)),
  );
  const [editor, setEditor] = useState<EditorState>({ phase: "form" });
  const [problem, setProblem] = useState<string | null>(null);
  const [loadedBlock, setLoadedBlock] = useState<string | null>(null);
  // A block this screen created that the server HELD (needs_resolution):
  // later saves move or re-check it instead of creating another block.
  const [heldBlock, setHeldBlock] = useState<MaintenanceBlockView | null>(null);
  const saveKey = useIdempotencyKey();

  const vehicles = useQuery({
    queryKey: fleetKeys.vehicles(fleet.fleetId),
    queryFn: ({ signal }) => fleetApi.vehicles(fleet.fleetId, signal),
  });
  const blocks = useQuery({
    queryKey: fleetKeys.maintenance(fleet.fleetId, initialVehicle || undefined),
    queryFn: ({ signal }) =>
      fleetApi.maintenance(
        fleet.fleetId,
        { vehicleId: initialVehicle || undefined },
        signal,
      ),
    enabled: blockId !== null,
  });
  const existingBlock = useMemo(
    () =>
      blockId === null
        ? null
        : (blocks.data?.blocks.find((block) => block.blockId === blockId) ??
          null),
    [blockId, blocks.data],
  );
  if (
    existingBlock !== null &&
    loadedBlock !== existingBlock.blockId &&
    existingBlock.endsAt !== null
  ) {
    // Resolve mode: start from the held block's own window.
    setLoadedBlock(existingBlock.blockId);
    setForm(
      formFromWindow(
        { startsAt: existingBlock.startsAt, endsAt: existingBlock.endsAt },
        {
          ...form,
          vehicleId: existingBlock.vehicleId,
          kind:
            existingBlock.kind === "unplanned_off_road"
              ? "repair"
              : existingBlock.kind,
          note: existingBlock.note ?? "",
        },
        fleet.zone,
      ),
    );
  }
  const activeBlock = existingBlock ?? heldBlock;
  const heldIds = editor.phase === "held" ? editor.details.conflictIds : [];
  const conflicts = useQuery({
    queryKey: fleetKeys.conflicts(fleet.fleetId, "open"),
    queryFn: ({ signal }) => fleetApi.conflicts(fleet.fleetId, "open", signal),
    enabled: heldIds.length > 0,
  });
  const heldConflicts = (conflicts.data?.conflicts ?? []).filter((conflict) =>
    heldIds.includes(conflict.conflictId),
  );
  const refresh = () =>
    void client.invalidateQueries({ queryKey: fleetKeys.all(fleet.fleetId) });

  const preview = async (window: MaintenanceWindowInput) => {
    setEditor({ phase: "checking", window });
    try {
      const result = await fleetApi.previewMaintenance(fleet.fleetId, window);
      setEditor({ phase: "preview", window, preview: result });
      return result;
    } catch (error) {
      setEditor(
        refusalState(error, window, null) ?? {
          phase: "refused",
          window,
          message: commandErrorText(error, online),
        },
      );
      return null;
    }
  };

  const save = async (window: MaintenanceWindowInput, previewToken: string) => {
    const note = form.note.trim() === "" ? undefined : form.note.trim();
    try {
      const key = saveKey.current();
      let block: MaintenanceBlockView;
      if (activeBlock === null) {
        block = await fleetApi.createMaintenance(
          fleet.fleetId,
          { ...window, note, previewToken },
          key,
        );
      } else if (
        activeBlock.endsAt !== null &&
        sameWindow(activeBlock, window)
      ) {
        // The held block's own window: re-check it (every overlap resolved?).
        block = await fleetApi.confirmMaintenance(
          fleet.fleetId,
          activeBlock.blockId,
          previewToken,
          key,
        );
      } else {
        block = await fleetApi.moveMaintenance(
          fleet.fleetId,
          activeBlock.blockId,
          {
            startsAt: window.startsAt,
            endsAt: window.endsAt,
            note,
            previewToken,
          },
          key,
        );
      }
      saveKey.settle({ ok: true });
      setHeldBlock(null);
      setEditor({ phase: "scheduled", block });
      refresh();
    } catch (error) {
      saveKey.settle({ ok: false, error }, online);
      const refused = refusalState(error, window, previewToken);
      setEditor(
        refused ?? {
          phase: "refused",
          window,
          message: commandErrorText(error, online),
        },
      );
      if (refused?.phase === "held") {
        setHeldBlock(refused.details.block);
        refresh();
      }
    }
  };

  const onCheck = () => {
    const result = formWindow(form, fleet.zone);
    if ("problem" in result) {
      setProblem(result.problem);
      return;
    }
    setProblem(null);
    void preview(result.window);
  };

  const onConfirm = () => {
    if (editor.phase !== "preview" || !editor.preview.feasible) {
      return;
    }
    setEditor({
      phase: "saving",
      window: editor.window,
      preview: editor.preview,
    });
    void save(editor.window, editor.preview.previewToken);
  };

  if (mode === "off_road") {
    return (
      <div className="space-y-4">
        <ModeSwitch mode={mode} onMode={setMode} />
        <OffRoadPanel
          fleet={fleet}
          vehicles={toReadState(vehicles, online, "vehicles")}
          online={online}
          now={now}
          defaultVehicleId={initialVehicle}
          onReported={refresh}
        />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <ModeSwitch mode={mode} onMode={setMode} />
      <MaintenanceEditorView
        fleet={fleet}
        vehicles={toReadState(vehicles, online, "vehicles")}
        form={form}
        onForm={(next) => {
          setForm({ ...form, ...next });
          if (editor.phase !== "checking" && editor.phase !== "saving") {
            // Any change to the window invalidates the server's answer.
            setEditor({ phase: "form" });
          }
        }}
        editor={editor}
        existingBlock={activeBlock}
        heldConflicts={heldConflicts}
        online={online}
        now={now}
        problem={problem}
        onCheck={onCheck}
        onConfirm={onConfirm}
        onMoveAndConfirm={(window) => {
          if (editor.phase !== "preview") {
            return;
          }
          const moved = {
            ...editor.window,
            startsAt: window.startsAt,
            endsAt: window.endsAt,
          };
          setForm(formFromWindow(window, form, fleet.zone));
          void preview(moved).then((result) => {
            if (result?.feasible === true) {
              setEditor({ phase: "saving", window: moved, preview: result });
              void save(moved, result.previewToken);
            }
          });
        }}
        onHold={() => {
          if (editor.phase === "preview") {
            setEditor({
              phase: "saving",
              window: editor.window,
              preview: editor.preview,
            });
            void save(editor.window, editor.preview.previewToken);
          }
        }}
        onRecheck={() => {
          if (editor.phase === "held") {
            const blockToCheck = editor.details.block;
            void (async () => {
              try {
                const key = saveKey.current();
                const block = await fleetApi.confirmMaintenance(
                  fleet.fleetId,
                  blockToCheck.blockId,
                  editor.previewToken,
                  key,
                );
                saveKey.settle({ ok: true });
                setHeldBlock(null);
                setEditor({ phase: "scheduled", block });
                refresh();
              } catch (error) {
                saveKey.settle({ ok: false, error }, online);
                setEditor(
                  refusalState(error, editor.window, editor.previewToken) ?? {
                    phase: "refused",
                    window: editor.window,
                    message: commandErrorText(error, online),
                  },
                );
              }
            })();
          }
        }}
        onCancelBlock={() => {
          if (editor.phase === "held") {
            const held = editor;
            void (async () => {
              try {
                const key = saveKey.current();
                await fleetApi.cancelMaintenance(
                  fleet.fleetId,
                  held.details.block.blockId,
                  key,
                );
                saveKey.settle({ ok: true });
                setHeldBlock(null);
                setEditor({
                  phase: "refused",
                  window: held.window,
                  message: "Block cancelled. Nothing was held on the vehicle.",
                });
                refresh();
              } catch (error) {
                saveKey.settle({ ok: false, error }, online);
                setEditor({
                  phase: "refused",
                  window: held.window,
                  message: commandErrorText(error, online),
                });
              }
            })();
          }
        }}
        onBack={() => setEditor({ phase: "form" })}
        onChanged={refresh}
      />
    </div>
  );
};

const ModeSwitch = ({
  mode,
  onMode,
}: {
  readonly mode: "planned" | "off_road";
  readonly onMode: (mode: "planned" | "off_road") => void;
}) => (
  <div className="flex gap-1" role="group" aria-label="Kind of downtime">
    <button
      type="button"
      aria-pressed={mode === "planned"}
      onClick={() => onMode("planned")}
      className={
        mode === "planned"
          ? "rounded-full bg-[#1DB954] px-3 py-1 text-xs font-semibold text-black"
          : "rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300"
      }
    >
      Planned maintenance
    </button>
    <button
      type="button"
      aria-pressed={mode === "off_road"}
      onClick={() => onMode("off_road")}
      className={
        mode === "off_road"
          ? "rounded-full bg-red-500 px-3 py-1 text-xs font-semibold text-black"
          : "rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300"
      }
    >
      Report off-road
    </button>
  </div>
);
