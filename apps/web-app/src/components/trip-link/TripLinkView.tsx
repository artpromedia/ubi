/**
 * The guest passenger's trip page — presentational only (no data fetching, no storage, no
 * analytics). Everything it prints is the server's: the status word, the driver card (or
 * "details unavailable"), the ETA with its basis and age, how pickup is verified, the support
 * reference and emergency number, and whether a free decline is still possible. Nothing about
 * the person who booked, the fare or any other trip is shown — the view carries none of it.
 */
import {
  TRIP_LINK_FAILURE_COPY,
  type TripAccessView,
  type TripLinkFailure,
} from "@/lib/trip-link";
import { WEB_TEST_IDS } from "@/components/travel/types";

const TID = WEB_TEST_IDS.tripLink;

export type PinState =
  | { state: "hidden" }
  | { state: "loading" }
  | { state: "shown"; pin: string }
  | { state: "refused"; title: string; body: string };

export type DeclineState = {
  confirming: boolean;
  busy: boolean;
  refusal: { title: string; body: string } | null;
};

export type TripLinkViewProps =
  | { phase: "loading" }
  | { phase: "missing" }
  | { phase: "refused"; failure: TripLinkFailure; onRetry?: () => void }
  | {
      phase: "trip";
      view: TripAccessView;
      /** A refresh failed: the view is the last answer, with its own "as of" time. */
      stale: boolean;
      pin: PinState;
      onRevealPin: () => void;
      decline: DeclineState;
      onDecline: () => void;
      onConfirmDecline: () => void;
      onCancelDecline: () => void;
      onRefresh: () => void;
    };

const REFUSAL_TID: Partial<Record<TripLinkFailure, string>> = {
  expired: TID.expired,
  revoked: TID.revoked,
  invalid: TID.invalid,
};

const timeOf = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      id="main-content"
      data-testid={TID.screen}
      className="mx-auto flex min-h-screen max-w-md flex-col gap-3 bg-[#F9FAFB] p-4 text-[#191414]"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[2px] text-[#6B7280]">
        UBI · your ride
      </p>
      {children}
    </main>
  );
}

function Card({
  testId,
  children,
  tone = "default",
}: {
  testId?: string;
  children: React.ReactNode;
  tone?: "default" | "warn" | "error" | "ok";
}) {
  const border =
    tone === "warn"
      ? "border-[#FDE68A] bg-[#FFFBEB]"
      : tone === "error"
        ? "border-[#FEE2E2] bg-[#FEE2E2]"
        : tone === "ok"
          ? "border-[#A7F3D0] bg-[#ECFDF5]"
          : "border-[#E5E7EB] bg-white";
  return (
    <section
      data-testid={testId}
      className={"space-y-1.5 rounded-xl border p-4 shadow-sm " + border}
    >
      {children}
    </section>
  );
}

export function TripLinkView(p: TripLinkViewProps) {
  if (p.phase === "loading")
    return (
      <Shell>
        <p data-testid={TID.loading} className="text-sm text-[#6B7280]">
          Loading your trip…
        </p>
      </Shell>
    );
  if (p.phase === "missing")
    return (
      <Shell>
        <Card testId={TID.missing} tone="warn">
          <h1 className="text-base font-semibold">
            Open the link from your text
          </h1>
          <p className="text-sm text-[#6B7280]">
            This page needs the private link UBI texted you. Open it from the
            message on this phone — it doesn’t work if it was copied without its
            end.
          </p>
        </Card>
      </Shell>
    );
  if (p.phase === "refused") {
    const copy = TRIP_LINK_FAILURE_COPY[p.failure];
    const retryable =
      p.failure === "offline" ||
      p.failure === "error" ||
      p.failure === "rate_limited";
    return (
      <Shell>
        <Card
          testId={REFUSAL_TID[p.failure] ?? TID.error}
          tone={retryable ? "warn" : "error"}
        >
          <h1 className="text-base font-semibold">{copy.title}</h1>
          <p className="text-sm text-[#374151]">{copy.body}</p>
          {retryable && p.onRetry ? (
            <button
              type="button"
              data-testid={TID.retry}
              onClick={p.onRetry}
              className="mt-2 min-h-[44px] rounded-lg border border-[#E5E7EB] px-4 text-sm font-semibold"
            >
              Try again
            </button>
          ) : null}
        </Card>
      </Shell>
    );
  }
  const v = p.view;
  const driver = v.driver;
  const verified = driver?.profileStatus === "verified";
  const declined = v.status === "declined";
  return (
    <Shell>
      <Card testId={TID.status} tone={declined ? "warn" : "default"}>
        <p className="text-xs text-[#6B7280]">Hi {v.passenger.firstName}</p>
        <h1 className="text-lg font-bold" aria-live="polite">
          {v.statusLabel}
        </h1>
        {v.eta ? (
          <p data-testid={TID.eta} className="text-sm text-[#374151]">
            {v.eta.label}
            <span className="text-[#6B7280]">
              {v.eta.basis === "routed_leg"
                ? " · estimate as of " + timeOf(v.eta.asOf)
                : ""}
            </span>
          </p>
        ) : null}
        {p.stale ? (
          <p className="text-xs text-[#92400E]">
            Couldn’t refresh — showing the update from {timeOf(v.asOf)}.{" "}
            <button
              type="button"
              data-testid={TID.retry}
              onClick={p.onRefresh}
              className="font-semibold underline"
            >
              Refresh
            </button>
          </p>
        ) : null}
      </Card>
      {declined ? (
        <Card testId={TID.declined} tone="warn">
          <p className="text-sm font-semibold">You declined this ride</p>
          <p className="text-sm text-[#374151]">
            Nothing was charged to you. The person who booked it has been told.
          </p>
        </Card>
      ) : null}
      <Card testId={TID.route}>
        <p className="text-xs uppercase tracking-wide text-[#6B7280]">Pickup</p>
        <p className="text-sm font-semibold">{v.pickup.label || "—"}</p>
        <p className="pt-1 text-xs uppercase tracking-wide text-[#6B7280]">
          Drop-off
        </p>
        <p className="text-sm font-semibold">{v.dropoff.label || "—"}</p>
      </Card>
      {driver ? (
        <Card testId={TID.driver}>
          <p className="text-xs uppercase tracking-wide text-[#6B7280]">
            Your driver
          </p>
          {verified ? (
            <>
              <p className="text-base font-semibold">{driver.displayName}</p>
              <p className="text-sm text-[#374151]">
                {driver.vehicle} ·{" "}
                <span className="font-mono">{driver.plateMasked}</span>
              </p>
              <p className="text-xs text-[#6B7280]">Verified by UBI</p>
            </>
          ) : (
            <>
              <p className="text-base font-semibold">
                Driver details unavailable
              </p>
              <p className="text-sm text-[#374151]">{driver.vehicle}</p>
              <p className="text-xs text-[#6B7280]">
                Check the pickup PIN or your name with the driver before you get
                in.
              </p>
            </>
          )}
        </Card>
      ) : declined ? null : (
        <Card testId={TID.noDriver}>
          <p className="text-sm text-[#374151]">
            No driver yet. Their name, car and plate appear here once one is
            confirmed.
          </p>
        </Card>
      )}
      {!declined ? (
        <Card testId={TID.verification}>
          <p className="text-xs uppercase tracking-wide text-[#6B7280]">
            Before you get in
          </p>
          <p className="text-sm text-[#374151]">
            {v.pickupVerification.instructions}
          </p>
          {v.pickupVerification.method === "pin" ? (
            p.pin.state === "shown" ? (
              <p
                data-testid={TID.pin}
                aria-label={"Pickup PIN " + p.pin.pin.split("").join(" ")}
                className="font-mono text-3xl font-bold tracking-[6px]"
              >
                {p.pin.pin}
              </p>
            ) : p.pin.state === "refused" ? (
              <p
                data-testid={TID.pinUnavailable}
                className="text-sm text-[#92400E]"
              >
                {p.pin.title} — {p.pin.body}
              </p>
            ) : v.pickupVerification.pinAvailable ? (
              <button
                type="button"
                data-testid={TID.pinReveal}
                disabled={p.pin.state === "loading"}
                onClick={p.onRevealPin}
                className="min-h-[48px] rounded-lg bg-[#191414] px-4 text-sm font-semibold text-white disabled:opacity-60"
              >
                {p.pin.state === "loading"
                  ? "Getting your PIN…"
                  : "Show my pickup PIN"}
              </button>
            ) : (
              <p
                data-testid={TID.pinUnavailable}
                className="text-sm text-[#6B7280]"
              >
                Your PIN appears here once your driver is on the way.
              </p>
            )
          ) : null}
        </Card>
      ) : null}
      <Card testId={TID.support}>
        <p className="text-xs uppercase tracking-wide text-[#6B7280]">Help</p>
        <p className="text-sm text-[#374151]">{v.support.note}</p>
        <p className="text-sm">
          Trip reference:{" "}
          <span className="font-mono">{v.support.reference}</span>
        </p>
        {v.support.emergencyNumber ? (
          <a
            href={"tel:" + v.support.emergencyNumber}
            className="inline-flex min-h-[44px] items-center font-semibold text-[#B91C1C]"
          >
            Emergency: {v.support.emergencyNumber}
          </a>
        ) : null}
      </Card>
      {v.actions.canDecline && !declined ? (
        <Card>
          {p.decline.refusal ? (
            <div
              data-testid={TID.refusal}
              className="rounded-lg bg-[#FEE2E2] p-3"
            >
              <p className="text-sm font-semibold text-[#B91C1C]">
                {p.decline.refusal.title}
              </p>
              <p className="text-sm text-[#374151]">{p.decline.refusal.body}</p>
            </div>
          ) : null}
          {p.decline.confirming ? (
            <>
              <p className="text-sm font-semibold">Decline this ride?</p>
              <p className="text-sm text-[#374151]">{v.actions.declineNote}</p>
              <button
                type="button"
                data-testid={TID.declineConfirm}
                disabled={p.decline.busy}
                onClick={p.onConfirmDecline}
                className="min-h-[48px] w-full rounded-lg bg-[#B91C1C] px-4 text-sm font-semibold text-white disabled:opacity-60"
              >
                {p.decline.busy ? "Declining…" : "Yes, decline — it’s free"}
              </button>
              <button
                type="button"
                data-testid={TID.declineCancel}
                onClick={p.onCancelDecline}
                className="min-h-[44px] w-full text-sm font-semibold"
              >
                Keep my ride
              </button>
            </>
          ) : (
            <button
              type="button"
              data-testid={TID.decline}
              onClick={p.onDecline}
              className="min-h-[44px] w-full rounded-lg border border-[#E5E7EB] px-4 text-sm font-semibold"
            >
              Decline this ride (free)
            </button>
          )}
        </Card>
      ) : null}
      <p className="text-[11px] text-[#6B7280]">
        This private page shows only your ride. Keep the link to yourself.
      </p>
    </Shell>
  );
}
