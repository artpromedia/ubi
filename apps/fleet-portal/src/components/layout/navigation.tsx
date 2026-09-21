"use client";

import { cn } from "@/lib/utils";
import { Logo } from "@ubi/ui";
import { Bell, LayoutDashboard, Menu, X } from "lucide-react";
import Link from "next/link";

/**
 * The fleet portal is not built out yet: only /dashboard exists, and that page
 * says so honestly rather than rendering mock drivers, vehicles or earnings.
 * The sidebar and header stay minimal and never claim a section that isn't
 * there — no fake badge counts, no fake fleet name.
 */
const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
];

interface SidebarProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: Readonly<SidebarProps>) {
  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 bg-black/50 z-40 lg:hidden cursor-default border-none"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed top-0 left-0 z-50 h-full w-64 bg-gray-950 border-r border-gray-800 flex flex-col transition-transform lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-gray-800">
          <Link href="/dashboard" className="flex items-center gap-3">
            <Logo size="sm" variant="white" />
            <span className="text-xs font-semibold text-green-500 uppercase tracking-wider">
              Fleet
            </span>
          </Link>
          <button
            onClick={onClose}
            className="lg:hidden text-gray-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {navigation.map((item) => (
            <Link
              key={item.name}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm bg-green-500/10 text-green-500"
            >
              <item.icon className="w-5 h-5" />
              {item.name}
            </Link>
          ))}
        </nav>

        {/* Status */}
        <div className="p-4 border-t border-gray-800">
          <p className="text-xs text-gray-500">
            Driver and vehicle management, payouts, live map and reports
            aren&apos;t available here yet. Fleet arrangements are agreed
            directly with UBI in the meantime.
          </p>
        </div>
      </aside>
    </>
  );
}

interface FleetHeaderProps {
  readonly onMenuClick: () => void;
  readonly title?: string;
}

export function FleetHeader({
  onMenuClick,
  title,
}: Readonly<FleetHeaderProps>) {
  return (
    <header className="sticky top-0 z-30 h-16 bg-gray-950/80 backdrop-blur-sm border-b border-gray-800 flex items-center px-4 lg:px-6">
      <button
        onClick={onMenuClick}
        className="lg:hidden text-gray-400 hover:text-white mr-4"
      >
        <Menu className="w-6 h-6" />
      </button>

      {title && <h1 className="text-lg font-semibold text-white">{title}</h1>}

      <div className="ml-auto flex items-center gap-4">
        <Bell className="w-5 h-5 text-gray-600" aria-hidden />
      </div>
    </header>
  );
}
