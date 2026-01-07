/**
 * Home Page
 *
 * Main dashboard showing active service tab content.
 */

"use client";

import { RideBookingCard, ServiceTabs } from "@/components";
import { useUIStore } from "@/store";
import { AnimatePresence, motion } from "framer-motion";
import { Clock, MapPin, Package, Search, Star, Utensils } from "lucide-react";

// Sample restaurant data for Bites tab
const featuredRestaurants = [
  { id: 1, name: "Mama's Kitchen", cuisine: "Nigerian", rating: 4.8, deliveryTime: "25-35 min", image: "🍛" },
  { id: 2, name: "Java House", cuisine: "Coffee & Breakfast", rating: 4.6, deliveryTime: "20-30 min", image: "☕" },
  { id: 3, name: "Kilimanjaro", cuisine: "East African", rating: 4.7, deliveryTime: "30-40 min", image: "🥘" },
];

// Sample categories for Bites tab
const foodCategories = [
  { id: 1, name: "Fast Food", icon: "🍔" },
  { id: 2, name: "African", icon: "🍛" },
  { id: 3, name: "Asian", icon: "🍜" },
  { id: 4, name: "Desserts", icon: "🍰" },
  { id: 5, name: "Drinks", icon: "🥤" },
];

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
                className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
              >
                <h2 className="mb-4 text-lg font-semibold">What&apos;s for dinner?</h2>

                {/* Search bar */}
                <div className="relative mb-4">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search restaurants or dishes"
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2.5 pl-10 pr-4 text-sm focus:border-ubi-bites focus:outline-none focus:ring-1 focus:ring-ubi-bites dark:border-gray-700 dark:bg-gray-900"
                  />
                </div>

                {/* Food categories */}
                <div className="mb-4 flex gap-2 overflow-x-auto pb-2">
                  {foodCategories.map((category) => (
                    <button
                      key={category.id}
                      className="flex shrink-0 flex-col items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-3 transition-colors hover:border-ubi-bites hover:bg-ubi-bites/5 dark:border-gray-700 dark:bg-gray-900"
                    >
                      <span className="text-xl">{category.icon}</span>
                      <span className="text-xs font-medium">{category.name}</span>
                    </button>
                  ))}
                </div>

                {/* Featured restaurants */}
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Utensils className="h-4 w-4 text-ubi-bites" />
                  Popular near you
                </h3>
                <div className="space-y-3">
                  {featuredRestaurants.map((restaurant) => (
                    <button
                      key={restaurant.id}
                      className="flex w-full items-center gap-3 rounded-lg border border-gray-200 p-3 text-left transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
                    >
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-ubi-bites/10 text-2xl">
                        {restaurant.image}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">{restaurant.name}</p>
                        <p className="text-sm text-gray-500">{restaurant.cuisine}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="flex items-center gap-1 text-sm">
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                          {restaurant.rating}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                          <Clock className="h-3 w-3" />
                          {restaurant.deliveryTime}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === "send" && (
              <motion.div
                key="send"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
              >
                <h2 className="mb-4 text-lg font-semibold">Send a package</h2>

                {/* Delivery type selector */}
                <div className="mb-4 grid grid-cols-2 gap-3">
                  <button className="flex flex-col items-center gap-2 rounded-lg border-2 border-ubi-send bg-ubi-send/5 p-4 text-center">
                    <Package className="h-6 w-6 text-ubi-send" />
                    <span className="text-sm font-medium">Standard</span>
                    <span className="text-xs text-gray-500">Same day delivery</span>
                  </button>
                  <button className="flex flex-col items-center gap-2 rounded-lg border border-gray-200 p-4 text-center hover:border-ubi-send hover:bg-ubi-send/5 dark:border-gray-700">
                    <Package className="h-6 w-6 text-gray-400" />
                    <span className="text-sm font-medium">Express</span>
                    <span className="text-xs text-gray-500">1-2 hour delivery</span>
                  </button>
                </div>

                {/* Pickup location */}
                <div className="mb-3">
                  <label className="mb-1.5 block text-sm font-medium">Pickup from</label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ubi-send" />
                    <input
                      type="text"
                      placeholder="Enter pickup address"
                      className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2.5 pl-10 pr-4 text-sm focus:border-ubi-send focus:outline-none focus:ring-1 focus:ring-ubi-send dark:border-gray-700 dark:bg-gray-900"
                    />
                  </div>
                </div>

                {/* Dropoff location */}
                <div className="mb-4">
                  <label className="mb-1.5 block text-sm font-medium">Deliver to</label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ubi-bites" />
                    <input
                      type="text"
                      placeholder="Enter delivery address"
                      className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2.5 pl-10 pr-4 text-sm focus:border-ubi-send focus:outline-none focus:ring-1 focus:ring-ubi-send dark:border-gray-700 dark:bg-gray-900"
                    />
                  </div>
                </div>

                {/* Package details */}
                <div className="mb-4 rounded-lg bg-gray-50 p-3 dark:bg-gray-900">
                  <h3 className="mb-2 text-sm font-medium">Package details</h3>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <button className="rounded-lg border border-gray-200 bg-white p-2 text-xs hover:border-ubi-send dark:border-gray-700 dark:bg-gray-800">
                      <span className="block text-lg">📦</span>
                      Small
                    </button>
                    <button className="rounded-lg border-2 border-ubi-send bg-ubi-send/5 p-2 text-xs">
                      <span className="block text-lg">📦</span>
                      Medium
                    </button>
                    <button className="rounded-lg border border-gray-200 bg-white p-2 text-xs hover:border-ubi-send dark:border-gray-700 dark:bg-gray-800">
                      <span className="block text-lg">📦</span>
                      Large
                    </button>
                  </div>
                </div>

                {/* Submit button */}
                <button className="w-full rounded-lg bg-ubi-send py-3 font-medium text-white hover:bg-ubi-send/90">
                  Get delivery quote
                </button>
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
              <div className="absolute inset-0 opacity-20" style={{
                backgroundImage: `linear-gradient(to right, #10b981 1px, transparent 1px), linear-gradient(to bottom, #10b981 1px, transparent 1px)`,
                backgroundSize: '40px 40px'
              }} />

              {/* Simulated roads */}
              <svg className="absolute inset-0 h-full w-full opacity-30" viewBox="0 0 400 400" preserveAspectRatio="none">
                <path d="M0,200 Q100,180 200,200 T400,180" stroke="#374151" strokeWidth="8" fill="none" />
                <path d="M200,0 Q180,100 200,200 T220,400" stroke="#374151" strokeWidth="6" fill="none" />
                <path d="M50,100 Q150,120 250,80 T400,100" stroke="#6b7280" strokeWidth="4" fill="none" />
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
              <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
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
                  <p className="text-sm font-medium truncate">Nairobi, Kenya</p>
                  <p className="text-xs text-gray-500">Westlands • 3 drivers nearby</p>
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
