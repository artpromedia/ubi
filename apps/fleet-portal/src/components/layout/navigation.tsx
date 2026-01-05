"use client";

import { cn } from "@/lib/utils";
import { UbiIcon } from "@ubi/ui";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Car,
  ChevronDown,
  DollarSign,
  FileText,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Settings,
  Users,
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
    name: "Drivers",
    href: "/drivers",
    icon: Users,
    children: [
      { name: "All Drivers", href: "/drivers" },
      { name: "Online", href: "/drivers/online" },
      { name: "Performance", href: "/drivers/performance" },
      { name: "Onboarding", href: "/drivers/onboarding" },
    ],
  },
  {
    name: "Vehicles",
    href: "/vehicles",
    icon: Car,
    children: [
      { name: "All Vehicles", href: "/vehicles" },
      { name: "Inspections", href: "/vehicles/inspections" },
      { name: "Maintenance", href: "/vehicles/maintenance" },
    ],
  },
  {
    name: "Live Map",
    href: "/map",
    icon: MapPin,
  },
  {
    name: "Payouts",
    href: "/payouts",
    icon: DollarSign,
    children: [
      { name: "Overview", href: "/payouts" },
      { name: "History", href: "/payouts/history" },
      { name: "Schedule", href: "/payouts/schedule" },
    ],
  },
  {
    name: "Analytics",
    href: "/analytics",
    icon: BarChart3,
  },
  {
    name: "Incidents",
    href: "/incidents",
    icon: AlertTriangle,
  },
  {
    name: "Reports",
    href: "/reports",
    icon: FileText,
  },
];

const secondaryNavigation = [
  { name: "Settings", href: "/settings", icon: Settings },
  { name: "Help", href: "/help", icon: HelpCircle },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const [expandedItems, setExpandedItems] = useState<string[]>([]);

  const toggleExpanded = (name: string) => {
    setExpandedItems((prev) =>
      prev.includes(name)
        ? prev.filter((item) => item !== name)
        : [...prev, name]
    );
  };

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed top-0 left-0 z-50 h-full w-64 bg-gray-950 border-r border-gray-800 flex flex-col transition-transform lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-gray-800">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
              <UbiIcon size={22} variant="white" />
            </div>
            <span className="font-bold text-white">UBI Fleet</span>
          </Link>
          <button
            onClick={onClose}
            className="lg:hidden text-gray-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Fleet Status */}
        <div className="p-4 border-b border-gray-800">
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="p-2 bg-gray-900 rounded-lg">
              <p className="text-lg font-bold text-green-500">156</p>
              <p className="text-xs text-gray-500">Online</p>
            </div>
            <div className="p-2 bg-gray-900 rounded-lg">
              <p className="text-lg font-bold text-white">342</p>
              <p className="text-xs text-gray-500">Total</p>
            </div>
          </div>
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
                        : "text-gray-400 hover:text-white hover:bg-gray-800"
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <item.icon className="w-5 h-5" />
                      {item.name}
                    </span>
                    <ChevronDown
                      className={cn(
                        "w-4 h-4 transition-transform",
                        expandedItems.includes(item.name) && "rotate-180"
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
                              : "text-gray-400 hover:text-white hover:bg-gray-800"
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
                      : "text-gray-400 hover:text-white hover:bg-gray-800"
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
                  : "text-gray-400 hover:text-white hover:bg-gray-800"
              )}
            >
              <item.icon className="w-5 h-5" />
              {item.name}
            </Link>
          ))}
        </nav>

        {/* Fleet owner info */}
        <div className="p-4 border-t border-gray-800">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-900">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white font-bold">
              EF
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                Elite Fleet Ltd
              </p>
              <p className="text-xs text-gray-500 truncate">Lagos, Nigeria</p>
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

interface FleetHeaderProps {
  onMenuClick: () => void;
  title?: string;
}

export function FleetHeader({ onMenuClick, title }: FleetHeaderProps) {
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
            placeholder="Search drivers, vehicles..."
            className="w-64 px-4 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>

        {/* Notifications */}
        <button className="relative text-gray-400 hover:text-white transition">
          <Bell className="w-6 h-6" />
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
            3
          </span>
        </button>
      </div>
    </header>
  );
}
