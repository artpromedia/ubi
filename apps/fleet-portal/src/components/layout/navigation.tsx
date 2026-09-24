"use client";

import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Car,
  FileSignature,
  LayoutDashboard,
  Menu,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo } from "@ubi/ui";

import { useFleetContext } from "@/components/fleet/fleet-context";
import { ROLE_LABELS } from "@/lib/roles";
import { cn } from "@/lib/utils";

/**
 * The fleet portal's navigation (handoff: Overview, Calendar, Vehicles,
 * Conflicts, Assignments, Utilisation, Staff & roles). Every section is a
 * real screen on fleet-service; no badge count is shown that the server did
 * not answer. The footer names the fleet and the caller's role there.
 */
export const NAVIGATION = [
  { name: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { name: "Calendar", href: "/calendar", icon: CalendarDays },
  { name: "Vehicles", href: "/vehicles", icon: Car },
  { name: "Conflicts", href: "/conflicts", icon: AlertTriangle },
  { name: "Assignments", href: "/assignments", icon: FileSignature },
  { name: "Utilisation", href: "/utilisation", icon: BarChart3 },
  { name: "Staff & roles", href: "/staff", icon: Users },
] as const;

interface SidebarProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

export const Sidebar = ({ isOpen, onClose }: SidebarProps) => {
  const pathname = usePathname();
  const { fleet, fleets, select } = useFleetContext();
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
        <div className="space-y-2 border-t border-[#1F1F1F] p-4 text-xs text-zinc-400">
          {fleet === null ? (
            <p>No fleet selected.</p>
          ) : (
            <>
              {fleets.length > 1 ? (
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
          )}
        </div>
      </aside>
    </>
  );
};

interface FleetHeaderProps {
  readonly onMenuClick: () => void;
}

export const FleetHeader = ({ onMenuClick }: FleetHeaderProps) => (
  <header className="sticky top-0 z-30 flex h-14 items-center border-b border-[#1F1F1F] bg-[#0B0B0B]/90 px-4 backdrop-blur-sm lg:hidden">
    <button
      type="button"
      aria-label="Open menu"
      onClick={onMenuClick}
      className="mr-4 text-zinc-400 hover:text-white"
    >
      <Menu className="h-6 w-6" />
    </button>
    <span className="text-sm font-semibold text-zinc-100">UBI Fleet</span>
  </header>
);
