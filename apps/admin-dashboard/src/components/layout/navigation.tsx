"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  Car,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  FileCheck,
  Gavel,
  HelpCircle,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Package,
  Plane,
  Settings,
  Shield,
  ShieldCheck,
  Users,
  UtensilsCrossed,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type FormEvent } from "react";

import { LogoIcon } from "@ubi/ui";

import { formatAdminRole, type PublicAdminSession } from "@/lib/session";
import { cn } from "@/lib/utils";

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
      { name: "Ops Wallet Credits", href: "/payments/ops-credits" },
    ],
  },
  {
    name: "Verification",
    href: "/verification",
    icon: FileCheck,
    children: [
      { name: "Document Review", href: "/verification" },
      { name: "Fleets & KYB", href: "/fleets" },
      { name: "Background Checks", href: "/verification/background" },
      { name: "Liveness Checks", href: "/verification/liveness" },
    ],
  },
  {
    name: "Marketplace",
    href: "/marketplace",
    icon: Gavel,
    children: [
      { name: "Live Requests", href: "/marketplace" },
      { name: "Policies", href: "/marketplace/policies" },
      { name: "Operations", href: "/marketplace/operations" },
      { name: "Cases", href: "/marketplace/cases" },
      { name: "Standing & Appeals", href: "/marketplace/standing" },
      { name: "Notifications", href: "/marketplace/notifications" },
    ],
  },
  {
    name: "Ops",
    href: "/ops/travel",
    icon: Plane,
    children: [
      { name: "Travel", href: "/ops/travel" },
      { name: "AI actions", href: "/ops/ai-actions" },
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

function operatorDisplayName(session?: PublicAdminSession | null): string {
  if (!session) {
    return "Operator";
  }
  const full =
    `${session.user.firstName} ${session.user.lastName}`.trim() ||
    session.user.phone;
  return full;
}

function operatorInitials(session?: PublicAdminSession | null): string {
  if (!session) {
    return "OP";
  }
  const first = session.user.firstName.trim().charAt(0);
  const last = session.user.lastName.trim().charAt(0);
  const combined = `${first}${last}`.toUpperCase();
  return combined.length > 0 ? combined : "OP";
}

interface SidebarProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly session?: PublicAdminSession | null;
  readonly onSignOut?: () => Promise<void> | void;
}

export const Sidebar = ({
  isOpen,
  onClose,
  session,
  onSignOut,
}: Readonly<SidebarProps>) => {
  const pathname = usePathname() ?? "";
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const isLimited = session?.mode === "limited";

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
          "fixed top-0 left-0 z-50 h-full w-72 bg-gray-950 border-r border-gray-800 flex flex-col transition-transform lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between h-16 px-4 border-b border-gray-800">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
              <LogoIcon className="h-5 w-5 text-white" />
            </div>
            <span className="font-bold text-white">UBI Admin</span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation menu"
            className="lg:hidden text-gray-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation: hidden in limited mode so zero console actions appear before device step-up */}
        {isLimited ? (
          <div
            className="flex-1 p-4 text-xs text-amber-300/90"
            data-testid="sidebar.limited-notice"
          >
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <p className="font-medium text-amber-200">Device unverified</p>
              <p className="mt-1 text-gray-400">
                Complete device verification to unlock operator navigation and
                tools.
              </p>
            </div>
          </div>
        ) : (
          <nav className="flex-1 overflow-y-auto p-4 space-y-1">
            {navigation.map((item) => (
              <div key={item.name}>
                {item.children ? (
                  <>
                    <button
                      type="button"
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

            <div className="!my-4 border-t border-gray-800" />

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
        )}

        {/* Signed-in operator identity + real sign-out */}
        <div className="p-4 border-t border-gray-800">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-900">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
              <span className="text-white text-sm font-medium">
                {operatorInitials(session)}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p
                className="text-sm font-medium text-white truncate"
                data-testid="sidebar.operator-name"
              >
                {operatorDisplayName(session)}
              </p>
              <p
                className="text-xs text-gray-500 truncate"
                data-testid="sidebar.operator-role"
              >
                {session
                  ? `${formatAdminRole(session.user.role)}${isLimited ? " · Unverified device" : ""}`
                  : "Signed in"}
              </p>
            </div>
            {onSignOut ? (
              <button
                type="button"
                aria-label="Sign out"
                title="Sign out"
                data-testid="sidebar.signout"
                onClick={() => {
                  void onSignOut();
                }}
                className="text-gray-400 hover:text-white transition"
              >
                <LogOut className="w-5 h-5" />
              </button>
            ) : null}
          </div>
        </div>
      </aside>
    </>
  );
};

interface AdminHeaderProps {
  readonly onMenuClick: () => void;
  readonly title?: string;
  readonly session?: PublicAdminSession | null;
}

export const AdminHeader = ({
  onMenuClick,
  title,
  session,
}: Readonly<AdminHeaderProps>) => {
  const isLimited = session?.mode === "limited";
  const [approveOpen, setApproveOpen] = useState(false);
  const [challengeId, setChallengeId] = useState("");
  const [approving, setApproving] = useState(false);
  const [approveNotice, setApproveNotice] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);

  const handleApproveDevice = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setApproveError(null);
    setApproveNotice(null);
    const trimmed = challengeId.trim();
    if (!trimmed) {
      setApproveError("Enter the challenge ID shown on your new device.");
      return;
    }

    setApproving(true);
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
          payload.error?.message ?? "Could not approve that device challenge.",
        );
        return;
      }
      setApproveNotice("Device approved. Continue on the new browser.");
      setChallengeId("");
    } catch {
      setApproveError("Network error while approving device challenge.");
    } finally {
      setApproving(false);
    }
  };

  return (
    <header className="sticky top-0 z-30 h-16 bg-gray-950/80 backdrop-blur-sm border-b border-gray-800 flex items-center px-4 lg:px-6">
      <button
        type="button"
        aria-label="Open navigation menu"
        onClick={onMenuClick}
        className="lg:hidden text-gray-400 hover:text-white mr-4"
      >
        <Menu className="w-6 h-6" />
      </button>

      {title ? (
        <h1 className="text-lg font-semibold text-white">{title}</h1>
      ) : null}

      {!isLimited ? (
        <div className="ml-auto flex items-center gap-3 relative">
          <div className="hidden md:block">
            <input
              type="search"
              placeholder="Search..."
              className="w-64 px-4 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>

          {session?.mode === "full" ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setApproveOpen((prev) => !prev);
                  setApproveError(null);
                  setApproveNotice(null);
                }}
                data-testid="header.approve-device-toggle"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-900 hover:bg-gray-800 border border-gray-800 text-xs text-gray-300 transition"
              >
                <ShieldCheck className="w-4 h-4 text-green-400" />
                <span>Approve device</span>
              </button>

              {approveOpen ? (
                <form
                  onSubmit={(e) => {
                    void handleApproveDevice(e);
                  }}
                  className="absolute right-0 mt-2 w-80 rounded-xl bg-gray-900 border border-gray-800 p-4 shadow-xl space-y-3 z-50"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">
                      Approve a new browser
                    </span>
                    <button
                      type="button"
                      onClick={() => setApproveOpen(false)}
                      className="text-gray-500 hover:text-gray-300"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <input
                    type="text"
                    value={challengeId}
                    onChange={(e) => setChallengeId(e.target.value)}
                    placeholder="Paste challenge ID"
                    className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-xs text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  {approveError ? (
                    <p className="text-xs text-red-400">{approveError}</p>
                  ) : null}
                  {approveNotice ? (
                    <p className="text-xs text-green-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {approveNotice}
                    </p>
                  ) : null}
                  <button
                    type="submit"
                    disabled={approving}
                    className="w-full py-2 px-3 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-xs font-medium text-white flex items-center justify-center gap-1.5"
                  >
                    {approving ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Approving…
                      </>
                    ) : (
                      "Approve challenge"
                    )}
                  </button>
                </form>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
};
