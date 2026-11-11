"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  ADMIN_FLEET_REVIEW_TEST_IDS,
  getAdminFleetDocumentUrl,
  getAdminFleetKybDocumentUrl,
  listAdminFleetDocuments,
  listAdminFleetKyb,
  reviewAdminFleetDocument,
  reviewAdminFleetKyb,
  type FleetKybApplicationView,
  type VehicleDocumentView,
} from "@/lib/fleets-api";

export interface FleetOpsReviewBoardViewProps {
  readonly applications: readonly FleetKybApplicationView[];
  readonly documents: readonly VehicleDocumentView[];
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onReviewKyb?: (
    fleetId: string,
    decision: "approved" | "changes_requested" | "rejected",
    note?: string,
  ) => Promise<void> | void;
  readonly onOpenKybDocument?: (
    fleetId: string,
    kybDocumentId: string,
  ) => Promise<void> | void;
  readonly onReviewVehicleDoc?: (
    documentId: string,
    decision: "valid" | "rejected",
    note?: string,
  ) => Promise<void> | void;
  readonly onOpenVehicleDoc?: (documentId: string) => Promise<void> | void;
}

const KybRow = ({
  app,
  onReview,
  onOpenDoc,
}: {
  readonly app: FleetKybApplicationView;
  readonly onReview?: FleetOpsReviewBoardViewProps["onReviewKyb"];
  readonly onOpenDoc?: FleetOpsReviewBoardViewProps["onOpenKybDocument"];
}) => {
  const [note, setNote] = useState(app.reviewNote ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const act = async (
    decision: "approved" | "changes_requested" | "rejected",
  ) => {
    setErr(null);
    if (
      (decision === "changes_requested" || decision === "rejected") &&
      note.trim().length < 3
    ) {
      setErr(
        "A review note (at least 3 characters) is required when requesting changes or rejecting.",
      );
      return;
    }
    setBusy(true);
    try {
      await onReview?.(
        app.fleetId,
        decision,
        note.trim() ? note.trim() : undefined,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to submit KYB review.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      data-testid={ADMIN_FLEET_REVIEW_TEST_IDS.kyb.row}
      className="space-y-3 rounded-xl border border-gray-800 bg-gray-900 p-4 text-xs"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white">{app.name}</h3>
          <p className="text-gray-400">
            Fleet <span className="font-mono">{app.fleetId}</span> · City{" "}
            <span className="font-mono">{app.cityId}</span> · Reg:{" "}
            {app.registrationNumber ?? "—"} · Tax ID: {app.taxId ?? "—"}
          </p>
        </div>
        <span className="rounded-full bg-gray-800 px-2.5 py-0.5 text-[11px] font-medium text-gray-200">
          KYB: {app.kybStatus} · Fleet: {app.status}
        </span>
      </div>

      {Object.keys(app.fields).length > 0 ? (
        <dl className="grid gap-2 rounded-lg border border-gray-800 bg-gray-950 p-2.5 sm:grid-cols-2">
          {Object.entries(app.fields).map(([key, value]) => (
            <div key={key}>
              <dt className="text-[11px] text-gray-500">{key}</dt>
              <dd className="text-gray-200">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {app.documents.length > 0 ? (
        <div className="space-y-1">
          <p className="font-medium text-gray-300">Submitted KYB documents</p>
          <ul className="space-y-1">
            {app.documents.map((doc) => (
              <li
                key={doc.kybDocumentId}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-800 bg-gray-950 px-3 py-1.5"
              >
                <span className="text-gray-200">
                  {doc.requirementKey} ({doc.contentType}) ·{" "}
                  <span className="text-gray-400">{doc.status}</span>
                </span>
                <button
                  type="button"
                  data-testid={ADMIN_FLEET_REVIEW_TEST_IDS.kyb.openDocument}
                  onClick={() =>
                    void onOpenDoc?.(app.fleetId, doc.kybDocumentId)
                  }
                  className="text-green-400 underline hover:text-green-300"
                >
                  Open private link
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-gray-500">No KYB documents attached yet.</p>
      )}

      <div className="flex flex-wrap items-end gap-2 pt-1">
        <label className="flex flex-1 flex-col gap-1 text-gray-300">
          Review note (shared with fleet; required for changes requested /
          reject)
          <input
            data-testid={ADMIN_FLEET_REVIEW_TEST_IDS.kyb.noteInput}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reason or verification note"
            className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-white"
          />
        </label>
        <button
          type="button"
          data-testid={ADMIN_FLEET_REVIEW_TEST_IDS.kyb.approve}
          disabled={busy}
          onClick={() => void act("approved")}
          className="rounded bg-green-600 px-3 py-1.5 font-semibold text-white hover:bg-green-500 disabled:opacity-50"
        >
          Approve KYB
        </button>
        <button
          type="button"
          data-testid={ADMIN_FLEET_REVIEW_TEST_IDS.kyb.requestChanges}
          disabled={busy}
          onClick={() => void act("changes_requested")}
          className="rounded border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 font-semibold text-amber-200 disabled:opacity-50"
        >
          Request changes
        </button>
        <button
          type="button"
          data-testid={ADMIN_FLEET_REVIEW_TEST_IDS.kyb.reject}
          disabled={busy}
          onClick={() => void act("rejected")}
          className="rounded border border-red-500/50 bg-red-500/10 px-3 py-1.5 font-semibold text-red-200 disabled:opacity-50"
        >
          Reject
        </button>
      </div>

      {err ? (
        <p role="alert" className="text-red-400">
          {err}
        </p>
      ) : null}
    </li>
  );
};

const VehicleDocumentRow = ({
  doc,
  onReview,
  onOpenDoc,
}: {
  readonly doc: VehicleDocumentView;
  readonly onReview?: FleetOpsReviewBoardViewProps["onReviewVehicleDoc"];
  readonly onOpenDoc?: FleetOpsReviewBoardViewProps["onOpenVehicleDoc"];
}) => {
  const [note, setNote] = useState(doc.reviewNote ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const act = async (decision: "valid" | "rejected") => {
    setErr(null);
    if (decision === "rejected" && note.trim().length < 3) {
      setErr(
        "A rejection note (at least 3 characters) is required when rejecting a vehicle document.",
      );
      return;
    }
    setBusy(true);
    try {
      await onReview?.(
        doc.documentId,
        decision,
        note.trim() ? note.trim() : undefined,
      );
    } catch (e) {
      setErr(
        e instanceof Error ? e.message : "Failed to review vehicle document.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      data-testid={ADMIN_FLEET_REVIEW_TEST_IDS.documents.row}
      className="space-y-3 rounded-xl border border-gray-800 bg-gray-900 p-4 text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-mono text-sm font-semibold text-white">
            {doc.plate} · {doc.docType}
          </h3>
          <p className="text-gray-400">
            Fleet <span className="font-mono">{doc.fleetId}</span> · Vehicle{" "}
            <span className="font-mono">{doc.vehicleId}</span> · Expires{" "}
            <span className="font-mono">{doc.expiresAt.slice(0, 10)}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-gray-800 px-2.5 py-0.5 text-[11px] font-medium text-gray-200">
            {doc.status}
          </span>
          <button
            type="button"
            data-testid={ADMIN_FLEET_REVIEW_TEST_IDS.documents.openDocument}
            onClick={() => void onOpenDoc?.(doc.documentId)}
            className="text-green-400 underline hover:text-green-300"
          >
            Open private link
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-gray-300">
          Review note (required when rejecting)
          <input
            data-testid={ADMIN_FLEET_REVIEW_TEST_IDS.documents.noteInput}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reason or verification note"
            className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-white"
          />
        </label>
        <button
          type="button"
          data-testid={ADMIN_FLEET_REVIEW_TEST_IDS.documents.approve}
          disabled={busy}
          onClick={() => void act("valid")}
          className="rounded bg-green-600 px-3 py-1.5 font-semibold text-white hover:bg-green-500 disabled:opacity-50"
        >
          Mark valid
        </button>
        <button
          type="button"
          data-testid={ADMIN_FLEET_REVIEW_TEST_IDS.documents.reject}
          disabled={busy}
          onClick={() => void act("rejected")}
          className="rounded border border-red-500/50 bg-red-500/10 px-3 py-1.5 font-semibold text-red-200 disabled:opacity-50"
        >
          Reject document
        </button>
      </div>

      {err ? (
        <p role="alert" className="text-red-400">
          {err}
        </p>
      ) : null}
    </li>
  );
};

export const FleetOpsReviewBoardView = ({
  applications,
  documents,
  loading = false,
  error = null,
  onReviewKyb,
  onOpenKybDocument,
  onReviewVehicleDoc,
  onOpenVehicleDoc,
}: FleetOpsReviewBoardViewProps) => (
  <div className="space-y-6 p-6">
    <div>
      <h1 className="text-xl font-bold text-white">
        Fleet KYB &amp; Vehicle Document Review
      </h1>
      <p className="text-xs text-gray-400">
        UBI operations verification queue for fleet onboarding applications and
        vehicle certificate renewals.
      </p>
    </div>

    {loading ? (
      <p className="text-sm text-gray-400">Loading fleet review queues…</p>
    ) : null}
    {error ? (
      <div
        role="alert"
        className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-xs text-red-200"
      >
        {error}
      </div>
    ) : null}

    <section
      data-testid={ADMIN_FLEET_REVIEW_TEST_IDS.kyb.list}
      className="space-y-3"
    >
      <h2 className="text-sm font-semibold text-white">
        Fleet KYB applications ({applications.length})
      </h2>
      {applications.length === 0 ? (
        <p className="rounded-xl border border-gray-800 bg-gray-900 p-4 text-xs text-gray-400">
          No fleet KYB applications in queue.
        </p>
      ) : (
        <ul className="space-y-3">
          {applications.map((app) => (
            <KybRow
              key={app.fleetId}
              app={app}
              onReview={onReviewKyb}
              onOpenDoc={onOpenKybDocument}
            />
          ))}
        </ul>
      )}
    </section>

    <section
      data-testid={ADMIN_FLEET_REVIEW_TEST_IDS.documents.list}
      className="space-y-3"
    >
      <h2 className="text-sm font-semibold text-white">
        Vehicle document renewals ({documents.length})
      </h2>
      {documents.length === 0 ? (
        <p className="rounded-xl border border-gray-800 bg-gray-900 p-4 text-xs text-gray-400">
          No vehicle documents awaiting review.
        </p>
      ) : (
        <ul className="space-y-3">
          {documents.map((doc) => (
            <VehicleDocumentRow
              key={doc.documentId}
              doc={doc}
              onReview={onReviewVehicleDoc}
              onOpenDoc={onOpenVehicleDoc}
            />
          ))}
        </ul>
      )}
    </section>
  </div>
);

export const FleetOpsReviewBoard = () => {
  const client = useQueryClient();
  const kybQuery = useQuery({
    queryKey: ["admin", "fleets", "kyb"],
    queryFn: ({ signal }) => listAdminFleetKyb(undefined, signal),
  });
  const docsQuery = useQuery({
    queryKey: ["admin", "fleets", "documents"],
    queryFn: ({ signal }) => listAdminFleetDocuments(undefined, signal),
  });

  const error =
    kybQuery.error instanceof Error
      ? kybQuery.error.message
      : docsQuery.error instanceof Error
        ? docsQuery.error.message
        : null;

  return (
    <FleetOpsReviewBoardView
      applications={kybQuery.data?.applications ?? []}
      documents={docsQuery.data?.documents ?? []}
      loading={kybQuery.isLoading || docsQuery.isLoading}
      error={error}
      onReviewKyb={async (fleetId, decision, note) => {
        await reviewAdminFleetKyb(fleetId, {
          decision,
          ...(note ? { note } : {}),
        });
        await client.invalidateQueries({ queryKey: ["admin", "fleets"] });
      }}
      onOpenKybDocument={async (fleetId, docId) => {
        const res = await getAdminFleetKybDocumentUrl(fleetId, docId);
        window.open(res.url, "_blank", "noopener,noreferrer");
      }}
      onReviewVehicleDoc={async (documentId, decision, note) => {
        await reviewAdminFleetDocument(documentId, {
          decision,
          ...(note ? { note } : {}),
        });
        await client.invalidateQueries({ queryKey: ["admin", "fleets"] });
      }}
      onOpenVehicleDoc={async (documentId) => {
        const res = await getAdminFleetDocumentUrl(documentId);
        window.open(res.url, "_blank", "noopener,noreferrer");
      }}
    />
  );
};
