/**
 * Hero Section
 */

"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@ubi/ui";
import { ArrowRight, Play } from "lucide-react";

export function HeroSection() {
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
              Your Ride,{" "}
              <span className="text-ubi-green">Your Way</span>
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
                <div className="text-3xl font-bold text-gray-900 dark:text-white">10M+</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Active Users</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-gray-900 dark:text-white">500K+</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Drivers</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-gray-900 dark:text-white">50+</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Cities</div>
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
                <div className="overflow-hidden rounded-[2.5rem] bg-white">
                  {/* Phone screen placeholder */}
                  <div className="aspect-[9/19] bg-gradient-to-br from-ubi-green to-green-600 flex items-center justify-center">
                    <div className="text-center text-white">
                      <div className="text-6xl mb-4">🚗</div>
                      <p className="text-lg font-semibold">UBI App</p>
                      <p className="text-sm opacity-80">Mockup Preview</p>
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
