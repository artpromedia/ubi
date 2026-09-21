"use client";

import { cn } from "@/lib/utils";
import { LogoIcon } from "@ubi/ui";
import { Bell, Home, Menu, Search } from "lucide-react";
import Link from "next/link";

/**
 * The merchant portal is not built out yet: only /dashboard exists, and it
 * says so honestly rather than rendering mock shipments or revenue. The
 * sidebar and header stay minimal and never claim a section, business name
 * or live count that isn't real.
 */
const navigation = [{ name: "Dashboard", href: "/dashboard", icon: Home }];

export function Sidebar() {
  return (
    <aside className="h-screen w-64 bg-card border-r border-border flex flex-col sticky top-0">
      {/* Logo */}
      <div className="h-16 flex items-center px-4 border-b border-border">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-cyan-500 to-cyan-600 rounded-lg flex items-center justify-center">
            <LogoIcon className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-bold text-white">UBI Send</span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3">
        <ul className="space-y-1">
          {navigation.map((item) => (
            <li key={item.name}>
              <Link
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium",
                  "bg-cyan-500/10 text-cyan-500",
                )}
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                {item.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* Status */}
      <div className="p-3 border-t border-border">
        <p className="text-xs text-gray-500">
          Shipment tracking, pickups, payouts and API integrations aren&apos;t
          available here yet. Merchant onboarding is arranged directly with UBI
          in the meantime.
        </p>
      </div>
    </aside>
  );
}

export function MerchantHeader() {
  return (
    <header className="h-16 bg-card border-b border-border flex items-center justify-between px-6 sticky top-0 z-40">
      <div className="flex items-center gap-4 flex-1">
        <button className="lg:hidden p-2 hover:bg-surface rounded-lg text-gray-400 hover:text-white">
          <Menu className="w-5 h-5" />
        </button>
        <div className="relative flex-1 max-w-md opacity-50">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            disabled
            placeholder="Search isn't available yet"
            className="w-full pl-10 pr-4 py-2 bg-surface border border-border rounded-lg text-sm text-white placeholder-gray-500"
          />
        </div>
      </div>
      <Bell className="w-5 h-5 text-gray-600" aria-hidden />
    </header>
  );
}
