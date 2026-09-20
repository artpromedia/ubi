"use client";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PolicyEditorPage } from "@/components/marketplace/PolicyEditorPage";
import {
  boundsFields,
  canPublishPolicy,
  envelopeFields,
  marketplaceApi,
  presetFields,
} from "@/lib/marketplace-api";

/**
 * M09 A03+A07 — policy viewer/editor. Commission is fixed at 10% / 1,000 bps
 * (rendered read-only by the component; not grantable to any role). Publishing
 * goes through the config change-request flow and activates only on a second
 * distinct approver. Unconfigured floors block publish — fail closed.
 */
export default function PolicyEditorContainer() {
  const [cityId, setCityId] = useState("lagos");
  const [status, setStatus] = useState<{
    tone: "ok" | "err" | "info";
    text: string;
  } | null>(null);

  const config = useQuery({
    queryKey: ["mpCityConfig", cityId],
    queryFn: () => marketplaceApi.cityConfig(cityId),
  });
  const history = useQuery({
    queryKey: ["mpConfigHistory", cityId],
    queryFn: () => marketplaceApi.configHistory(cityId),
  });

  const publish = useMutation({
    mutationFn: () =>
      marketplaceApi.proposePolicyChange(
        cityId,
        { marketplace: config.data?.marketplace },
        "Marketplace policy publish from admin console (" + cityId + ")",
      ),
    onSuccess: (cr) =>
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
      }),
    onError: (e) =>
      setStatus({
        tone: "err",
        text: "Publish failed: " + (e as Error).message,
      }),
  });

  const stopAwards = useMutation({
    mutationFn: () =>
      marketplaceApi.stopAwards(
        cityId,
        "Kill switch from admin console: stop new marketplace awards in " +
          cityId,
      ),
    onSuccess: (r) =>
      setStatus({
        tone: "ok",
        text:
          "Flag " +
          r.key +
          " for " +
          (r.cityId ?? "all cities") +
          ": " +
          r.from +
          " → " +
          r.to +
          " by " +
          r.by +
          (r.replayed ? " (replayed)" : "") +
          ". New awards stop; live bids, holds and awards resolve normally.",
      }),
    onError: (e) =>
      setStatus({
        tone: "err",
        text: "Kill switch failed: " + (e as Error).message,
      }),
  });

  const mp = config.data?.marketplace;
  const bounds = boundsFields(config.data);
  const canPublish = canPublishPolicy(config.data) && !publish.isPending;

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
          roleLine="Publishing opens a config change request; a second distinct approver activates it. Commission (10% · 1,000 bps) is fixed by contract and not grantable to any role."
          killSwitchScope={
            "Stops NEW publications and awards only (flag marketplace_rides, " +
            cityId +
            "). Existing bids, holds and awards resolve; active jobs are never reverted."
          }
          canPublish={canPublish}
          onSaveDraft={() =>
            setStatus({
              tone: "info",
              text: "config-service has no draft endpoint — a change request created by Publish is the pending draft until the second approval.",
            })
          }
          onPublish={() => publish.mutate()}
          onStopAwards={() => stopAwards.mutate()}
        />
      </div>
    </div>
  );
}
