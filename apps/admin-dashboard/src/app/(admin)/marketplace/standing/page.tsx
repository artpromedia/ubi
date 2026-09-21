"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DriverStandingBoard,
  type ProposeForm,
} from "@/components/marketplace/DriverStandingBoard";
import {
  STANDING_REASON_CODES,
  marketplaceApi,
  pctRate,
} from "@/lib/marketplace-api";

const OPERATOR_STORAGE_KEY = "ubi_admin_operator_id";

/** This browser's "acting as" operator id — a client-side UX guard for the
 * maker-checker buttons only (self-decisions are refused server-side
 * regardless). Persisted per-browser so the same operator does not have to
 * re-enter it on every reload. */
function useOperatorId(): [string, (v: string) => void] {
  const [id, setId] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(OPERATOR_STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const update = (v: string) => {
    setId(v);
    try {
      window.localStorage.setItem(OPERATOR_STORAGE_KEY, v);
    } catch {
      /* per-viewer convenience only */
    }
  };
  return [id, update];
}

/** C08 — cancellations/no-shows, driver standing & appeals container. */
export default function DriverStandingContainer() {
  const queryClient = useQueryClient();
  const [operatorId, setOperatorId] = useOperatorId();
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [proposeForm, setProposeForm] = useState<ProposeForm>({
    actionType: "warning",
    reasonCode: "",
    reasonNote: "",
  });
  const [message, setMessage] = useState<{
    tone: "ok" | "err";
    text: string;
  } | null>(null);

  const cancellations = useQuery({
    queryKey: ["mpCancellations"],
    queryFn: () => marketplaceApi.cancellations(),
  });
  const flagged = useQuery({
    queryKey: ["mpFlaggedDrivers"],
    queryFn: () => marketplaceApi.driverStandingList(),
  });
  const driverDetail = useQuery({
    queryKey: ["mpDriverStanding", selectedDriverId],
    queryFn: () => marketplaceApi.driverStanding(selectedDriverId as string),
    enabled: selectedDriverId !== null,
  });

  const invalidateDriver = () => {
    void queryClient.invalidateQueries({
      queryKey: ["mpDriverStanding", selectedDriverId],
    });
    void queryClient.invalidateQueries({ queryKey: ["mpFlaggedDrivers"] });
  };

  const propose = useMutation({
    mutationFn: () =>
      marketplaceApi.proposeStandingAction(selectedDriverId as string, {
        actionType: proposeForm.actionType,
        reasonCode: proposeForm.reasonCode,
        reasonNote: proposeForm.reasonNote || undefined,
        cityId: driverDetail.data?.cityId ?? "",
      }),
    onSuccess: (row) => {
      setMessage({
        tone: "ok",
        text:
          row.actionType +
          " " +
          (row.requiresApproval
            ? "recorded — pending a second operator's approval."
            : "committed immediately (informational)."),
      });
      setProposeForm({ actionType: "warning", reasonCode: "", reasonNote: "" });
      invalidateDriver();
    },
    onError: (e) => setMessage({ tone: "err", text: (e as Error).message }),
  });

  const decide = useMutation({
    mutationFn: (v: { id: string; approve: boolean; reason: string }) =>
      marketplaceApi.decideStandingAction(v.id, {
        approve: v.approve,
        reason: v.reason,
      }),
    onSuccess: (row) => {
      setMessage({ tone: "ok", text: "Standing action " + row.status + "." });
      invalidateDriver();
    },
    onError: (e) => setMessage({ tone: "err", text: (e as Error).message }),
  });

  const fileAppeal = useMutation({
    mutationFn: (v: { id: string; note: string }) =>
      marketplaceApi.fileAppeal(v.id, { note: v.note }),
    onSuccess: () => {
      setMessage({ tone: "ok", text: "Appeal recorded." });
      invalidateDriver();
    },
    onError: (e) => setMessage({ tone: "err", text: (e as Error).message }),
  });

  const decideAppeal = useMutation({
    mutationFn: (v: { id: string; uphold: boolean; reason: string }) =>
      marketplaceApi.decideAppeal(v.id, { uphold: v.uphold, reason: v.reason }),
    onSuccess: (row) => {
      setMessage({ tone: "ok", text: "Appeal " + row.status + "." });
      invalidateDriver();
    },
    onError: (e) => setMessage({ tone: "err", text: (e as Error).message }),
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border p-4">
        <h1 className="font-heading text-lg font-semibold">
          Marketplace › Standing &amp; Appeals
        </h1>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          Acting as
          <input
            data-testid="mp.admin.standing.operatorId"
            value={operatorId}
            onChange={(e) => setOperatorId(e.target.value)}
            placeholder="your operator id"
            className="w-56 rounded-lg border border-border bg-card px-2 py-1 text-sm text-foreground"
          />
        </label>
      </div>
      <div className="flex-1 overflow-auto">
        <DriverStandingBoard
          operatorId={operatorId}
          cancellationsLoading={cancellations.isLoading}
          cancellationsError={
            cancellations.isError
              ? (cancellations.error as Error).message
              : null
          }
          cancellations={(cancellations.data?.rows ?? []).map((c) => ({
            rideId: c.rideId,
            driverId: c.driverId,
            riderId: c.riderId,
            state: c.state,
            reasonCode: c.reasonCode,
            at: c.at,
          }))}
          flaggedLoading={flagged.isLoading}
          flaggedError={
            flagged.isError ? (flagged.error as Error).message : null
          }
          flagged={(flagged.data?.rows ?? []).map((d) => ({
            driverId: d.driverId,
            cityId: d.cityId,
            totalRides: d.totalRides,
            driverCancellations: d.driverCancellations,
            noShows: d.noShows,
            cancellationRatePct: pctRate(d.cancellationRate),
          }))}
          reasonCodes={STANDING_REASON_CODES}
          selectedDriverId={selectedDriverId}
          driverDetailLoading={driverDetail.isLoading}
          driverDetailError={
            driverDetail.isError ? (driverDetail.error as Error).message : null
          }
          driverDetail={
            driverDetail.data
              ? {
                  driverId: driverDetail.data.driverId,
                  totalRides: driverDetail.data.totalRides,
                  completions: driverDetail.data.completions,
                  driverCancellations: driverDetail.data.driverCancellations,
                  noShows: driverDetail.data.noShows,
                  cancellationRatePct: pctRate(
                    driverDetail.data.cancellationRate,
                  ),
                  blocked: driverDetail.data.blocked,
                  history: driverDetail.data.history.map((a) => ({
                    id: a.id,
                    driverId: a.driverId,
                    actionType: a.actionType,
                    reasonCode: a.reasonCode,
                    reasonNote: a.reasonNote,
                    status: a.status,
                    proposedBy: a.proposedBy,
                    decidedBy: a.decidedBy,
                    decisionReason: a.decisionReason,
                    appealedBy: a.appealedBy,
                    appealNote: a.appealNote,
                    appealDecidedBy: a.appealDecidedBy,
                    appealReason: a.appealReason,
                    requiresApproval: a.requiresApproval,
                  })),
                }
              : null
          }
          proposeForm={proposeForm}
          actionMessage={message}
          onSelectDriver={(id) => {
            setSelectedDriverId(id);
            setMessage(null);
          }}
          onProposeFormChange={setProposeForm}
          onSubmitPropose={() => propose.mutate()}
          onDecide={(id, approve, reason) =>
            decide.mutate({ id, approve, reason })
          }
          onFileAppeal={(id, note) => fileAppeal.mutate({ id, note })}
          onDecideAppeal={(id, uphold, reason) =>
            decideAppeal.mutate({ id, uphold, reason })
          }
        />
      </div>
    </div>
  );
}
