/**
 * Home Page
 *
 * Main dashboard showing active service tab content.
 */

"use client";

import { RideBookingCard, ServiceTabs } from "@/components";
import { useUIStore } from "@/store";
import { AnimatePresence, motion } from "framer-motion";
import { MapPin, Package, Utensils } from "lucide-react";

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
                className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center dark:border-gray-600 dark:bg-gray-800"
              >
                <Utensils className="mx-auto mb-3 h-8 w-8 text-gray-400" />
                <h2 className="mb-1.5 text-lg font-semibold">
                  Bites isn&apos;t on here yet
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Food delivery is being introduced city by city. This card
                  changes the day it&apos;s switched on for you — we don&apos;t
                  take orders or sign-ups for it before then.
                </p>
              </motion.div>
            )}

            {activeTab === "send" && (
              <motion.div
                key="send"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center dark:border-gray-600 dark:bg-gray-800"
              >
                <Package className="mx-auto mb-3 h-8 w-8 text-gray-400" />
                <h2 className="mb-1.5 text-lg font-semibold">
                  Send isn&apos;t on here yet
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Package delivery is being introduced city by city. This card
                  changes the day it&apos;s switched on for you — we don&apos;t
                  take orders or sign-ups for it before then.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right panel - Map */}
        <div className="order-1 lg:order-2">
          <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-gradient-to-br from-green-50 to-emerald-100 dark:from-gray-800 dark:to-gray-900 lg:aspect-auto lg:h-[600px]">
            {/* Stylized map background */}
            <div className="absolute inset-0">
              {/* Grid pattern */}
              <div
                className="absolute inset-0 opacity-20"
                style={{
                  backgroundImage: `linear-gradient(to right, #10b981 1px, transparent 1px), linear-gradient(to bottom, #10b981 1px, transparent 1px)`,
                  backgroundSize: "40px 40px",
                }}
              />

              {/* Simulated roads */}
              <svg
                className="absolute inset-0 h-full w-full opacity-30"
                viewBox="0 0 400 400"
                preserveAspectRatio="none"
              >
                <path
                  d="M0,200 Q100,180 200,200 T400,180"
                  stroke="#374151"
                  strokeWidth="8"
                  fill="none"
                />
                <path
                  d="M200,0 Q180,100 200,200 T220,400"
                  stroke="#374151"
                  strokeWidth="6"
                  fill="none"
                />
                <path
                  d="M50,100 Q150,120 250,80 T400,100"
                  stroke="#6b7280"
                  strokeWidth="4"
                  fill="none"
                />
              </svg>

              {/* Location markers */}
              <div className="absolute left-[30%] top-[40%] flex flex-col items-center">
                <div className="h-8 w-8 animate-bounce rounded-full bg-ubi-green shadow-lg flex items-center justify-center">
                  <div className="h-3 w-3 rounded-full bg-white" />
                </div>
                <div className="mt-1 h-2 w-2 rounded-full bg-ubi-green/50" />
              </div>

              <div className="absolute left-[60%] top-[55%] flex flex-col items-center">
                <div className="h-6 w-6 rounded-full bg-ubi-bites shadow-lg flex items-center justify-center">
                  <div className="h-2 w-2 rounded-full bg-white" />
                </div>
              </div>

              <div className="absolute left-[45%] top-[30%] flex flex-col items-center">
                <div className="h-5 w-5 rounded-full bg-ubi-send shadow flex items-center justify-center">
                  <div className="h-1.5 w-1.5 rounded-full bg-white" />
                </div>
              </div>

              {/* Route line */}
              <svg
                className="absolute inset-0 h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <path
                  d="M30,40 Q40,35 45,30 Q50,35 60,55"
                  stroke="#1db954"
                  strokeWidth="0.5"
                  strokeDasharray="2,2"
                  fill="none"
                  className="animate-pulse"
                />
              </svg>
            </div>

            {/* Location info overlay */}
            <div className="absolute bottom-4 left-4 right-4 rounded-lg bg-white/90 p-3 backdrop-blur-sm dark:bg-gray-900/90">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ubi-green/10">
                  <MapPin className="h-5 w-5 text-ubi-green" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    Set your pickup location
                  </p>
                  <p className="text-xs text-gray-500">
                    Nearby drivers are shown once you request a ride
                  </p>
                </div>
                <button className="shrink-0 rounded-full bg-ubi-green px-3 py-1.5 text-xs font-medium text-white hover:bg-ubi-green/90">
                  Locate me
                </button>
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
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Your recent places will appear here after your first ride.
          </p>
        </div>

        {/* Promotions */}
        <div className="rounded-lg border border-gray-200 bg-gradient-to-br from-ubi-green to-green-600 p-4 text-white dark:border-gray-700">
          <h3 className="mb-2 font-semibold">Offers</h3>
          <p className="text-sm text-white/80">
            Any offer you&apos;re eligible for is shown here with its terms — we
            don&apos;t advertise a promo code before you&apos;re signed in.
          </p>
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

function QuickAction({ icon, label }: { icon: string; label: string }) {
  return (
    <button className="flex flex-col items-center gap-1 rounded-lg p-3 hover:bg-gray-50 dark:hover:bg-gray-700">
      <span className="text-2xl">{icon}</span>
      <span className="text-xs">{label}</span>
    </button>
  );
}
