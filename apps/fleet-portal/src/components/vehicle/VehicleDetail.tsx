"use client";

/**
 * B4 — vehicle detail: documents plotted against 30 days of commitments,
 * maintenance upcoming and past, the drivers and shifts signed on it (with
 * the terms version), and the week's money as separate lines — week gross,
 * UBI commission, fleet remittance, remittance status — never a driver's
 * net (decisions Q7).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Car, Wrench } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useSelectedFleet } from "@/components/fleet/fleet-context";
import { computeSha256Hex } from "@/components/fleet/KybOnboardingPanel";
import {
  EmptyState,
  PermissionNote,
  Pill,
  ReadGate,
} from "@/components/states/states";
import {
  commandErrorText,
  isWriteReachable,
  toReadState,
  type ReadState,
} from "@/lib/access";
import { remittanceText } from "@/lib/assignment-model";
import { fleetApi, fleetKeys } from "@/lib/fleet-api";
import { useCommand, useNow, useOnlineStatus } from "@/lib/hooks";
import { shiftName, STATUS_NOW_LABELS } from "@/lib/labels";
import { can, permissionCopy } from "@/lib/roles";
import { FLEET_ACCOUNT_TEST_IDS, FLEET_TEST_IDS } from "@/lib/test-ids";
import { addDays, localDateOf, startOfLocalDay, toIso } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  blockMoves,
  documentsTimeline,
  maintenanceLines,
  weekMoneyLines,
  type MaintenanceLine,
  type WeekMoneyAvailable,
} from "@/lib/vehicle-model";

import type {
  ArrangementView,
  ConflictView,
  FleetCalendar,
  FleetDocumentContentType,
  FleetVehicleView,
  FleetView,
  MaintenanceBlockView,
  MaintenanceList,
  MoneyUnavailable,
  VehicleDocumentType,
  VehicleDocumentView,
} from "@/lib/fleet-types";

const MOVE_LABELS = {
  cancel: "Cancel block",
  complete: "Vehicle back in service",
} as const;
const BLOCK_TONE: Partial<
  Record<MaintenanceBlockView["status"], "bad" | "warn">
> = {
  needs_resolution: "bad",
  active: "warn",
};
const STATUS_TONE: Partial<
  Record<FleetVehicleView["statusNow"], "ok" | "mute">
> = {
  in_service: "ok",
  unassigned: "mute",
};
const MARKER_TONE = {
  bad: "bg-red-500/20 text-red-200",
  warn: "bg-amber-500/20 text-amber-200",
  ok: "bg-zinc-800 text-zinc-300",
} as const;
const CARD_TONE = {
  bad: "text-red-300",
  warn: "text-amber-200",
  ok: "text-zinc-100",
} as const;

export interface VehicleDetailViewProps {
  readonly fleet: FleetView;
  readonly vehicle: ReadState<FleetVehicleView>;
  readonly availability: ReadState<FleetCalendar>;
  readonly maintenance: ReadState<MaintenanceList>;
  readonly arrangements: readonly ArrangementView[];
  readonly conflicts: readonly ConflictView[];
  readonly vehicleDocuments?: readonly VehicleDocumentView[];
  readonly now: number;
  readonly online: boolean;
  readonly onChanged?: () => void;
  readonly onRetry?: () => void;
}

const BlockMoveButton = ({
  fleet,
  block,
  move,
  online,
  onChanged,
}: {
  readonly fleet: FleetView;
  readonly block: MaintenanceBlockView;
  readonly move: "cancel" | "complete";
  readonly online: boolean;
  readonly onChanged?: () => void;
}) => {
  const command = useCommand<MaintenanceBlockView>();
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        disabled={!online || command.state.status === "pending"}
        onClick={() =>
          void command
            .run(
              (key) =>
                move === "cancel"
                  ? fleetApi.cancelMaintenance(
                      fleet.fleetId,
                      block.blockId,
                      key,
                    )
                  : fleetApi.completeMaintenance(
                      fleet.fleetId,
                      block.blockId,
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
        {command.state.status === "pending" ? "Saving…" : MOVE_LABELS[move]}
      </button>
      {command.state.status === "failed" ? (
        <span
          role="alert"
          className="max-w-[220px] text-right text-[10.5px] text-red-300"
        >
          {commandErrorText(command.state.error, online)}
        </span>
      ) : null}
    </span>
  );
};

const MaintenanceRow = ({
  fleet,
  line,
  canManage,
  now,
  online,
  onChanged,
}: {
  readonly fleet: FleetView;
  readonly line: MaintenanceLine;
  readonly canManage: boolean;
  readonly now: number;
  readonly online: boolean;
  readonly onChanged?: () => void;
}) => {
  const moves = canManage ? blockMoves(line.block, now) : [];
  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-[#1F1F1F] py-2 text-xs last:border-0">
      <span className="w-40 font-semibold text-zinc-100">{line.kind}</span>
      <span className="font-mono text-zinc-400">{line.when}</span>
      <Pill tone={BLOCK_TONE[line.block.status] ?? "mute"}>{line.status}</Pill>
      <span className="ml-auto flex gap-2">
        {moves.includes("resolve") && online ? (
          <Link
            href={`/maintenance/new?blockId=${encodeURIComponent(line.block.blockId)}&vehicleId=${encodeURIComponent(line.block.vehicleId)}`}
            className="rounded bg-[#1DB954] px-2 py-0.5 text-[11px] font-semibold text-black"
          >
            Resolve →
          </Link>
        ) : null}
        {moves.includes("cancel") ? (
          <BlockMoveButton
            fleet={fleet}
            block={line.block}
            move="cancel"
            online={online}
            onChanged={onChanged}
          />
        ) : null}
        {moves.includes("complete") ? (
          <BlockMoveButton
            fleet={fleet}
            block={line.block}
            move="complete"
            online={online}
            onChanged={onChanged}
          />
        ) : null}
      </span>
    </li>
  );
};

/** The week's money: exactly four lines, the server's values or "Not available yet". */
export const WeekMoneyPanel = ({
  money,
}: {
  readonly money: MoneyUnavailable | WeekMoneyAvailable;
}) => {
  const view = weekMoneyLines(money);
  return (
    <section
      data-testid={FLEET_TEST_IDS.vehicle.weekMoney}
      className="rounded-xl border border-[#222] bg-[#1A1A1A] p-4 text-sm"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-semibold text-zinc-100">This week</h2>
        <Link
          href="/remittance"
          className="text-xs font-medium text-[#1DB954] hover:underline"
        >
          Remittance statement →
        </Link>
      </div>
      <dl className="space-y-1.5">
        {view.lines.map((line) => (
          <div key={line.label} className="flex justify-between gap-3">
            <dt className="text-zinc-400">{line.label}</dt>
            <dd
              className={cn(
                view.available
                  ? "font-semibold text-zinc-100"
                  : "text-zinc-500",
              )}
            >
              {line.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[11px] text-zinc-500">
        {view.note} Fleets don&apos;t see a driver&apos;s net earnings.
      </p>
    </section>
  );
};

const DOC_TYPE_LABELS: Readonly<Record<VehicleDocumentType, string>> = {
  insurance: "Insurance",
  inspection: "Roadworthiness / inspection",
  registration: "Vehicle registration",
};

const DOC_STATUS_TONES: Readonly<
  Record<VehicleDocumentView["status"], "ok" | "warn" | "bad" | "mute">
> = {
  valid: "ok",
  pending: "warn",
  rejected: "bad",
  expired: "mute",
};

const ALLOWED_DOC_TYPES: readonly FleetDocumentContentType[] = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];

const VehicleDocumentsPanel = ({
  fleet,
  vehicleId,
  documents,
  online,
  onChanged,
}: {
  readonly fleet: FleetView;
  readonly vehicleId: string;
  readonly documents: readonly VehicleDocumentView[];
  readonly online: boolean;
  readonly onChanged?: () => void;
}) => {
  const canUpload =
    can(fleet.myRole, "manage_vehicles") && fleet.status !== "suspended";
  const [docType, setDocType] = useState<VehicleDocumentType>("insurance");
  const [expiresDate, setExpiresDate] = useState("");
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const attachCmd = useCommand<VehicleDocumentView>();

  const handleFileChange = async (file: File) => {
    setUploadError(null);
    const contentType = file.type as FleetDocumentContentType;
    if (!ALLOWED_DOC_TYPES.includes(contentType)) {
      setUploadError(
        "Unsupported file type. Upload a PDF, JPEG, PNG, or WebP document.",
      );
      return;
    }
    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const sha256Hex = await computeSha256Hex(buffer);
      const slot = await fleetApi.createVehicleDocumentUpload(
        fleet.fleetId,
        vehicleId,
        {
          purpose: "vehicle_document",
          contentType,
          sizeBytes: buffer.byteLength,
          sha256Hex,
        },
        `veh-doc-up-${vehicleId}-${docType}-${sha256Hex.slice(0, 12)}`,
      );
      const putRes = await fetch(slot.uploadUrl, {
        method: "PUT",
        headers: slot.requiredHeaders,
        body: buffer,
      });
      if (!putRes.ok) {
        throw new Error(`Upload failed with status ${putRes.status}`);
      }
      setUploadId(slot.uploadId);
    } catch (error) {
      setUploadError(commandErrorText(error, online));
    } finally {
      setUploading(false);
    }
  };

  return (
    <section
      id="documents"
      data-testid={FLEET_ACCOUNT_TEST_IDS.documents.list}
      className="space-y-3 rounded-xl border border-[#222] bg-[#1A1A1A] p-4 text-xs"
    >
      <div>
        <h2 className="text-sm font-semibold text-zinc-100">
          Vehicle documents &amp; renewals
        </h2>
        <p className="text-zinc-400">
          Uploaded certificates are verified by UBI operations before the new
          expiry date takes effect.
        </p>
      </div>

      {documents.length === 0 ? (
        <p className="text-zinc-500">
          No document renewals uploaded for this vehicle yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {documents.map((doc) => (
            <li
              key={doc.documentId}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-[#262626] bg-[#141414] px-3 py-2"
            >
              <div>
                <p className="font-medium text-zinc-100">
                  {DOC_TYPE_LABELS[doc.docType]} · expires{" "}
                  <span className="font-mono">
                    {doc.expiresAt.slice(0, 10)}
                  </span>
                </p>
                {doc.reviewNote ? (
                  <p className="text-[11px] text-amber-200">
                    UBI review note: {doc.reviewNote}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Pill tone={DOC_STATUS_TONES[doc.status]}>{doc.status}</Pill>
                {canUpload ? (
                  <button
                    type="button"
                    disabled={!online}
                    onClick={() => {
                      void fleetApi
                        .vehicleDocumentUrl(
                          fleet.fleetId,
                          vehicleId,
                          doc.documentId,
                        )
                        .then((link) => {
                          window.open(
                            link.url,
                            "_blank",
                            "noopener,noreferrer",
                          );
                        });
                    }}
                    className="text-[#86EFAC] underline disabled:opacity-50"
                  >
                    Open private link
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canUpload ? (
        <form
          data-testid={FLEET_ACCOUNT_TEST_IDS.documents.uploadRenewal}
          onSubmit={(event) => {
            event.preventDefault();
            if (!uploadId || !expiresDate) return;
            void attachCmd
              .run(
                (key) =>
                  fleetApi.attachVehicleDocument(
                    fleet.fleetId,
                    vehicleId,
                    {
                      uploadId,
                      docType,
                      expiresAt: `${expiresDate}T23:59:59.000Z`,
                    },
                    key,
                  ),
                online,
              )
              .then((res) => {
                if (res !== undefined) {
                  setUploadId(null);
                  setExpiresDate("");
                  onChanged?.();
                }
              });
          }}
          className="grid gap-2 border-t border-[#262626] pt-3 sm:grid-cols-3"
        >
          <label className="flex flex-col gap-1 text-zinc-300">
            Document type
            <select
              value={docType}
              onChange={(e) =>
                setDocType(e.target.value as VehicleDocumentType)
              }
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-100"
            >
              <option value="insurance">Insurance</option>
              <option value="inspection">Roadworthiness / inspection</option>
              <option value="registration">Vehicle registration</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-zinc-300">
            Expiry date
            <input
              type="date"
              value={expiresDate}
              onChange={(e) => setExpiresDate(e.target.value)}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-100"
            />
          </label>
          <div className="flex flex-col justify-end gap-1">
            <label className="cursor-pointer rounded border border-zinc-600 px-2.5 py-1.5 text-center text-zinc-100 hover:bg-zinc-800">
              {uploading
                ? "Uploading…"
                : uploadId
                  ? "Replace document file"
                  : "Choose document file"}
              <input
                type="file"
                accept=".pdf,image/jpeg,image/png,image/webp"
                disabled={!online || uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    void handleFileChange(file);
                  }
                }}
                className="sr-only"
              />
            </label>
          </div>
          <div className="sm:col-span-3">
            <button
              type="submit"
              data-testid={FLEET_ACCOUNT_TEST_IDS.documents.uploadSubmit}
              disabled={
                !online ||
                uploading ||
                uploadId === null ||
                expiresDate === "" ||
                attachCmd.state.status === "pending"
              }
              className="rounded-md bg-[#1DB954] px-3 py-1.5 font-semibold text-black disabled:opacity-50"
            >
              {attachCmd.state.status === "pending"
                ? "Submitting…"
                : "Submit document renewal"}
            </button>
          </div>
          {uploadError ? (
            <p role="alert" className="text-red-300 sm:col-span-3">
              {uploadError}
            </p>
          ) : null}
          {attachCmd.state.status === "done" ? (
            <p className="text-[#86EFAC] sm:col-span-3">
              Document submitted for UBI verification.
            </p>
          ) : null}
          {attachCmd.state.status === "failed" ? (
            <p role="alert" className="text-red-300 sm:col-span-3">
              {commandErrorText(attachCmd.state.error, online)}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
};

export const VehicleDetailView = ({
  fleet,
  vehicle,
  availability,
  maintenance,
  arrangements,
  conflicts,
  vehicleDocuments,
  now,
  online,
  onChanged,
  onRetry,
}: VehicleDetailViewProps) => {
  const reachable = isWriteReachable(online, vehicle);
  const maintenanceReachable = isWriteReachable(online, vehicle, maintenance);
  const canManage =
    can(fleet.myRole, "manage_maintenance") && fleet.status === "active";
  return (
    <ReadGate
      state={vehicle}
      loadingLabel="Loading vehicle…"
      context="this vehicle"
      zone={fleet.zone}
      onRetry={onRetry}
    >
      {(car) => {
        const mine = conflicts.filter(
          (conflict) =>
            (conflict.status === "open" || conflict.status === "resolving") &&
            conflict.subjects.some(
              (subject) => subject.vehicleId === car.vehicleId,
            ),
        );
        return (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Car className="h-6 w-6 text-zinc-400" aria-hidden />
              <div>
                <h1 className="font-mono text-xl font-bold text-zinc-100">
                  {car.plate}
                </h1>
                <p className="text-xs text-zinc-400">
                  {car.make} {car.model} {car.year} · {car.color} ·{" "}
                  {car.classes.join(", ")} · {car.capacity} seats
                </p>
              </div>
              <Pill tone={STATUS_TONE[car.statusNow] ?? "warn"}>
                {STATUS_NOW_LABELS[car.statusNow]}
              </Pill>
              {mine.length > 0 ? (
                <Link href="/conflicts">
                  <Pill tone="bad">
                    {mine.length} {mine.length === 1 ? "conflict" : "conflicts"}
                  </Pill>
                </Link>
              ) : null}
              {canManage && reachable ? (
                <Link
                  href={`/maintenance/new?vehicleId=${encodeURIComponent(car.vehicleId)}`}
                  className="ml-auto flex items-center gap-1 rounded-lg bg-[#1DB954] px-3 py-1.5 text-xs font-semibold text-black"
                >
                  <Wrench className="h-3.5 w-3.5" aria-hidden />
                  Add maintenance
                </Link>
              ) : null}
              {can(fleet.myRole, "report_off_road") &&
              fleet.status === "active" &&
              reachable ? (
                <Link
                  href={`/maintenance/new?mode=off-road&vehicleId=${encodeURIComponent(car.vehicleId)}`}
                  className="rounded-lg border border-red-500/60 px-3 py-1.5 text-xs font-semibold text-red-200"
                >
                  Report off-road
                </Link>
              ) : null}
            </div>
            {!canManage && fleet.status === "active" ? (
              <PermissionNote>
                {permissionCopy("manage_maintenance")}
              </PermissionNote>
            ) : null}

            <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
              <div className="space-y-4">
                <section
                  data-testid={FLEET_TEST_IDS.vehicle.documentsTimeline}
                  className="rounded-xl border border-[#222] bg-[#1A1A1A] p-4"
                >
                  <ReadGate
                    state={availability}
                    loadingLabel="Loading commitments…"
                    context="the next 30 days"
                    zone={fleet.zone}
                  >
                    {(calendar) => {
                      const row = calendar.rows[0];
                      const timeline = documentsTimeline({
                        documents: car.documents,
                        occupied: row?.occupied ?? [],
                        conflicts,
                        from: calendar.from,
                        to: calendar.to,
                        zone: fleet.zone,
                      });
                      return (
                        <div className="space-y-3">
                          <div className="flex justify-between text-sm">
                            <h2 className="font-semibold text-zinc-100">
                              Documents against upcoming commitments
                            </h2>
                            <span className="text-xs text-zinc-500">
                              {timeline.rangeLabel}
                            </span>
                          </div>
                          <div
                            className="relative h-16 rounded-lg bg-[#141414]"
                            aria-hidden
                          >
                            {timeline.bookings.map((booking) => (
                              <span
                                key={booking.blockId}
                                title={booking.label}
                                className={cn(
                                  "absolute top-8 h-5 w-1.5 rounded-sm",
                                  booking.afterExpiry || booking.atRisk
                                    ? "bg-red-500"
                                    : "bg-[#5B73C4]",
                                )}
                                style={{ left: `${booking.pct}%` }}
                              />
                            ))}
                            {timeline.markers.map((marker) => (
                              <span
                                key={marker.key}
                                className={cn(
                                  "absolute top-1 -translate-x-1/2 whitespace-nowrap rounded px-1 text-[10px]",
                                  MARKER_TONE[marker.tone],
                                )}
                                style={{
                                  left: `${Math.min(Math.max(marker.pct, 8), 92)}%`,
                                }}
                              >
                                {marker.label}
                              </span>
                            ))}
                          </div>
                          <ul className="space-y-1 text-xs text-zinc-300">
                            {timeline.bookings.length === 0 ? (
                              <li className="text-zinc-500">
                                No bookings in the next 30 days.
                              </li>
                            ) : null}
                            {timeline.bookings.map((booking) => (
                              <li key={booking.blockId} className="font-mono">
                                {booking.label}
                                {booking.atRisk ? " · At risk" : ""}
                                {booking.afterExpiry
                                  ? " · Booking after document expiry (flagged by UBI)"
                                  : ""}
                              </li>
                            ))}
                          </ul>
                          <div className="grid gap-2 sm:grid-cols-3">
                            {timeline.cards.map((card) => (
                              <div
                                key={card.title}
                                className="rounded-lg border border-[#262626] p-2 text-xs"
                              >
                                <p className="text-zinc-500">{card.title}</p>
                                <p
                                  className={cn(
                                    "font-semibold",
                                    CARD_TONE[card.tone],
                                  )}
                                >
                                  {card.status}
                                </p>
                                <p className="text-zinc-400">{card.hint}</p>
                              </div>
                            ))}
                            <div className="rounded-lg border border-[#262626] p-2 text-xs">
                              <p className="text-zinc-500">Enforcement</p>
                              <p className="font-semibold text-zinc-100">
                                By UBI
                              </p>
                              <p className="text-zinc-400">
                                Status only. There is no override.
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  </ReadGate>
                </section>

                <VehicleDocumentsPanel
                  fleet={fleet}
                  vehicleId={car.vehicleId}
                  documents={vehicleDocuments ?? []}
                  online={reachable}
                  onChanged={onChanged}
                />

                <section
                  id="maintenance"
                  data-testid={FLEET_TEST_IDS.vehicle.maintenanceList}
                  className="rounded-xl border border-[#222] bg-[#1A1A1A] p-4"
                >
                  <h2 className="mb-2 text-sm font-semibold text-zinc-100">
                    Maintenance
                  </h2>
                  <ReadGate
                    state={maintenance}
                    loadingLabel="Loading maintenance…"
                    context="maintenance"
                    zone={fleet.zone}
                  >
                    {(list) => {
                      const lines = maintenanceLines(
                        list.blocks,
                        now,
                        fleet.zone,
                      );
                      return (
                        <div className="space-y-3">
                          <div>
                            <h3 className="text-xs uppercase tracking-wide text-zinc-500">
                              Upcoming
                            </h3>
                            {lines.upcoming.length === 0 ? (
                              <p className="py-2 text-xs text-zinc-500">
                                No upcoming maintenance.
                              </p>
                            ) : (
                              <ul>
                                {lines.upcoming.map((line) => (
                                  <MaintenanceRow
                                    key={line.block.blockId}
                                    fleet={fleet}
                                    line={line}
                                    canManage={canManage}
                                    now={now}
                                    online={maintenanceReachable}
                                    onChanged={onChanged}
                                  />
                                ))}
                              </ul>
                            )}
                          </div>
                          <div>
                            <h3 className="text-xs uppercase tracking-wide text-zinc-500">
                              Past
                            </h3>
                            {lines.past.length === 0 ? (
                              <p className="py-2 text-xs text-zinc-500">
                                No past maintenance.
                              </p>
                            ) : (
                              <ul>
                                {lines.past.map((line) => (
                                  <MaintenanceRow
                                    key={line.block.blockId}
                                    fleet={fleet}
                                    line={line}
                                    canManage={false}
                                    now={now}
                                    online={maintenanceReachable}
                                  />
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      );
                    }}
                  </ReadGate>
                </section>
              </div>

              <div className="space-y-4">
                <section className="rounded-xl border border-[#222] bg-[#1A1A1A] p-4 text-sm">
                  <h2 className="mb-2 font-semibold text-zinc-100">
                    Assigned drivers
                  </h2>
                  {car.drivers.length === 0 ? (
                    <p className="text-xs text-zinc-500">
                      No driver has a signed shift on this vehicle today.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {car.drivers.map((driver) => {
                        const arrangement = arrangements.find(
                          (entry) =>
                            entry.driverId === driver.driverId &&
                            entry.vehicleId === car.vehicleId &&
                            entry.termsVersion === driver.termsVersion,
                        );
                        return (
                          <li
                            key={`${driver.driverId}-${driver.termsVersion}`}
                            className="text-xs"
                          >
                            <p className="font-semibold text-zinc-100">
                              {driver.displayName} · {shiftName(driver.shift)}
                            </p>
                            <p className="text-zinc-400">
                              Terms v{driver.termsVersion}
                              {arrangement !== undefined
                                ? ` · ${remittanceText(arrangement.terms)}`
                                : ""}
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <p className="mt-3 text-[11px] text-zinc-500">
                    To add a driver or a shift, propose an assignment. It only
                    takes effect once the driver signs.
                  </p>
                  {can(fleet.myRole, "propose_assignment") &&
                  fleet.status === "active" ? (
                    <Link
                      href={`/assignments?vehicleId=${encodeURIComponent(car.vehicleId)}`}
                      className="mt-1 inline-block text-xs text-[#86EFAC] hover:underline"
                    >
                      Propose an assignment →
                    </Link>
                  ) : null}
                </section>
                <WeekMoneyPanel money={car.money} />
              </div>
            </div>
          </div>
        );
      }}
    </ReadGate>
  );
};

export const VehicleDetailScreen = ({
  vehicleId,
}: {
  readonly vehicleId: string;
}) => {
  const fleet = useSelectedFleet();
  const online = useOnlineStatus();
  const now = useNow(60_000);
  const client = useQueryClient();
  const today = localDateOf(now, fleet.zone);
  const from = toIso(startOfLocalDay(today, fleet.zone));
  const to = toIso(startOfLocalDay(addDays(today, 30), fleet.zone));
  const vehicle = useQuery({
    queryKey: fleetKeys.vehicle(fleet.fleetId, vehicleId),
    queryFn: ({ signal }) => fleetApi.vehicle(fleet.fleetId, vehicleId, signal),
  });
  const availability = useQuery({
    queryKey: fleetKeys.vehicleAvailability(fleet.fleetId, vehicleId, from),
    queryFn: ({ signal }) =>
      fleetApi.vehicleAvailability(
        fleet.fleetId,
        vehicleId,
        { from, to },
        signal,
      ),
  });
  const maintenance = useQuery({
    queryKey: fleetKeys.maintenance(fleet.fleetId, vehicleId),
    queryFn: ({ signal }) =>
      fleetApi.maintenance(fleet.fleetId, { vehicleId }, signal),
  });
  const assignments = useQuery({
    queryKey: fleetKeys.assignments(fleet.fleetId),
    queryFn: ({ signal }) => fleetApi.assignments(fleet.fleetId, signal),
  });
  const conflicts = useQuery({
    queryKey: fleetKeys.conflicts(fleet.fleetId, "open,resolving"),
    queryFn: ({ signal }) =>
      fleetApi.conflicts(fleet.fleetId, "open,resolving", signal),
  });
  const docsQuery = useQuery({
    queryKey: fleetKeys.vehicleDocuments(fleet.fleetId, vehicleId),
    queryFn: ({ signal }) =>
      fleetApi.vehicleDocuments(fleet.fleetId, vehicleId, signal),
    enabled: vehicleId !== "",
  });
  if (vehicleId === "") {
    return (
      <EmptyState
        title="No vehicle selected."
        action={{ href: "/vehicles", label: "Open vehicles" }}
      />
    );
  }
  return (
    <VehicleDetailView
      fleet={fleet}
      vehicle={toReadState(vehicle, online, "this vehicle")}
      availability={toReadState(availability, online, "the next 30 days")}
      maintenance={toReadState(maintenance, online, "maintenance")}
      arrangements={assignments.data?.arrangements ?? []}
      conflicts={conflicts.data?.conflicts ?? []}
      vehicleDocuments={docsQuery.data?.documents}
      now={now}
      online={online}
      onChanged={() =>
        void client.invalidateQueries({
          queryKey: fleetKeys.all(fleet.fleetId),
        })
      }
      onRetry={() => void vehicle.refetch()}
    />
  );
};
