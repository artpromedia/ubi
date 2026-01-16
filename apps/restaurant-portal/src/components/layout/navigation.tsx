"use client";

import { cn } from "@/lib/utils";
import { LogoIcon } from "@ubi/ui";
import { motion } from "framer-motion";
import {
  BarChart3,
  Bell,
  ChevronDown,
  ClipboardList,
  Clock,
  DollarSign,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Star,
  Store,
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
    name: "Orders",
    href: "/orders",
    icon: ClipboardList,
    badge: 12, // Live order count
  },
  {
    name: "Menu",
    href: "/menu",
    icon: UtensilsCrossed,
    children: [
      { name: "All Items", href: "/menu" },
      { name: "Categories", href: "/menu/categories" },
      { name: "Modifiers", href: "/menu/modifiers" },
    ],
  },
  {
    name: "Payouts",
    href: "/payouts",
    icon: DollarSign,
  },
  {
    name: "Reviews",
    href: "/reviews",
    icon: Star,
  },
  {
    name: "Analytics",
    href: "/analytics",
    icon: BarChart3,
  },
  {
    name: "Store Hours",
    href: "/hours",
    icon: Clock,
  },
  {
    name: "Store Profile",
    href: "/profile",
    icon: Store,
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
        : [...prev, name]
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
          "fixed top-0 left-0 z-50 h-full w-64 bg-gray-950 border-r border-gray-800 flex flex-col transition-transform lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Header */}
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

        {/* Restaurant Status */}
        <div className="p-4 border-b border-gray-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              <span className="text-sm text-green-500">Store Open</span>
            </div>
            <button className="text-xs text-gray-400 hover:text-white">
              Change
            </button>
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
                        ? "bg-orange-500/10 text-orange-500"
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
                              ? "bg-orange-500/10 text-orange-500"
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
                    "flex items-center justify-between px-3 py-2 rounded-lg text-sm transition",
                    isActive(item.href)
                      ? "bg-orange-500/10 text-orange-500"
                      : "text-gray-400 hover:text-white hover:bg-gray-800"
                  )}
                >
                  <span className="flex items-center gap-3">
                    <item.icon className="w-5 h-5" />
                    {item.name}
                  </span>
                  {item.badge && (
                    <span className="px-2 py-0.5 bg-orange-500 text-white text-xs font-medium rounded-full">
                      {item.badge}
                    </span>
                  )}
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
                  ? "bg-orange-500/10 text-orange-500"
                  : "text-gray-400 hover:text-white hover:bg-gray-800"
              )}
            >
              <item.icon className="w-5 h-5" />
              {item.name}
            </Link>
          ))}
        </nav>

        {/* Restaurant info */}
        <div className="p-4 border-t border-gray-800">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-900">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center text-white font-bold">
              MB
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                Mama's Bistro
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
        {/* Notifications */}
        <button className="relative text-gray-400 hover:text-white transition">
          <Bell className="w-6 h-6" />
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-orange-500 text-white text-xs rounded-full flex items-center justify-center">
            5
          </span>
        </button>

        {/* New Order Alert */}
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-orange-500/20 border border-orange-500/30 rounded-full">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
          </span>
          <span className="text-sm text-orange-500 font-medium">
            12 active orders
          </span>
        </div>
      </div>
    </header>
  );
}
