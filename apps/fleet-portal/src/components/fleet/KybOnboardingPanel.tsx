"use client";

/**
 * Fleet onboarding, KYB verification banner & submission form, and incoming
 * invitation acceptance when no fleet is linked yet (CC-C02 / P1-05, DEC-5).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { PermissionNote, Pill, ReadGate } from "@/components/states/states";
import { commandErrorText, isWriteReachable, toReadState } from "@/lib/access";
import { fleetApi, fleetKeys } from "@/lib/fleet-api";
import { useCommand, useOnlineStatus } from "@/lib/hooks";
import { can, permissionCopy, ROLE_LABELS } from "@/lib/roles";
import { FLEET_ACCOUNT_TEST_IDS } from "@/lib/test-ids";

import type {
  FleetDocumentContentType,
  FleetInvitationView,
  FleetKybApplicationView,
  FleetKybStatus,
  FleetView,
} from "@/lib/fleet-types";

const KYB_STATUS_LABELS: Readonly<Record<FleetKybStatus, string>> = {
  pending_review: "Pending UBI review",
  changes_requested: "Changes requested by UBI",
  approved: "Verified by UBI",
  rejected: "Rejected by UBI",
};

const KYB_STATUS_TONES: Readonly<
  Record<FleetKybStatus, "ok" | "warn" | "bad" | "mute">
> = {
  pending_review: "warn",
  changes_requested: "warn",
  approved: "ok",
  rejected: "bad",
};

const ALLOWED_CONTENT_TYPES: readonly FleetDocumentContentType[] = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];

export async function computeSha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function sha256HexToBase64(sha256Hex: string): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    bytes[i] = Number.parseInt(sha256Hex.slice(i * 2, i * 2 + 2), 16);
  }
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis.btoa(binary);
}

export const KybStatusBanner = ({
  fleet,
  kyb,
  online = true,
  onSubmitted,
}: {
  readonly fleet: FleetView;
  readonly kyb: FleetKybApplicationView;
  readonly online?: boolean;
  readonly onSubmitted?: (updated: FleetKybApplicationView) => void;
}) => {
  const canManage = can(fleet.myRole, "manage_staff");
  const canViewDocs = can(fleet.myRole, "manage_vehicles");

  const [registrationNumber, setRegistrationNumber] = useState(
    kyb.registrationNumber ?? "",
  );
  const [taxId, setTaxId] = useState(kyb.taxId ?? "");
  const [fields, setFields] = useState<Record<string, string>>(() => ({
    ...kyb.fields,
  }));
  const [uploadedByReq, setUploadedByReq] = useState<Record<string, string>>(
    () => {
      const initial: Record<string, string> = {};
      for (const doc of kyb.documents) {
        initial[doc.requirementKey] = doc.uploadId;
      }
      return initial;
    },
  );
  const [declarationsAccepted, setDeclarationsAccepted] = useState(
    kyb.declarationsAccepted,
  );
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const submitCmd = useCommand<FleetKybApplicationView>();

  const showForm =
    canManage &&
    kyb.requirementsConfigured &&
    (kyb.kybStatus === "pending_review" ||
      kyb.kybStatus === "changes_requested") &&
    fleet.status !== "suspended";

  const handleFileUpload = async (requirementKey: string, file: File) => {
    setUploadError(null);
    const contentType = file.type as FleetDocumentContentType;
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      setUploadError(
        "Unsupported file type. Upload a PDF, JPEG, PNG, or WebP document.",
      );
      return;
    }
    setUploadingKey(requirementKey);
    try {
      const buffer = await file.arrayBuffer();
      const sha256Hex = await computeSha256Hex(buffer);
      const slot = await fleetApi.createKybUpload(
        fleet.fleetId,
        {
          purpose: "kyb_document",
          contentType,
          sizeBytes: buffer.byteLength,
          sha256Hex,
        },
        `kyb-up-${fleet.fleetId}-${requirementKey}-${sha256Hex.slice(0, 12)}`,
      );
      const putRes = await fetch(slot.uploadUrl, {
        method: "PUT",
        headers: slot.requiredHeaders,
        body: buffer,
      });
      if (!putRes.ok) {
        throw new Error(`Upload failed with status ${putRes.status}`);
      }
      setUploadedByReq((prev) => ({
        ...prev,
        [requirementKey]: slot.uploadId,
      }));
    } catch (error) {
      setUploadError(commandErrorText(error, online));
    } finally {
      setUploadingKey(null);
    }
  };

  return (
    <section
      data-testid={FLEET_ACCOUNT_TEST_IDS.kyb.statusBanner}
      className="space-y-3 rounded-xl border border-[#222] bg-[#1A1A1A] p-4 text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">
            Business verification (KYB)
          </h2>
          <p className="text-zinc-400">
            Decided by UBI operations · status only. Assignments and maintenance
            open once your fleet is verified.
          </p>
        </div>
        <Pill tone={KYB_STATUS_TONES[kyb.kybStatus]}>
          {KYB_STATUS_LABELS[kyb.kybStatus]}
        </Pill>
      </div>

      {!kyb.requirementsConfigured ? (
        <div
          role="status"
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-100"
        >
          Business verification requirements are not configured for{" "}
          <span className="font-mono">{kyb.cityId}</span> yet. Your fleet stays
          in pending review until UBI publishes the city checklist.
        </div>
      ) : null}

      {kyb.reviewNote ? (
        <div className="rounded-lg border border-zinc-700 bg-[#141414] p-3 text-zinc-200">
          <p className="font-semibold text-zinc-100">Note from UBI review</p>
          <p className="mt-0.5 text-zinc-300">{kyb.reviewNote}</p>
        </div>
      ) : null}

      {kyb.documents.length > 0 ? (
        <div className="space-y-1">
          <p className="font-semibold text-zinc-300">Submitted documents</p>
          <ul className="space-y-1">
            {kyb.documents.map((doc) => (
              <li
                key={doc.kybDocumentId}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-[#262626] bg-[#141414] px-3 py-1.5"
              >
                <span className="text-zinc-200">
                  {doc.requirementKey} ·{" "}
                  <span className="text-zinc-400">{doc.status}</span>
                </span>
                {canViewDocs ? (
                  <button
                    type="button"
                    disabled={!online}
                    onClick={() => {
                      void fleetApi
                        .kybDocumentUrl(fleet.fleetId, doc.kybDocumentId)
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
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {showForm ? (
        <form
          data-testid={FLEET_ACCOUNT_TEST_IDS.kyb.form}
          onSubmit={(event) => {
            event.preventDefault();
            const documents = kyb.requirements
              .filter((req) => req.kind === "document")
              .map((req) => ({
                requirementKey: req.key,
                uploadId: uploadedByReq[req.key] ?? "",
              }))
              .filter((doc) => doc.uploadId !== "");

            void submitCmd
              .run(
                (key) =>
                  fleetApi.submitKyb(
                    fleet.fleetId,
                    {
                      ...(registrationNumber.trim()
                        ? { registrationNumber: registrationNumber.trim() }
                        : {}),
                      ...(taxId.trim() ? { taxId: taxId.trim() } : {}),
                      fields,
                      documents,
                      declarationsAccepted: true,
                    },
                    key,
                  ),
                online,
              )
              .then((res) => {
                if (res !== undefined) {
                  onSubmitted?.(res);
                }
              });
          }}
          className="space-y-3 border-t border-[#262626] pt-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-zinc-300">
              Company registration number (optional)
              <input
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
                placeholder="e.g. RC-123456"
                className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-zinc-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-zinc-300">
              Tax identification number (optional)
              <input
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                placeholder="e.g. 12345678-0001"
                className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-zinc-100"
              />
            </label>
          </div>

          {kyb.requirements.map((req) =>
            req.kind === "text" ? (
              <div
                key={req.key}
                data-testid={FLEET_ACCOUNT_TEST_IDS.kyb.uploadRequirement}
                className="space-y-1"
              >
                <label className="flex flex-col gap-1 text-zinc-300">
                  <span>
                    {req.label}
                    {req.required ? " *" : ""}
                  </span>
                  <input
                    value={fields[req.key] ?? ""}
                    onChange={(e) =>
                      setFields((prev) => ({
                        ...prev,
                        [req.key]: e.target.value,
                      }))
                    }
                    className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-zinc-100"
                  />
                </label>
                {req.description ? (
                  <p className="text-[11px] text-zinc-500">{req.description}</p>
                ) : null}
              </div>
            ) : (
              <div
                key={req.key}
                data-testid={FLEET_ACCOUNT_TEST_IDS.kyb.uploadRequirement}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#262626] bg-[#141414] p-2.5"
              >
                <div>
                  <p className="font-medium text-zinc-200">
                    {req.label}
                    {req.required ? " *" : ""}
                  </p>
                  {req.description ? (
                    <p className="text-[11px] text-zinc-500">
                      {req.description}
                    </p>
                  ) : null}
                  {uploadedByReq[req.key] ? (
                    <p className="text-[11px] text-[#86EFAC]">
                      Upload attached ({uploadedByReq[req.key]})
                    </p>
                  ) : null}
                </div>
                <label className="cursor-pointer rounded border border-zinc-600 px-2.5 py-1 text-zinc-100 hover:bg-zinc-800">
                  {uploadingKey === req.key
                    ? "Uploading…"
                    : uploadedByReq[req.key]
                      ? "Replace file"
                      : "Choose file"}
                  <input
                    type="file"
                    accept=".pdf,image/jpeg,image/png,image/webp"
                    disabled={!online || uploadingKey !== null}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        void handleFileUpload(req.key, file);
                      }
                    }}
                    className="sr-only"
                  />
                </label>
              </div>
            ),
          )}

          <label className="flex items-center gap-2 text-zinc-300">
            <input
              type="checkbox"
              checked={declarationsAccepted}
              onChange={(e) => setDeclarationsAccepted(e.target.checked)}
            />
            I confirm that these business details and documents are accurate and
            that I am authorised to represent this fleet.
          </label>

          {uploadError ? (
            <p role="alert" className="text-red-300">
              {uploadError}
            </p>
          ) : null}

          <button
            type="submit"
            data-testid={FLEET_ACCOUNT_TEST_IDS.kyb.submit}
            disabled={
              !online ||
              !declarationsAccepted ||
              uploadingKey !== null ||
              submitCmd.state.status === "pending"
            }
            className="rounded-md bg-[#1DB954] px-3 py-1.5 font-semibold text-black disabled:opacity-50"
          >
            {submitCmd.state.status === "pending"
              ? "Submitting…"
              : kyb.kybStatus === "changes_requested"
                ? "Resubmit for UBI review"
                : "Submit KYB application"}
          </button>

          {submitCmd.state.status === "done" ? (
            <p className="text-[#86EFAC]">
              KYB application submitted for UBI review.
            </p>
          ) : null}
          {submitCmd.state.status === "failed" ? (
            <p role="alert" className="text-red-300">
              {commandErrorText(submitCmd.state.error, online)}
            </p>
          ) : null}
        </form>
      ) : !canManage && kyb.kybStatus !== "approved" ? (
        <PermissionNote>{permissionCopy("manage_staff")}</PermissionNote>
      ) : null}
    </section>
  );
};

export const KybOnboardingSection = ({
  fleet,
}: {
  readonly fleet: FleetView;
}) => {
  const online = useOnlineStatus();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: fleetKeys.kyb(fleet.fleetId),
    queryFn: ({ signal }) => fleetApi.kyb(fleet.fleetId, signal),
  });
  const state = toReadState(query, online, "business verification");
  return (
    <ReadGate
      state={state}
      loadingLabel="Loading business verification…"
      context="business verification"
      zone={fleet.zone}
      onRetry={() => void query.refetch()}
    >
      {(kyb) => (
        <KybStatusBanner
          fleet={fleet}
          kyb={kyb}
          online={isWriteReachable(online, state)}
          onSubmitted={() => {
            void client.invalidateQueries({
              queryKey: fleetKeys.kyb(fleet.fleetId),
            });
            void client.invalidateQueries({
              queryKey: fleetKeys.fleets(),
            });
          }}
        />
      )}
    </ReadGate>
  );
};

export const IncomingInvitationsCard = ({
  invitations,
  online,
  onResponded,
}: {
  readonly invitations: readonly FleetInvitationView[];
  readonly online: boolean;
  readonly onResponded?: () => void;
}) => {
  const acceptCmd = useCommand<FleetInvitationView>();
  const declineCmd = useCommand<FleetInvitationView>();
  const pending = invitations.filter((inv) => inv.status === "pending");
  if (pending.length === 0) {
    return null;
  }
  return (
    <section className="space-y-2 rounded-xl border border-[#222] bg-[#1A1A1A] p-4 text-xs">
      <h2 className="text-sm font-semibold text-zinc-100">
        Pending fleet invitations
      </h2>
      <ul className="space-y-2">
        {pending.map((inv) => (
          <li
            key={inv.invitationId}
            data-testid={FLEET_ACCOUNT_TEST_IDS.invitations.row}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#262626] bg-[#141414] p-3"
          >
            <div>
              <p className="font-semibold text-zinc-100">{inv.fleetName}</p>
              <p className="text-zinc-400">
                {inv.kind === "ownership_transfer"
                  ? "Ownership transfer (Owner)"
                  : `Role: ${ROLE_LABELS[inv.role]}`}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                data-testid={FLEET_ACCOUNT_TEST_IDS.invitations.accept}
                disabled={!online || acceptCmd.state.status === "pending"}
                onClick={() =>
                  void acceptCmd
                    .run(
                      (key) => fleetApi.acceptInvitation(inv.invitationId, key),
                      online,
                    )
                    .then((res) => {
                      if (res !== undefined) {
                        onResponded?.();
                      }
                    })
                }
                className="rounded bg-[#1DB954] px-2.5 py-1 font-semibold text-black disabled:opacity-50"
              >
                Accept
              </button>
              <button
                type="button"
                data-testid={FLEET_ACCOUNT_TEST_IDS.invitations.decline}
                disabled={!online || declineCmd.state.status === "pending"}
                onClick={() =>
                  void declineCmd
                    .run(
                      (key) =>
                        fleetApi.declineInvitation(inv.invitationId, key),
                      online,
                    )
                    .then((res) => {
                      if (res !== undefined) {
                        onResponded?.();
                      }
                    })
                }
                className="rounded border border-zinc-600 px-2.5 py-1 text-zinc-200 disabled:opacity-50"
              >
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
      {acceptCmd.state.status === "failed" ? (
        <p role="alert" className="text-red-300">
          {commandErrorText(acceptCmd.state.error, online)}
        </p>
      ) : null}
      {declineCmd.state.status === "failed" ? (
        <p role="alert" className="text-red-300">
          {commandErrorText(declineCmd.state.error, online)}
        </p>
      ) : null}
    </section>
  );
};

export const CreateFleetOnboardingCard = ({
  online,
  onCreated,
}: {
  readonly online: boolean;
  readonly onCreated?: (fleet: FleetView) => void;
}) => {
  const [name, setName] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [taxId, setTaxId] = useState("");
  const createCmd = useCommand<FleetView>();

  return (
    <section className="space-y-3 rounded-xl border border-[#222] bg-[#1A1A1A] p-4 text-xs">
      <div>
        <h2 className="text-sm font-semibold text-zinc-100">
          Register a new fleet
        </h2>
        <p className="text-zinc-400">
          Create your fleet account in this city. Your fleet starts in{" "}
          <span className="text-zinc-200">pending review</span> until UBI
          verifies your business documents (KYB).
        </p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          void createCmd
            .run(
              (key) =>
                fleetApi.createFleet(
                  {
                    name: name.trim(),
                    ...(registrationNumber.trim()
                      ? { registrationNumber: registrationNumber.trim() }
                      : {}),
                    ...(taxId.trim() ? { taxId: taxId.trim() } : {}),
                  },
                  key,
                ),
              online,
            )
            .then((created) => {
              if (created !== undefined) {
                setName("");
                setRegistrationNumber("");
                setTaxId("");
                onCreated?.(created);
              }
            });
        }}
        className="grid gap-3 sm:grid-cols-3"
      >
        <label className="flex flex-col gap-1 text-zinc-300">
          Fleet legal / trading name *
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Eko Transit Fleet Ltd"
            className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-zinc-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-zinc-300">
          Registration number (optional)
          <input
            value={registrationNumber}
            onChange={(e) => setRegistrationNumber(e.target.value)}
            placeholder="e.g. RC-123456"
            className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-zinc-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-zinc-300">
          Tax ID (optional)
          <input
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            placeholder="e.g. 12345678-0001"
            className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-zinc-100"
          />
        </label>
        <div className="sm:col-span-3">
          <button
            type="submit"
            disabled={
              !online ||
              name.trim().length < 2 ||
              createCmd.state.status === "pending"
            }
            className="rounded-md bg-[#1DB954] px-3 py-1.5 font-semibold text-black disabled:opacity-50"
          >
            {createCmd.state.status === "pending"
              ? "Creating fleet…"
              : "Create fleet"}
          </button>
        </div>
      </form>
      {createCmd.state.status === "failed" ? (
        <p role="alert" className="text-red-300">
          {commandErrorText(createCmd.state.error, online)}
        </p>
      ) : null}
    </section>
  );
};

export const NoFleetOnboardingScreen = ({
  onFleetReady,
}: {
  readonly onFleetReady?: () => void;
}) => {
  const online = useOnlineStatus();
  const invitesQuery = useQuery({
    queryKey: fleetKeys.myInvitations(),
    queryFn: ({ signal }) => fleetApi.myInvitations(signal),
  });
  const invitations: readonly FleetInvitationView[] =
    invitesQuery.data?.invitations ?? [];

  return (
    <div className="space-y-4">
      <IncomingInvitationsCard
        invitations={invitations}
        online={online}
        onResponded={() => {
          void invitesQuery.refetch();
          onFleetReady?.();
        }}
      />
      <CreateFleetOnboardingCard
        online={online}
        onCreated={() => {
          onFleetReady?.();
        }}
      />
    </div>
  );
};
