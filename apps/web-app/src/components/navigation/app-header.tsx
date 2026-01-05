/**
 * App Header
 *
 * Top navigation bar with user menu and notifications.
 */

"use client";

import { ROUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useTheme } from "@/providers";
import { useAuthStore, useUIStore, useUserStore } from "@/store";
import { Button, UbiLogo } from "@ubi/ui";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  Gift,
  Heart,
  HelpCircle,
  LogOut,
  MapPin,
  Menu,
  Moon,
  Settings,
  Sun,
  User,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface AppHeaderProps {
  className?: string;
  showMenu?: boolean;
}

export function AppHeader({ className, showMenu = true }: AppHeaderProps) {
  const router = useRouter();
  const { isAuthenticated, clearAuth } = useAuthStore();
  const { profile, clearUser } = useUserStore();
  const { toggleSidebar } = useUIStore();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  const handleLogout = () => {
    clearAuth();
    clearUser();
    router.push(ROUTES.login);
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-50 flex h-14 items-center justify-between border-b border-gray-200 bg-white/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:border-gray-800 dark:bg-gray-900/95 dark:supports-[backdrop-filter]:bg-gray-900/60",
        className
      )}
    >
      {/* Left section */}
      <div className="flex items-center gap-3">
        {showMenu && (
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            className="lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </Button>
        )}
        <Link href={ROUTES.home} className="flex items-center">
          <UbiLogo size={24} className="dark:hidden" />
          <UbiLogo size={24} variant="white" className="hidden dark:block" />
        </Link>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-2">
        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          {resolvedTheme === "dark" ? (
            <Sun className="h-5 w-5" />
          ) : (
            <Moon className="h-5 w-5" />
          )}
        </Button>

        {isAuthenticated ? (
          <>
            {/* Notifications */}
            <div className="relative">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowNotifications(!showNotifications)}
              >
                <Bell className="h-5 w-5" />
                <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-ubi-bites" />
              </Button>

              <AnimatePresence>
                {showNotifications && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute right-0 top-full mt-2 w-80 rounded-lg border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-700 dark:bg-gray-800"
                  >
                    <h3 className="mb-3 font-semibold">Notifications</h3>
                    <p className="text-sm text-gray-500">
                      No new notifications
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* User menu */}
            <div className="relative">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="rounded-full"
              >
                {profile?.avatarUrl ? (
                  <img
                    src={profile.avatarUrl}
                    alt={profile.firstName}
                    className="h-8 w-8 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700">
                    <User className="h-4 w-4" />
                  </div>
                )}
              </Button>

              <AnimatePresence>
                {showUserMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowUserMenu(false)}
                    />
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-gray-200 bg-white py-2 shadow-lg dark:border-gray-700 dark:bg-gray-800"
                    >
                      {/* User info */}
                      <div className="border-b border-gray-200 px-4 pb-3 dark:border-gray-700">
                        <p className="font-semibold">
                          {profile?.firstName} {profile?.lastName}
                        </p>
                        <p className="text-sm text-gray-500">
                          {profile?.email}
                        </p>
                      </div>

                      {/* Menu items */}
                      <nav className="py-2">
                        <MenuLink href={ROUTES.profile} icon={User}>
                          Profile
                        </MenuLink>
                        <MenuLink href={ROUTES.wallet} icon={Wallet}>
                          Wallet
                        </MenuLink>
                        <MenuLink href={ROUTES.addresses} icon={MapPin}>
                          Saved Places
                        </MenuLink>
                        <MenuLink href={ROUTES.history} icon={Heart}>
                          Trip History
                        </MenuLink>
                        <MenuLink href={ROUTES.promotions} icon={Gift}>
                          Promotions
                        </MenuLink>
                        <MenuLink href={ROUTES.settings} icon={Settings}>
                          Settings
                        </MenuLink>
                        <MenuLink href={ROUTES.help} icon={HelpCircle}>
                          Help & Support
                        </MenuLink>
                      </nav>

                      {/* Logout */}
                      <div className="border-t border-gray-200 pt-2 dark:border-gray-700">
                        <button
                          onClick={handleLogout}
                          className="flex w-full items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          <LogOut className="h-4 w-4" />
                          Log out
                        </button>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link href={ROUTES.login}>Log in</Link>
            </Button>
            <Button asChild>
              <Link href={ROUTES.signup}>Sign up</Link>
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}

interface MenuLinkProps {
  href: string;
  icon: typeof User;
  children: React.ReactNode;
}

function MenuLink({ href, icon: Icon, children }: MenuLinkProps) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
    >
      <Icon className="h-4 w-4" />
      {children}
    </Link>
  );
}
