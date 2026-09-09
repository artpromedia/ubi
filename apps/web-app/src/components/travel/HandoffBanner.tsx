"use client";
import { useEffect, useRef } from "react";
import { Button } from "@ubi/ui";
import { useAttributionClaim } from "./api";
import { WEB_TEST_IDS } from "./types";

/**
 * Board 23f — web-to-app handoff that keeps attribution.
 *
 * Attribution is carried two independent ways so nothing is lost:
 *  1. The app link always embeds ref/campaign as a deferred deep link — the app claims it
 *     via POST /v1/attribution/claim on first open. This is the fallback and needs no network.
 *  2. Best-effort, we also register the handoff against the account now (source: web_handoff).
 * The web page itself stays fully usable regardless of either.
 */
export function HandoffBanner({
  tripId,
  referralCode,
  campaign,
}: {
  tripId: string;
  referralCode?: string;
  campaign?: string;
}) {
  const claim = useAttributionClaim();
  const claimed = useRef(false);

  useEffect(() => {
    if (claimed.current) return;
    if (!referralCode && !campaign) return;
    claimed.current = true;
    // Best effort: attribution survives via the deferred deep link even if this fails.
    claim.mutate({ code: referralCode, campaign, source: "web_handoff" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referralCode, campaign]);

  const params = new URLSearchParams();
  if (referralCode) params.set("ref", referralCode);
  if (campaign) params.set("c", campaign);
  const qs = params.toString();
  const appLink =
    "https://links.ubi.africa/trips/" + tripId + (qs ? "?" + qs : "");

  return (
    <div
      data-testid={WEB_TEST_IDS.handoff.banner}
      className="flex items-center gap-3 bg-[#191414] px-4 py-3 text-white"
    >
      <div className="h-9 w-9 shrink-0 rounded-[10px] bg-[#1DB954]" aria-hidden />
      <div className="flex-1">
        <div className="text-[13px] font-semibold">Manage this trip in the UBI app</div>
        <div className="text-[11.5px] text-[#A3A3A3]">
          Live updates, boarding pass, rides — your referral code carries over
        </div>
      </div>
      <Button
        asChild
        size="sm"
        className="bg-[#1DB954] text-[#191414] hover:bg-[#18A349]"
      >
        <a href={appLink} data-testid={WEB_TEST_IDS.handoff.open}>
          Open
        </a>
      </Button>
    </div>
  );
}

export function HandoffFallbackNote({
  referralCode,
  campaign,
}: {
  referralCode?: string;
  campaign?: string;
}) {
  return (
    <p
      data-testid={WEB_TEST_IDS.handoff.fallback}
      className="border-t border-[#E5E5E5] bg-white px-4 py-3 text-[11.5px] leading-relaxed text-[#666]"
    >
      &quot;Open&quot; tries the installed app first (App Link / Universal Link). If it
      isn&apos;t installed you go to the store; your code{" "}
      <span className="font-mono text-[#191414]">{referralCode ?? "—"}</span> and campaign{" "}
      <span className="font-mono text-[#191414]">{campaign ?? "—"}</span> are kept
      server-side against your account for 30 days — nothing is lost if the store link drops
      them. Everything above also works right here.
    </p>
  );
}
