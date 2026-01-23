"use client";

import { cn } from "@/lib/utils";
import { LogoIcon } from "@ubi/ui";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Car,
  ChevronDown,
  CreditCard,
  FileCheck,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Settings,
  Shield,
  Users,
  UtensilsCrossed,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const navigation = [
  {
    name: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    name: "Users",
    href: "/users",
    icon: Users,
    children: [
      { name: "All Users", href: "/users" },
      { name: "Riders", href: "/users/riders" },
      { name: "Drivers", href: "/users/drivers" },
      { name: "Couriers", href: "/users/couriers" },
    ],
  },
  {
    name: "Rides",
    href: "/rides",
    icon: Car,
    children: [
      { name: "All Rides", href: "/rides" },
      { name: "Live Rides", href: "/rides/live" },
      { name: "Disputes", href: "/rides/disputes" },
    ],
  },
  {
    name: "Food Orders",
    href: "/food",
    icon: UtensilsCrossed,
    children: [
      { name: "All Orders", href: "/food" },
      { name: "Restaurants", href: "/food/restaurants" },
      { name: "Live Orders", href: "/food/live" },
    ],
  },
  {
    name: "Deliveries",
    href: "/deliveries",
    icon: Package,
    children: [
      { name: "All Deliveries", href: "/deliveries" },
      { name: "Live Tracking", href: "/deliveries/live" },
      { name: "Issues", href: "/deliveries/issues" },
    ],
  },
  {
    name: "Payments",
    href: "/payments",
    icon: CreditCard,
    children: [
      { name: "Transactions", href: "/payments" },
      { name: "Payouts", href: "/payments/payouts" },
      { name: "Refunds", href: "/payments/refunds" },
    ],
  },
  {
    name: "Verification",
    href: "/verification",
    icon: FileCheck,
    children: [
      { name: "Document Review", href: "/verification" },
      { name: "Background Checks", href: "/verification/background" },
      { name: "Liveness Checks", href: "/verification/liveness" },
    ],
  },
  {
    name: "Fraud Center",
    href: "/fraud",
    icon: AlertTriangle,
  },
  {
    name: "Safety",
    href: "/safety",
    icon: Shield,
    children: [
      { name: "Incidents", href: "/safety" },
      { name: "Background Checks", href: "/safety/checks" },
      { name: "Reports", href: "/safety/reports" },
    ],
  },
];

const secondaryNavigation = [
  { name: "Settings", href: "/settings", icon: Settings },
  { name: "Help", href: "/help", icon: HelpCircle },
];

interface SidebarProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: Readonly<SidebarProps>) {
  const pathname = usePathname();
  const [expandedItems, setExpandedItems] = useState<string[]>([]);

  const toggleExpanded = (name: string) => {
    setExpandedItems((prev) =>
      prev.includes(name)
        ? prev.filter((item) => item !== name)
        : [...prev, name],
    );
  };

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

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
          "fixed top-0 left-0 z-50 h-full w-72 bg-gray-950 border-r border-gray-800 flex flex-col transition-transform lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-gray-800">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
              <LogoIcon className="h-5 w-5 text-white" />
            </div>
            <span className="font-bold text-white">UBI Admin</span>
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
            <div key={item.name}>
              {item.children ? (
                <>
                  <button
                    onClick={() => toggleExpanded(item.name)}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition",
                      isActive(item.href)
                        ? "bg-green-500/10 text-green-500"
                        : "text-gray-400 hover:text-white hover:bg-gray-800",
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <item.icon className="w-5 h-5" />
                      {item.name}
                    </span>
                    <ChevronDown
                      className={cn(
                        "w-4 h-4 transition-transform",
                        expandedItems.includes(item.name) && "rotate-180",
                      )}
                    />
                  </button>
                  <motion.div
                    initial={false}
                    animate={{
                      height: expandedItems.includes(item.name) ? "auto" : 0,
                      opacity: expandedItems.includes(item.name) ? 1 : 0,
                    }}
                    className="overflow-hidden"
                  >
                    <div className="ml-4 mt-1 space-y-1 border-l border-gray-800 pl-4">
                      {item.children.map((child) => (
                        <Link
                          key={child.name}
                          href={child.href}
                          className={cn(
                            "block px-3 py-2 rounded-lg text-sm transition",
                            pathname === child.href
                              ? "bg-green-500/10 text-green-500"
                              : "text-gray-400 hover:text-white hover:bg-gray-800",
                          )}
                        >
                          {child.name}
                        </Link>
                      ))}
                    </div>
                  </motion.div>
                </>
              ) : (
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition",
                    isActive(item.href)
                      ? "bg-green-500/10 text-green-500"
                      : "text-gray-400 hover:text-white hover:bg-gray-800",
                  )}
                >
                  <item.icon className="w-5 h-5" />
                  {item.name}
                </Link>
              )}
            </div>
          ))}

          {/* Divider */}
          <div className="!my-4 border-t border-gray-800" />

          {/* Secondary navigation */}
          {secondaryNavigation.map((item) => (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition",
                pathname === item.href
                  ? "bg-green-500/10 text-green-500"
                  : "text-gray-400 hover:text-white hover:bg-gray-800",
              )}
            >
              <item.icon className="w-5 h-5" />
              {item.name}
            </Link>
          ))}
        </nav>

        {/* User section */}
        <div className="p-4 border-t border-gray-800">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-900">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
              <span className="text-white text-sm font-medium">JD</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                John Doe
              </p>
              <p className="text-xs text-gray-500 truncate">Super Admin</p>
            </div>
            <button className="text-gray-400 hover:text-white transition">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

interface AdminHeaderProps {
  readonly onMenuClick: () => void;
  readonly title?: string;
}

export function AdminHeader({
  onMenuClick,
  title,
}: Readonly<AdminHeaderProps>) {
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
        {/* Search */}
        <div className="hidden md:block">
          <input
            type="search"
            placeholder="Search..."
            className="w-64 px-4 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>

        {/* Notifications */}
        <button className="relative text-gray-400 hover:text-white transition">
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
            />
          </svg>
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
            3
          </span>
        </button>
      </div>
    </header>
  );
}
