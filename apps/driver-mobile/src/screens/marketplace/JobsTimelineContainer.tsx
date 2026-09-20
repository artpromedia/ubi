// D05 + D11 container — Jobs (Root screen). Everything on this screen is a server
// projection of durable events (award.confirmed, commission.captured, claim.promoted,
// queue.*): a job card and its fee receipt id exist only because the server said so.
// GET /v1/mp/driver/jobs serves the OpenAPI DriverJob schema (claimId, slot, service,
// state, fareMinor, commissionMinor, receiptId?, executionRef?, pickupWindow?); this
// container only FORMATS those server amounts and fields for display — it never
// computes money (launch CLAUDE.md #1). Promotion stays "pending"/"failed_revalidating"
// until the claim authority resolves it — the client never unlocks the next pickup on
// its own.
import React from "react";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { Screen, Skeleton, Banner } from "@ubi/mobile-ui";
import { formatMinor } from "@ubi/mobile-core";
import { marketplaceApi, type MpDriverJob } from "../../api/marketplace";
import { JobsTimelineScreen, type JobCard } from "./JobsTimelineScreen";

/** Pure DriverJob → JobCard projection (exported for tests). Formatting only. */
export const jobCard = (c: MpDriverJob): JobCard => ({
  claimId: c.claimId,
  slot: c.slot,
  statusSuffix: c.state,
  title:
    (c.service === "delivery" ? "Delivery" : "Ride") +
    " · " +
    formatMinor(c.fareMinor) +
    " agreed",
  fareMinor: c.fareMinor,
  feeLine:
    "Fee " +
    formatMinor(c.commissionMinor) +
    " · debited at selection" +
    (c.receiptId ? " · " + c.receiptId : ""),
  feeReceiptId: c.receiptId ?? "",
  detail: c.pickupWindow
    ? "Pickup commitment " +
      Math.round(c.pickupWindow.earliestSec / 60) +
      "–" +
      Math.round(c.pickupWindow.latestSec / 60) +
      " min · rider sees live updates"
    : "",
  remainingLabel: null,
});

export function JobsTimelineContainer() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const q = useQuery({
    queryKey: ["mp", "jobs"],
    queryFn: marketplaceApi.jobs,
    refetchInterval: 5_000,
  });
  if (q.isError) {
    return (
      <Screen title="Your jobs" onBack={nav.goBack} bg="bg2">
        <Banner
          tone="error"
          title="Couldn’t load your jobs"
          body={(q.error as Error).message}
        />
      </Screen>
    );
  }
  const view = q.data;
  if (!view)
    return (
      <Screen title="Your jobs" onBack={nav.goBack} bg="bg2">
        <Skeleton height={180} />
        <Skeleton height={120} />
      </Screen>
    );
  const toTrip = (
    tripId: string | null | undefined,
    screen: "Navigate" | "InTrip",
  ) => {
    if (!tripId) return;
    nav.navigate("Trip", { screen, params: { tripId } });
  };
  return (
    <JobsTimelineScreen
      // The winner toast needs a server-composed award.confirmed projection the
      // DriverJob schema does not carry (see followups) — never a local guess.
      winnerToast={null}
      current={view.current ? jobCard(view.current) : null}
      next={view.next ? jobCard(view.next) : null}
      promotion={view.promotion === "none" ? null : view.promotion}
      onContinueCurrent={() =>
        toTrip(view.current?.executionRef?.id ?? null, "InTrip")
      }
      onBack={nav.goBack}
    />
  );
}
