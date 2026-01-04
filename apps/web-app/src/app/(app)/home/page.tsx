/**
 * Home Page
 *
 * Main dashboard showing active service tab content.
 */

"use client";

import { RideBookingCard, ServiceTabs } from "@/components";
import { useUIStore } from "@/store";
import { AnimatePresence, motion } from "framer-motion";

export default function HomePage() {
  const { activeTab } = useUIStore();

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 pb-24 lg:pb-6">
      {/* Desktop service tabs */}
      <div className="mb-6 hidden justify-center lg:flex">
        <ServiceTabs />
      </div>

      {/* Main content area */}
      <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
        {/* Left panel - Booking */}
        <div className="order-2 lg:order-1">
          <AnimatePresence mode="wait">
            {activeTab === "move" && (
              <motion.div
                key="move"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <RideBookingCard />
              </motion.div>
            )}

            {activeTab === "bites" && (
              <motion.div
                key="bites"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
              >
                <h2 className="mb-4 text-lg font-semibold">What&apos;s for dinner?</h2>
                <p className="text-gray-500">
                  Browse restaurants and order your favorite meals.
                </p>
                {/* TODO: Restaurant search and browse component */}
              </motion.div>
            )}

            {activeTab === "send" && (
              <motion.div
                key="send"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
              >
                <h2 className="mb-4 text-lg font-semibold">Send a package</h2>
                <p className="text-gray-500">
                  Fast and reliable package delivery across the city.
                </p>
                {/* TODO: Package delivery booking component */}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right panel - Map */}
        <div className="order-1 lg:order-2">
          <div className="aspect-[4/3] overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800 lg:aspect-auto lg:h-[600px]">
            {/* Map placeholder */}
            <div className="flex h-full items-center justify-center">
              <div className="text-center text-gray-500">
                <div className="mb-2 text-4xl">🗺️</div>
                <p>Map will appear here</p>
                <p className="text-sm">Integrate with Google Maps or Mapbox</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent activity / promotions */}
      <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Recent rides */}
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <h3 className="mb-3 font-semibold">Recent</h3>
          <div className="space-y-3">
            <RecentItem
              icon="🏢"
              title="Work"
              subtitle="123 Business Park, Westlands"
            />
            <RecentItem
              icon="🏠"
              title="Home"
              subtitle="456 Residential Estate, Karen"
            />
            <RecentItem
              icon="☕"
              title="Java House, Sarit"
              subtitle="Westlands Road"
            />
          </div>
        </div>

        {/* Promotions */}
        <div className="rounded-lg border border-gray-200 bg-gradient-to-br from-ubi-green to-green-600 p-4 text-white dark:border-gray-700">
          <h3 className="mb-2 font-semibold">First Ride Free!</h3>
          <p className="mb-3 text-sm text-white/80">
            Use code WELCOME for your first ride up to KES 500 off.
          </p>
          <button className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-ubi-green">
            Apply Code
          </button>
        </div>

        {/* Quick actions */}
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <h3 className="mb-3 font-semibold">Quick Actions</h3>
          <div className="grid grid-cols-3 gap-2">
            <QuickAction icon="🎁" label="Refer" />
            <QuickAction icon="💳" label="Wallet" />
            <QuickAction icon="📜" label="History" />
          </div>
        </div>
      </div>
    </div>
  );
}

function RecentItem({
  icon,
  title,
  subtitle,
}: {
  icon: string;
  title: string;
  subtitle: string;
}) {
  return (
    <button className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700">
      <span className="text-xl">{icon}</span>
      <div className="min-w-0">
        <p className="truncate font-medium">{title}</p>
        <p className="truncate text-sm text-gray-500">{subtitle}</p>
      </div>
    </button>
  );
}

function QuickAction({ icon, label }: { icon: string; label: string }) {
  return (
    <button className="flex flex-col items-center gap-1 rounded-lg p-3 hover:bg-gray-50 dark:hover:bg-gray-700">
      <span className="text-2xl">{icon}</span>
      <span className="text-xs">{label}</span>
    </button>
  );
}
