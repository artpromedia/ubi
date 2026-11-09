"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PolicyEditorPage } from "@/components/marketplace/PolicyEditorPage";
import {
  boundsFields,
  canPublishPolicy,
  envelopeFields,
  marketplaceApi,
  presetFields,
  type ChangeRequestApproval,
  type ChangeRequestRejection,
} from "@/lib/marketplace-api";

/**
 * M09 A03+A07 + CC-B01 — policy viewer/editor. Commission is fixed at 10% /
 * 1,000 bps (rendered read-only by the component; not grantable to any role).
 * Publishing goes through the config change-request flow and activates only on
 * a second distinct approver. Unconfigured floors block publish — fail closed.
 * Stopping or resuming new awards requires city-specific confirmation and an
 * audited operator reason.
 */
export default function PolicyEditorContainer() {
  const queryClient = useQueryClient();
  const [cityId, setCityId] = useState("LOS");
  const [status, setStatus] = useState<{
    tone: "ok" | "err" | "info";
    text: string;
  } | null>(null);
  const [killDialog, setKillDialog] = useState<{
    action: "stop" | "resume";
    reason: string;
  } | null>(null);
  const [decisionDialog, setDecisionDialog] = useState<{
    mode: "approve" | "reject";
    requestId: string;
    text: string;
  } | null>(null);

  const config = useQuery({
    queryKey: ["mpCityConfig", cityId],
    queryFn: () => marketplaceApi.cityConfig(cityId),
  });
  const flags = useQuery({
    queryKey: ["mpCityFlags", cityId],
    queryFn: () => marketplaceApi.cityFlags(cityId),
  });
  const history = useQuery({
    queryKey: ["mpConfigHistory", cityId],
    queryFn: () => marketplaceApi.configHistory(cityId),
  });
  const pendingRequests = useQuery({
    queryKey: ["mpPendingChangeRequests", cityId],
    queryFn: () => marketplaceApi.listChangeRequests(cityId, "pending"),
  });

  const invalidatePolicyQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["mpCityConfig", cityId] }),
      queryClient.invalidateQueries({ queryKey: ["mpCityFlags", cityId] }),
      queryClient.invalidateQueries({ queryKey: ["mpConfigHistory", cityId] }),
      queryClient.invalidateQueries({
        queryKey: ["mpPendingChangeRequests", cityId],
      }),
    ]);
  };

  const publish = useMutation({
    mutationFn: () =>
      marketplaceApi.proposePolicyChange(
        cityId,
        { marketplace: config.data?.marketplace },
        "Marketplace policy publish from admin console (" + cityId + ")",
      ),
    onSuccess: async (cr) => {
      setStatus({
        tone: "ok",
        text:
          "Change request " +
          cr.id +
          " is " +
          cr.status +
          " — approvals " +
          cr.approvals +
          "/" +
          cr.approvalsRequired +
          ". It activates only after a second distinct approver.",
      });
      await invalidatePolicyQueries();
    },
    onError: (e) =>
      setStatus({
        tone: "err",
        text: "Publish failed: " + (e as Error).message,
      }),
  });

  const toggleAwards = useMutation({
    mutationFn: ({
      action,
      reason,
    }: {
      action: "stop" | "resume";
      reason: string;
    }) =>
      action === "stop"
        ? marketplaceApi.stopAwards(cityId, reason)
        : marketplaceApi.resumeAwards(cityId, reason),
    onSuccess: async (r, vars) => {
      setKillDialog(null);
      setStatus({
        tone: "ok",
        text:
          "Flag " +
          r.key +
          " for " +
          (r.cityId ?? cityId) +
          ": " +
          r.from +
          " → " +
          r.to +
          " by " +
          r.by +
          (r.replayed ? " (replayed)" : "") +
          (vars.action === "stop"
            ? ". New awards stop; live bids, holds and awards resolve normally."
            : ". New marketplace awards resumed."),
      });
      await invalidatePolicyQueries();
    },
    onError: (e) =>
      setStatus({
        tone: "err",
        text: "Awards flag update failed: " + (e as Error).message,
      }),
  });

  const decideRequest = useMutation({
    mutationFn: async ({
      mode,
      requestId,
      text,
    }: {
      mode: "approve" | "reject";
      requestId: string;
      text: string;
    }): Promise<ChangeRequestApproval | ChangeRequestRejection> =>
      mode === "approve"
        ? marketplaceApi.approveChangeRequest(requestId, text)
        : marketplaceApi.rejectChangeRequest(requestId, text),
    onSuccess: async (res, vars) => {
      setDecisionDialog(null);
      if (vars.mode === "approve" && "approvals" in res) {
        setStatus({
          tone: "ok",
          text:
            res.activated && res.version !== null
              ? `Change request ${res.requestId} activated as config v${res.version}.`
              : `Approval recorded on ${res.requestId} (${res.approvals}/${res.approvalsRequired}); waiting for one more distinct approver.`,
        });
      } else {
        setStatus({
          tone: "ok",
          text: `Change request ${vars.requestId} rejected.`,
        });
      }
      await invalidatePolicyQueries();
    },
    onError: (e) =>
      setStatus({
        tone: "err",
        text: "Change request action failed: " + (e as Error).message,
      }),
  });

  const mp = config.data?.marketplace;
  const bounds = boundsFields(config.data);
  const canPublish = canPublishPolicy(config.data) && !publish.isPending;
  const awardsEnabled =
    flags.data !== undefined ? Boolean(flags.data.marketplace_rides) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border p-4">
        <h1 className="font-heading text-lg font-semibold">
          Marketplace › Policies
        </h1>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          City
          <input
            data-testid="mp.admin.policy.city"
            value={cityId}
            onChange={(e) => {
              setCityId(e.target.value);
              setStatus(null);
              setKillDialog(null);
              setDecisionDialog(null);
            }}
            className="w-28 rounded-lg border border-border bg-card px-2 py-1 text-sm text-foreground"
          />
        </label>
      </div>
      {config.isError ? (
        <div
          data-testid="mp.admin.policy.error"
          className="border-b border-border bg-red-500/15 p-3 text-xs text-red-400"
        >
          Could not load config for {cityId}: {(config.error as Error).message}
        </div>
      ) : null}
      {status ? (
        <div
          data-testid="mp.admin.policy.status"
          className={
            "border-b border-border p-3 text-xs " +
            (status.tone === "err"
              ? "bg-red-500/15 text-red-400"
              : status.tone === "ok"
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-card text-muted-foreground")
          }
        >
          {status.text}
        </div>
      ) : null}
      <div className="flex-1 overflow-auto">
        <PolicyEditorPage
          scopeLine={"Marketplace policy · " + cityId}
          activeVersion={
            config.data
              ? "config v" +
                config.data.version +
                (mp
                  ? " · policy v" + mp.policyVersion
                  : " · no marketplace block")
              : "…"
          }
          bounds={bounds.fields}
          boundsError={bounds.error}
          presets={presetFields(mp)}
          envelopes={envelopeFields(mp)}
          previewLine={null}
          audit={(history.data?.versions ?? []).map((v) => ({
            version: "v" + v.version,
            line:
              (v.reason ?? "no reason recorded") +
              " · by " +
              v.authoredBy +
              (v.approvers.length > 0
                ? " · approved by " + v.approvers.join(", ")
                : "") +
              (v.activatedAt
                ? " · " + v.activatedAt.slice(0, 10)
                : " · not activated"),
          }))}
          roleLine="Publishing opens a config change request; two distinct approvers other than the author activate it. Commission (10% · 1,000 bps) is fixed by contract and not grantable to any role."
          killSwitchScope={
            "Stops or resumes NEW publications and awards only (flag marketplace_rides, " +
            cityId +
            "). Existing bids, holds and awards resolve; active jobs are never reverted."
          }
          canPublish={canPublish}
          awardsEnabled={awardsEnabled}
          onSaveDraft={() =>
            setStatus({
              tone: "info",
              text: "config-service has no draft endpoint — a change request created by Publish is the pending draft until the second approval.",
            })
          }
          onPublish={() => publish.mutate()}
          onStopAwards={() => setKillDialog({ action: "stop", reason: "" })}
          onResumeAwards={() => setKillDialog({ action: "resume", reason: "" })}
          killSwitchDialog={
            killDialog
              ? {
                  action: killDialog.action,
                  cityId,
                  reason: killDialog.reason,
                  busy: toggleAwards.isPending,
                  onReasonChange: (reason) =>
                    setKillDialog({ ...killDialog, reason }),
                  onCancel: () => setKillDialog(null),
                  onConfirm: () =>
                    toggleAwards.mutate({
                      action: killDialog.action,
                      reason: killDialog.reason,
                    }),
                }
              : null
          }
          pendingRequests={(pendingRequests.data?.requests ?? []).map(
            (req) => ({
              id: req.id,
              cityId: req.cityId,
              reason: req.reason,
              authorId: req.authorId,
              approvals: req.approvals,
              approvalsRequired: req.approvalsRequired,
              approvers: req.approvers.map((a) => a.approverId),
              createdAt: req.createdAt,
            }),
          )}
          onApproveRequest={(requestId) =>
            setDecisionDialog({ mode: "approve", requestId, text: "" })
          }
          onRejectRequest={(requestId) =>
            setDecisionDialog({ mode: "reject", requestId, text: "" })
          }
          decisionDialog={
            decisionDialog
              ? {
                  mode: decisionDialog.mode,
                  requestId: decisionDialog.requestId,
                  cityId,
                  text: decisionDialog.text,
                  busy: decideRequest.isPending,
                  onTextChange: (text) =>
                    setDecisionDialog({ ...decisionDialog, text }),
                  onCancel: () => setDecisionDialog(null),
                  onConfirm: () =>
                    decideRequest.mutate({
                      mode: decisionDialog.mode,
                      requestId: decisionDialog.requestId,
                      text: decisionDialog.text,
                    }),
                }
              : null
          }
        />
      </div>
    </div>
  );
}
