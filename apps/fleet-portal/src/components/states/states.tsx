/**
 * The honest states every fleet screen renders (handoff "States"): loading,
 * empty, error, offline / stale (with the last-updated time), flag off and
 * permission denied. Each has its own test id so a screen can never pass off
 * "you may not see this" as "there is nothing to see". Flag off shows no
 * preview or sample data at all.
 */
import { AlertTriangle, Loader2, Lock, WifiOff } from "lucide-react";
import Link from "next/link";

import { FLAG_OFF_COPY, type AccessState, type ReadState } from "@/lib/access";
import { FLEET_STATE_TEST_IDS } from "@/lib/test-ids";
import { localTimeOf, zoneShort } from "@/lib/time";
import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

const TONE: Readonly<Record<AccessState["kind"], string>> = {
  unauthenticated: "border-amber-500/30 bg-amber-500/10 text-amber-100",
  flag_off: "border-zinc-700 bg-zinc-900 text-zinc-200",
  forbidden: "border-zinc-700 bg-zinc-900 text-zinc-200",
  not_found: "border-zinc-700 bg-zinc-900 text-zinc-200",
  device_unverified: "border-amber-500/30 bg-amber-500/10 text-amber-100",
  safe_mode: "border-amber-500/30 bg-amber-500/10 text-amber-100",
  unavailable: "border-red-500/30 bg-red-500/10 text-red-100",
  offline: "border-zinc-600 bg-zinc-900 text-zinc-200",
  error: "border-red-500/30 bg-red-500/10 text-red-100",
};

const iconFor = (kind: AccessState["kind"]) => {
  if (kind === "offline") {
    return WifiOff;
  }
  return kind === "forbidden" ? Lock : AlertTriangle;
};

export const StateNotice = ({
  state,
  context,
  onRetry,
}: {
  readonly state: AccessState;
  readonly context?: string;
  readonly onRetry?: () => void;
}) => {
  const Icon = iconFor(state.kind);
  const retryable =
    state.kind === "error" ||
    state.kind === "unavailable" ||
    state.kind === "offline";
  return (
    <div
      role="alert"
      data-testid={FLEET_STATE_TEST_IDS.access(state.kind)}
      className={cn(
        "flex gap-3 rounded-xl border p-4 text-sm",
        TONE[state.kind],
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="space-y-1">
        <p className="font-semibold">
          {state.kind === "flag_off" ? FLAG_OFF_COPY : state.title}
          {context !== undefined && state.kind !== "flag_off" ? (
            <span className="font-normal text-zinc-400"> · {context}</span>
          ) : null}
        </p>
        <p className="text-zinc-300">
          {state.kind === "flag_off"
            ? "The fleet calendar is switched off here while UBI finishes it. No preview or sample data is shown."
            : state.message}
        </p>
        {retryable && onRetry !== undefined ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 rounded-lg border border-zinc-600 px-3 py-1 text-xs text-zinc-100 hover:bg-zinc-800"
          >
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
};

export const LoadingState = ({ label }: { readonly label: string }) => (
  <div
    role="status"
    aria-live="polite"
    data-testid={FLEET_STATE_TEST_IDS.loading}
    className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-[#141414] p-4 text-sm text-zinc-300"
  >
    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
    {label}
  </div>
);

export const EmptyState = ({
  title,
  body,
  action,
}: {
  readonly title: string;
  readonly body?: string;
  readonly action?: { readonly href: string; readonly label: string };
}) => (
  <div
    data-testid={FLEET_STATE_TEST_IDS.empty}
    className="rounded-xl border border-dashed border-zinc-700 p-6 text-center text-sm"
  >
    <p className="font-semibold text-zinc-100">{title}</p>
    {body !== undefined ? <p className="mt-1 text-zinc-400">{body}</p> : null}
    {action !== undefined ? (
      <Link
        href={action.href}
        className="mt-3 inline-block rounded-lg bg-[#1DB954] px-3 py-1.5 text-xs font-semibold text-black"
      >
        {action.label}
      </Link>
    ) : null}
  </div>
);

/** "Offline · showing data from 09:12 WAT" over data that could not refresh. */
export const StaleBanner = ({
  stale,
  updatedAt,
  zone,
}: {
  readonly stale: AccessState;
  readonly updatedAt: number;
  readonly zone: string;
}) => {
  const time = `${localTimeOf(updatedAt, zone)} ${zoneShort(zone, updatedAt)}`;
  return (
    <div
      role="status"
      data-testid={FLEET_STATE_TEST_IDS.stale}
      className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-300"
    >
      <WifiOff className="h-3.5 w-3.5" aria-hidden />
      {stale.kind === "offline"
        ? `Offline · showing data from ${time}. Changes are disabled until you reconnect.`
        : `Couldn't refresh · showing data from ${time}. ${stale.message}`}
    </div>
  );
};

/**
 * Renders a read's state: loading, the classified failure, or the data (with
 * a stale banner when it could not be refreshed).
 */
export const ReadGate = <T,>({
  state,
  loadingLabel,
  context,
  zone,
  onRetry,
  children,
}: {
  readonly state: ReadState<T>;
  readonly loadingLabel: string;
  readonly context?: string;
  readonly zone: string;
  readonly onRetry?: () => void;
  readonly children: (data: T) => ReactNode;
}) => {
  if (state.kind === "loading") {
    return <LoadingState label={loadingLabel} />;
  }
  if (state.kind === "failed") {
    return (
      <StateNotice state={state.access} context={context} onRetry={onRetry} />
    );
  }
  return (
    <div className="space-y-3">
      {state.stale !== null ? (
        <StaleBanner
          stale={state.stale}
          updatedAt={state.updatedAt}
          zone={zone}
        />
      ) : null}
      {children(state.data)}
    </div>
  );
};

/** A status pill: always text, never colour alone. */
export const Pill = ({
  children,
  tone = "mute",
}: {
  readonly children: ReactNode;
  readonly tone?: "ok" | "warn" | "bad" | "info" | "mute";
}) => (
  <span
    className={cn(
      "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
      tone === "ok" && "border-green-500/40 bg-green-500/10 text-[#86EFAC]",
      tone === "warn" && "border-amber-500/40 bg-amber-500/10 text-amber-200",
      tone === "bad" && "border-red-500/50 bg-red-500/10 text-red-200",
      tone === "info" && "border-[#5B73C4] bg-[#27345C] text-[#C7D2FE]",
      tone === "mute" && "border-zinc-700 bg-zinc-800 text-zinc-300",
    )}
  >
    {children}
  </span>
);

/** The permission-denied note shown where controls are hidden (B9). */
export const PermissionNote = ({
  children,
}: {
  readonly children: ReactNode;
}) => (
  <p
    data-testid={FLEET_STATE_TEST_IDS.access("permission")}
    className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-[#141414] px-3 py-2 text-xs text-zinc-400"
  >
    <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
    <span>{children}</span>
  </p>
);
