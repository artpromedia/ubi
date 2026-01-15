/**
 * Hero Section
 */

"use client";

import { motion } from "framer-motion";
import { ArrowRight, Play } from "lucide-react";
import Link from "next/link";

import { Button } from "@ubi/ui";

export const HeroSection = () => {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-gray-50 to-white pt-24 dark:from-gray-900 dark:to-gray-800">
      <div className="mx-auto max-w-7xl px-4 py-16 lg:px-8 lg:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          {/* Content */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <span className="inline-block rounded-full bg-ubi-green/10 px-4 py-1.5 text-sm font-medium text-ubi-green mb-4">
              Now in 6 African countries 🌍
            </span>
            <h1 className="mb-6 text-4xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-5xl lg:text-6xl">
              Your Ride, <span className="text-ubi-green">Your Way</span>
            </h1>
            <p className="mb-8 text-lg text-gray-600 dark:text-gray-300 lg:text-xl">
              Book rides, order food, and send packages across Africa with UBI -
              the mobility super-app designed for you.
            </p>

            {/* CTAs */}
            <div className="flex flex-col gap-4 sm:flex-row">
              <Button
                size="lg"
                asChild
                className="bg-ubi-green hover:bg-ubi-green/90"
              >
                <Link href="https://app.ubi.africa">
                  Get Started
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/about">
                  <Play className="mr-2 h-5 w-5" />
                  Watch Video
                </Link>
              </Button>
            </div>

            {/* Stats */}
            <div className="mt-12 flex gap-8">
              <div>
                <div className="text-3xl font-bold text-gray-900 dark:text-white">
                  10M+
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Active Users
                </div>
              </div>
              <div>
                <div className="text-3xl font-bold text-gray-900 dark:text-white">
                  500K+
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Drivers
                </div>
              </div>
              <div>
                <div className="text-3xl font-bold text-gray-900 dark:text-white">
                  50+
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Cities
                </div>
              </div>
            </div>
          </motion.div>

          {/* Phone mockup */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="relative"
          >
            <div className="relative mx-auto w-[300px] lg:w-[350px]">
              {/* Phone frame */}
              <div className="relative z-10 rounded-[3rem] bg-gray-900 p-3 shadow-2xl">
                {/* Notch */}
                <div className="absolute left-1/2 top-4 z-20 h-6 w-24 -translate-x-1/2 rounded-full bg-gray-900" />
                <div className="overflow-hidden rounded-[2.5rem] bg-gray-100">
                  {/* App screen mockup */}
                  <div className="aspect-[9/19] flex flex-col">
                    {/* Status bar */}
                    <div className="flex items-center justify-between bg-white px-6 py-3 pt-8">
                      <span className="text-xs font-medium text-gray-900">
                        9:41
                      </span>
                      <div className="flex items-center gap-1">
                        <div className="flex gap-0.5">
                          <div className="h-2 w-0.5 rounded-full bg-gray-900" />
                          <div className="h-2.5 w-0.5 rounded-full bg-gray-900" />
                          <div className="h-3 w-0.5 rounded-full bg-gray-900" />
                          <div className="h-3.5 w-0.5 rounded-full bg-gray-900" />
                        </div>
                        <div className="ml-1 h-2.5 w-5 rounded-sm border border-gray-900">
                          <div className="h-full w-3/4 rounded-sm bg-gray-900" />
                        </div>
                      </div>
                    </div>

                    {/* Map area */}
                    <div className="relative flex-1 bg-[#E8F4E8]">
                      {/* Map grid pattern */}
                      <div className="absolute inset-0 opacity-30">
                        <svg
                          className="h-full w-full"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <defs>
                            <pattern
                              id="grid"
                              width="30"
                              height="30"
                              patternUnits="userSpaceOnUse"
                            >
                              <path
                                d="M 30 0 L 0 0 0 30"
                                fill="none"
                                stroke="#9CA3AF"
                                strokeWidth="0.5"
                              />
                            </pattern>
                          </defs>
                          <rect width="100%" height="100%" fill="url(#grid)" />
                        </svg>
                      </div>
                      {/* Roads */}
                      <div className="absolute left-1/4 top-0 h-full w-8 bg-white/60" />
                      <div className="absolute left-0 top-1/3 h-6 w-full bg-white/60" />
                      <div className="absolute left-0 top-2/3 h-4 w-full bg-white/50" />
                      <div className="absolute right-1/4 top-0 h-full w-6 bg-white/50" />

                      {/* User location marker */}
                      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                        <div className="relative">
                          <div className="absolute -inset-3 animate-ping rounded-full bg-ubi-green/30" />
                          <div className="relative h-4 w-4 rounded-full border-2 border-white bg-ubi-green shadow-lg" />
                        </div>
                      </div>

                      {/* Nearby driver cars - Realistic top-down vehicle icons */}
                      <div className="absolute left-[30%] top-[25%] rotate-[140deg]">
                        <svg
                          width="28"
                          height="28"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <ellipse
                            cx="12"
                            cy="12"
                            rx="5"
                            ry="10"
                            fill="#1a1a1a"
                          />
                          <ellipse
                            cx="12"
                            cy="12"
                            rx="4"
                            ry="8.5"
                            fill="#2d2d2d"
                          />
                          <rect
                            x="8"
                            y="4"
                            width="8"
                            height="4"
                            rx="1.5"
                            fill="#4a90d9"
                            opacity="0.8"
                          />
                          <rect
                            x="8"
                            y="16"
                            width="8"
                            height="3"
                            rx="1"
                            fill="#4a90d9"
                            opacity="0.6"
                          />
                          <rect
                            x="6.5"
                            y="7"
                            width="2"
                            height="4"
                            rx="0.5"
                            fill="#1a1a1a"
                          />
                          <rect
                            x="15.5"
                            y="7"
                            width="2"
                            height="4"
                            rx="0.5"
                            fill="#1a1a1a"
                          />
                          <rect
                            x="6.5"
                            y="13"
                            width="2"
                            height="4"
                            rx="0.5"
                            fill="#1a1a1a"
                          />
                          <rect
                            x="15.5"
                            y="13"
                            width="2"
                            height="4"
                            rx="0.5"
                            fill="#1a1a1a"
                          />
                          <circle cx="12" cy="5" r="0.5" fill="#ffcc00" />
                          <circle cx="12" cy="19" r="0.5" fill="#ff3333" />
                        </svg>
                      </div>
                      <div className="absolute right-[25%] top-[40%] rotate-[60deg]">
                        <svg
                          width="26"
                          height="26"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <ellipse
                            cx="12"
                            cy="12"
                            rx="5.5"
                            ry="10.5"
                            fill="#f5f5f5"
                          />
                          <ellipse
                            cx="12"
                            cy="12"
                            rx="4.5"
                            ry="9"
                            fill="#e8e8e8"
                          />
                          <rect
                            x="7.5"
                            y="3.5"
                            width="9"
                            height="4.5"
                            rx="2"
                            fill="#3d7dd4"
                            opacity="0.85"
                          />
                          <rect
                            x="7.5"
                            y="16"
                            width="9"
                            height="3.5"
                            rx="1.5"
                            fill="#3d7dd4"
                            opacity="0.7"
                          />
                          <rect
                            x="6"
                            y="7"
                            width="2.5"
                            height="4.5"
                            rx="0.75"
                            fill="#333"
                          />
                          <rect
                            x="15.5"
                            y="7"
                            width="2.5"
                            height="4.5"
                            rx="0.75"
                            fill="#333"
                          />
                          <rect
                            x="6"
                            y="12.5"
                            width="2.5"
                            height="4.5"
                            rx="0.75"
                            fill="#333"
                          />
                          <rect
                            x="15.5"
                            y="12.5"
                            width="2.5"
                            height="4.5"
                            rx="0.75"
                            fill="#333"
                          />
                          <circle cx="12" cy="4.5" r="0.6" fill="#fff4b3" />
                          <circle cx="12" cy="19.5" r="0.6" fill="#ff6666" />
                        </svg>
                      </div>
                      <div className="absolute left-[20%] bottom-[35%] rotate-[-30deg]">
                        <svg
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <ellipse
                            cx="12"
                            cy="12"
                            rx="5"
                            ry="10"
                            fill="#2c2c2c"
                          />
                          <ellipse
                            cx="12"
                            cy="12"
                            rx="4"
                            ry="8.5"
                            fill="#3a3a3a"
                          />
                          <rect
                            x="8"
                            y="4"
                            width="8"
                            height="4"
                            rx="1.5"
                            fill="#5ba3e0"
                            opacity="0.8"
                          />
                          <rect
                            x="8"
                            y="16"
                            width="8"
                            height="3"
                            rx="1"
                            fill="#5ba3e0"
                            opacity="0.6"
                          />
                          <rect
                            x="6.5"
                            y="7"
                            width="2"
                            height="4"
                            rx="0.5"
                            fill="#1f1f1f"
                          />
                          <rect
                            x="15.5"
                            y="7"
                            width="2"
                            height="4"
                            rx="0.5"
                            fill="#1f1f1f"
                          />
                          <rect
                            x="6.5"
                            y="13"
                            width="2"
                            height="4"
                            rx="0.5"
                            fill="#1f1f1f"
                          />
                          <rect
                            x="15.5"
                            y="13"
                            width="2"
                            height="4"
                            rx="0.5"
                            fill="#1f1f1f"
                          />
                          <circle cx="12" cy="5" r="0.5" fill="#ffe066" />
                          <circle cx="12" cy="19" r="0.5" fill="#ff4444" />
                        </svg>
                      </div>
                    </div>

                    {/* Bottom card */}
                    <div className="bg-white px-4 py-4 shadow-[0_-4px_20px_rgba(0,0,0,0.1)]">
                      {/* Search bar */}
                      <div className="mb-3 rounded-xl bg-gray-100 px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-2 w-2 rounded-full bg-ubi-green" />
                          <span className="text-sm text-gray-500">
                            Where to?
                          </span>
                        </div>
                      </div>

                      {/* Quick destinations */}
                      <div className="mb-3 flex gap-2">
                        <div className="flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1.5">
                          <span className="text-xs">🏠</span>
                          <span className="text-xs font-medium text-gray-700">
                            Home
                          </span>
                        </div>
                        <div className="flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1.5">
                          <span className="text-xs">💼</span>
                          <span className="text-xs font-medium text-gray-700">
                            Work
                          </span>
                        </div>
                      </div>

                      {/* Service tabs */}
                      <div className="flex gap-1 rounded-xl bg-gray-100 p-1">
                        <div className="flex-1 rounded-lg bg-ubi-green px-3 py-2 text-center">
                          <span className="text-xs font-semibold text-white">
                            Move
                          </span>
                        </div>
                        <div className="flex-1 rounded-lg px-3 py-2 text-center">
                          <span className="text-xs font-medium text-gray-600">
                            Bites
                          </span>
                        </div>
                        <div className="flex-1 rounded-lg px-3 py-2 text-center">
                          <span className="text-xs font-medium text-gray-600">
                            Send
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Decorative elements */}
              <div className="absolute -right-8 top-1/4 h-20 w-20 rounded-2xl bg-ubi-bites/20 blur-xl" />
              <div className="absolute -left-8 bottom-1/4 h-32 w-32 rounded-full bg-ubi-send/20 blur-xl" />
            </div>
          </motion.div>
        </div>
      </div>

      {/* Background decoration */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-1/2 right-0 h-[1000px] w-[1000px] rounded-full bg-ubi-green/5 blur-3xl" />
        <div className="absolute -bottom-1/2 left-0 h-[1000px] w-[1000px] rounded-full bg-ubi-bites/5 blur-3xl" />
      </div>
    </section>
  );
}
