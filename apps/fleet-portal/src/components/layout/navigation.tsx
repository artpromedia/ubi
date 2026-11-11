"use client";

import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Car,
  CheckCircle2,
  FileSignature,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  ShieldAlert,
  Smartphone,
  Users,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Logo } from "@ubi/ui";

import { useFleetContextOptional } from "@/components/fleet/fleet-context";
import { ROLE_LABELS } from "@/lib/roles";
import type { PublicFleetSession } from "@/lib/session";
import { FLEET_ACCOUNT_TEST_IDS } from "@/lib/test-ids";
import { cn } from "@/lib/utils";

/**
 * The fleet portal's navigation (handoff: Overview, Calendar, Vehicles,
 * Conflicts, Assignments, Remittance, Utilisation, Staff & roles). Every
 * section is a real screen on fleet-service; no badge count is shown that the
 * server did not answer. The footer names the fleet and the caller's role
 * there.
 */
export const NAVIGATION = [
  { name: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { name: "Calendar", href: "/calendar", icon: CalendarDays },
  { name: "Vehicles", href: "/vehicles", icon: Car },
  { name: "Conflicts", href: "/conflicts", icon: AlertTriangle },
  { name: "Assignments", href: "/assignments", icon: FileSignature },
  { name: "Remittance", href: "/remittance", icon: Wallet },
  { name: "Utilisation", href: "/utilisation", icon: BarChart3 },
  { name: "Staff & roles", href: "/staff", icon: Users },
] as const;

interface SidebarProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly session?: PublicFleetSession | null;
  readonly onSignOut?: () => Promise<void> | void;
}

export const Sidebar = ({
  isOpen,
  onClose,
  session = null,
  onSignOut,
}: SidebarProps) => {
  const pathname = usePathname();
  const fleetCtx = useFleetContextOptional();
  const fleet = fleetCtx?.fleet ?? null;
  const fleets = fleetCtx?.fleets ?? [];
  const select = fleetCtx?.select;
  const isLimited =
    session?.mode === "limited" || session?.user.homeCityId === null;

  return (
    <>
      {isOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 cursor-default border-none bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={cn(
          "fixed left-0 top-0 z-50 flex h-full w-64 flex-col border-r border-[#1F1F1F] bg-[#0F0F0F] transition-transform lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-[#1F1F1F] px-4">
          <Link href="/dashboard" className="flex items-center gap-3">
            <Logo size="sm" variant="white" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[#1DB954]">
              Fleet
            </span>
          </Link>
          <button
            type="button"
            aria-label="Close menu"
            onClick={onClose}
            className="text-zinc-400 hover:text-white lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {isLimited ? (
          <div className="flex-1 p-4">
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100 space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold">
                <ShieldAlert className="h-3.5 w-3.5 text-amber-300" />
                <span>
                  {session?.user.homeCityId === null
                    ? "City selection required"
                    : "Browser not verified"}
                </span>
              </div>
              <p className="text-zinc-300">
                {session?.user.homeCityId === null
                  ? "Choose your operating city before opening fleet tools."
                  : "Finish verifying this browser to unlock your fleet schedule, vehicles, and assignments."}
              </p>
            </div>
          </div>
        ) : (
          <nav
            aria-label="Fleet portal"
            className="flex-1 space-y-1 overflow-y-auto p-4"
          >
            {NAVIGATION.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm",
                    active
                      ? "bg-[rgba(29,185,84,0.16)] font-semibold text-[#86EFAC]"
                      : "text-zinc-400 hover:bg-[#1A1A1A] hover:text-zinc-100",
                  )}
                >
                  <item.icon className="h-4 w-4" aria-hidden />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        )}

        <div className="space-y-2 border-t border-[#1F1F1F] p-4 text-xs text-zinc-400">
          {!isLimited ? (
            fleet === null ? (
              <p>No fleet selected.</p>
            ) : (
              <>
                {fleets.length > 1 && select ? (
                  <label className="block">
                    <span className="sr-only">Fleet</span>
                    <select
                      value={fleet.fleetId}
                      onChange={(event) => select(event.target.value)}
                      className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100"
                    >
                      {fleets.map((option) => (
                        <option key={option.fleetId} value={option.fleetId}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p className="font-semibold text-zinc-100">{fleet.name}</p>
                )}
                <p>
                  {ROLE_LABELS[fleet.myRole]} · {fleet.cityId}
                </p>
                {fleet.status === "suspended" ? (
                  <p className="text-amber-200">Suspended by UBI · view only</p>
                ) : null}
              </>
            )
          ) : null}

          {session ? (
            <div className="pt-2 border-t border-[#1F1F1F] flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-zinc-200">
                  {`${session.user.firstName} ${session.user.lastName}`.trim() ||
                    session.user.phone}
                </p>
                <p className="truncate text-[11px] text-zinc-500">
                  {session.user.phone}
                  {session.user.homeCityId
                    ? ` · ${session.user.homeCityId}`
                    : ""}
                </p>
              </div>
              {onSignOut ? (
                <button
                  type="button"
                  onClick={() => {
                    void onSignOut();
                  }}
                  data-testid={FLEET_ACCOUNT_TEST_IDS.signIn.signOut}
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-white"
                >
                  <LogOut className="h-3 w-3" aria-hidden />
                  Sign out
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
};

interface FleetHeaderProps {
  readonly onMenuClick: () => void;
  readonly session?: PublicFleetSession | null;
}

export const FleetHeader = ({
  onMenuClick,
  session = null,
}: FleetHeaderProps) => {
  const [showApprove, setShowApprove] = useState(false);
  const [challengeId, setChallengeId] = useState("");
  const [isApproving, setIsApproving] = useState(false);
  const [approveMessage, setApproveMessage] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);

  const handleApproveSubmit = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setApproveError(null);
    setApproveMessage(null);
    const trimmed = challengeId.trim();
    if (!trimmed) {
      setApproveError("Enter the challenge ID from your new browser.");
      return;
    }
    setIsApproving(true);
    try {
      const res = await fetch("/api/auth/step-up/approve", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: trimmed }),
      });
      const payload = (await res.json()) as {
        error?: { message?: string };
      };
      if (!res.ok) {
        setApproveError(
          payload.error?.message ?? "Could not approve that challenge.",
        );
        return;
      }
      setApproveMessage("Device approved. Return to the new browser.");
      setChallengeId("");
    } catch {
      setApproveError("Network error while approving device.");
    } finally {
      setIsApproving(false);
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[#1F1F1F] bg-[#0B0B0B]/90 px-4 backdrop-blur-sm">
      <div className="flex items-center">
        <button
          type="button"
          aria-label="Open menu"
          onClick={onMenuClick}
          className="mr-4 text-zinc-400 hover:text-white lg:hidden"
        >
          <Menu className="h-6 w-6" />
        </button>
        <span className="text-sm font-semibold text-zinc-100">UBI Fleet</span>
      </div>

      {session?.mode === "full" ? (
        <div className="relative">
          <button
            type="button"
            data-testid={FLEET_ACCOUNT_TEST_IDS.signIn.approveDeviceToggle}
            onClick={() => {
              setShowApprove((prev) => !prev);
              setApproveError(null);
              setApproveMessage(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
          >
            <Smartphone className="h-3.5 w-3.5 text-[#1DB954]" aria-hidden />
            Approve device
          </button>

          {showApprove ? (
            <form
              onSubmit={(e) => {
                void handleApproveSubmit(e);
              }}
              className="absolute right-0 mt-2 w-80 rounded-xl border border-zinc-700 bg-[#141414] p-4 shadow-xl space-y-3 z-50"
            >
              <p className="text-xs font-semibold text-zinc-100">
                Approve a new browser or device
              </p>
              <input
                type="text"
                value={challengeId}
                onChange={(e) => setChallengeId(e.target.value)}
                placeholder="Paste challenge ID"
                className="w-full rounded-lg border border-zinc-700 bg-[#0F0F0F] px-3 py-2 text-xs font-mono text-zinc-100 placeholder:text-zinc-500"
              />
              {approveError ? (
                <p className="text-xs text-red-300">{approveError}</p>
              ) : null}
              {approveMessage ? (
                <p className="flex items-center gap-1 text-xs text-[#86EFAC]">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {approveMessage}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={isApproving}
                className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-[#1DB954] px-3 py-1.5 text-xs font-semibold text-black hover:bg-[#19a349] disabled:opacity-50"
              >
                {isApproving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                Approve challenge
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </header>
  );
};
