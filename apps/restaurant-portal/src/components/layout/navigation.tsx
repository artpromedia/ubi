"use client";

import { cn } from "@/lib/utils";
import { LogoIcon } from "@ubi/ui";
import { Bell, LayoutDashboard, Menu, X } from "lucide-react";
import Link from "next/link";

/**
 * The restaurant portal is not built out yet: only /dashboard exists, and it
 * says so honestly rather than rendering mock orders or revenue. The sidebar
 * and header stay minimal and never claim a section, order count or
 * restaurant identity that isn't real.
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
      {isOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 bg-black/50 z-40 lg:hidden cursor-default border-none"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "fixed top-0 left-0 z-50 h-full w-64 bg-gray-950 border-r border-gray-800 flex flex-col transition-transform lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between h-16 px-4 border-b border-gray-800">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center">
              <LogoIcon className="h-5 w-5 text-white" />
            </div>
            <span className="font-bold text-white">UBI Bites</span>
          </Link>
          <button
            onClick={onClose}
            className="lg:hidden text-gray-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {navigation.map((item) => (
            <Link
              key={item.name}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm bg-orange-500/10 text-orange-500"
            >
              <item.icon className="w-5 h-5" />
              {item.name}
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-800">
          <p className="text-xs text-gray-500">
            Orders, menu management, payouts and reviews aren&apos;t available
            here yet. Restaurant onboarding is arranged directly with UBI in the
            meantime.
          </p>
        </div>
      </aside>
    </>
  );
}

interface RestaurantHeaderProps {
  readonly onMenuClick: () => void;
  readonly title?: string;
}

export function RestaurantHeader({
  onMenuClick,
  title,
}: Readonly<RestaurantHeaderProps>) {
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
