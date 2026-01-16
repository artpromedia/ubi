"use client";

import { cn } from "@/lib/utils";
import { LogoIcon } from "@ubi/ui";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  Bell,
  Building,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  FileText,
  HelpCircle,
  Home,
  LogOut,
  MapPin,
  Menu,
  Package,
  Search,
  Settings,
  Truck,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// Navigation items
const navigation = [
  {
    name: "Dashboard",
    href: "/dashboard",
    icon: Home,
    badge: null,
  },
  {
    name: "Deliveries",
    href: "/deliveries",
    icon: Package,
    badge: 12,
    children: [
      { name: "Active", href: "/deliveries/active" },
      { name: "Scheduled", href: "/deliveries/scheduled" },
      { name: "History", href: "/deliveries/history" },
    ],
  },
  {
    name: "Tracking",
    href: "/tracking",
    icon: MapPin,
    badge: null,
  },
  {
    name: "Pickups",
    href: "/pickups",
    icon: Truck,
    badge: 3,
    children: [
      { name: "Pending", href: "/pickups/pending" },
      { name: "Scheduled", href: "/pickups/scheduled" },
      { name: "Request Pickup", href: "/pickups/request" },
    ],
  },
  {
    name: "Payouts",
    href: "/payouts",
    icon: DollarSign,
    badge: null,
    children: [
      { name: "Overview", href: "/payouts" },
      { name: "Transactions", href: "/payouts/transactions" },
      { name: "Invoices", href: "/payouts/invoices" },
    ],
  },
  {
    name: "Analytics",
    href: "/analytics",
    icon: BarChart3,
    badge: null,
  },
];

const bottomNavigation = [
  {
    name: "API & Integrations",
    href: "/integrations",
    icon: FileText,
  },
  {
    name: "Business Profile",
    href: "/profile",
    icon: Building,
  },
  {
    name: "Settings",
    href: "/settings",
    icon: Settings,
  },
  {
    name: "Help Center",
    href: "/help",
    icon: HelpCircle,
  },
];

// Sidebar component
export function Sidebar() {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);

  // Expand parent items when child is active
  useEffect(() => {
    navigation.forEach((item) => {
      if (
        item.children?.some((child) => pathname.startsWith(child.href)) &&
        !expandedItems.includes(item.name)
      ) {
        setExpandedItems((prev) => [...prev, item.name]);
      }
    });
  }, [pathname]);

  const toggleExpanded = (name: string) => {
    setExpandedItems((prev) =>
      prev.includes(name) ? prev.filter((i) => i !== name) : [...prev, name]
    );
  };

  return (
    <aside
      className={cn(
        "h-screen bg-card border-r border-border flex flex-col transition-all duration-300 sticky top-0",
        isCollapsed ? "w-[72px]" : "w-64"
      )}
    >
      {/* Logo */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-border">
        {!isCollapsed && (
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-cyan-500 to-cyan-600 rounded-lg flex items-center justify-center">
              <LogoIcon className="h-5 w-5 text-white" />
            </div>
            <span className="text-lg font-bold text-white">UBI Send</span>
          </Link>
        )}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-2 hover:bg-surface rounded-lg text-gray-400 hover:text-white transition-colors"
        >
          {isCollapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Quick Action */}
      {!isCollapsed && (
        <div className="p-4 border-b border-border">
          <Link
            href="/deliveries/new"
            className="flex items-center justify-center gap-2 px-4 py-3 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg font-medium transition-colors"
          >
            <Package className="w-4 h-4" />
            Create Shipment
          </Link>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 p-3 overflow-y-auto">
        <ul className="space-y-1">
          {navigation.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");
            const isExpanded = expandedItems.includes(item.name);
            const hasChildren = item.children && item.children.length > 0;

            return (
              <li key={item.name}>
                <Link
                  href={hasChildren ? "#" : item.href}
                  onClick={(e) => {
                    if (hasChildren) {
                      e.preventDefault();
                      toggleExpanded(item.name);
                    }
                  }}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors group",
                    isActive
                      ? "bg-cyan-500/10 text-cyan-500"
                      : "text-gray-400 hover:bg-surface hover:text-white"
                  )}
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" />
                  {!isCollapsed && (
                    <>
                      <span className="flex-1 text-sm font-medium">
                        {item.name}
                      </span>
                      {item.badge && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-cyan-500 text-white rounded-full">
                          {item.badge}
                        </span>
                      )}
                      {hasChildren && (
                        <ChevronRight
                          className={cn(
                            "w-4 h-4 transition-transform",
                            isExpanded && "rotate-90"
                          )}
                        />
                      )}
                    </>
                  )}
                </Link>

                {/* Children */}
                {hasChildren && !isCollapsed && (
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.ul
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="ml-4 mt-1 space-y-1 overflow-hidden"
                      >
                        {item.children?.map((child) => {
                          const isChildActive = pathname === child.href;
                          return (
                            <li key={child.href}>
                              <Link
                                href={child.href}
                                className={cn(
                                  "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
                                  isChildActive
                                    ? "text-cyan-500 bg-cyan-500/5"
                                    : "text-gray-500 hover:text-gray-300 hover:bg-surface"
                                )}
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                                {child.name}
                              </Link>
                            </li>
                          );
                        })}
                      </motion.ul>
                    )}
                  </AnimatePresence>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Bottom Navigation */}
      <div className="p-3 border-t border-border">
        <ul className="space-y-1">
          {bottomNavigation.map((item) => {
            const isActive = pathname === item.href;
            return (
              <li key={item.name}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                    isActive
                      ? "bg-cyan-500/10 text-cyan-500"
                      : "text-gray-500 hover:bg-surface hover:text-white"
                  )}
                >
                  <item.icon className="w-4 h-4 flex-shrink-0" />
                  {!isCollapsed && <span className="text-sm">{item.name}</span>}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Business Account Info */}
        {!isCollapsed && (
          <div className="mt-4 p-3 bg-surface rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-cyan-600 rounded-lg flex items-center justify-center text-white font-semibold">
                JF
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  Jumia Fashion
                </p>
                <p className="text-xs text-gray-500">Business Account</p>
              </div>
              <button className="p-1.5 hover:bg-border rounded-lg text-gray-400 hover:text-white transition-colors">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

// Header component
export function MerchantHeader() {
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  return (
    <header className="h-16 bg-card border-b border-border flex items-center justify-between px-6 sticky top-0 z-40">
      <div className="flex items-center gap-4 flex-1">
        {/* Mobile menu button */}
        <button className="lg:hidden p-2 hover:bg-surface rounded-lg text-gray-400 hover:text-white">
          <Menu className="w-5 h-5" />
        </button>

        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search by tracking number or order ID..."
            className="w-full pl-10 pr-4 py-2 bg-surface border border-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Pending Pickups */}
        <Link
          href="/pickups/pending"
          className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-cyan-500/10 text-cyan-500 rounded-lg text-sm"
        >
          <Truck className="w-4 h-4" />
          <span className="font-medium">3 Pickups</span>
        </Link>

        {/* Notifications */}
        <button className="relative p-2 hover:bg-surface rounded-lg text-gray-400 hover:text-white transition-colors">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-cyan-500 rounded-full" />
        </button>

        {/* Profile */}
        <button className="flex items-center gap-2 p-1.5 hover:bg-surface rounded-lg transition-colors">
          <div className="w-8 h-8 bg-gradient-to-br from-cyan-500 to-cyan-600 rounded-lg flex items-center justify-center text-white text-sm font-medium">
            JF
          </div>
        </button>
      </div>
    </header>
  );
}

// Mobile sidebar drawer
export function MobileSidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="lg:hidden fixed bottom-4 right-4 p-4 bg-cyan-500 text-white rounded-full shadow-lg z-50"
      >
        <Menu className="w-6 h-6" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-black/50 z-50 lg:hidden"
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              className="fixed left-0 top-0 h-full w-64 bg-card border-r border-border z-50 lg:hidden overflow-y-auto"
            >
              <div className="h-16 flex items-center justify-between px-4 border-b border-border">
                <Link href="/dashboard" className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-gradient-to-br from-cyan-500 to-cyan-600 rounded-lg flex items-center justify-center">
                    <LogoIcon className="h-5 w-5 text-white" />
                  </div>
                  <span className="text-lg font-bold text-white">UBI Send</span>
                </Link>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2 hover:bg-surface rounded-lg text-gray-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Mobile navigation content would go here */}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
