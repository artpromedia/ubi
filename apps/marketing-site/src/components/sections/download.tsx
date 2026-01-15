/**
 * Download Section
 */

"use client";

import { motion } from "framer-motion";
import { Apple, Download, Play, Smartphone, Star } from "lucide-react";

const appStats = [
  { value: "4.8", label: "App Store", icon: Apple },
  { value: "4.7", label: "Play Store", icon: Play },
  { value: "10M+", label: "Downloads", icon: Download },
];

const appFeatures = [
  "Real-time GPS tracking",
  "Secure in-app payments",
  "24/7 customer support",
  "Ride scheduling",
  "Multiple payment methods",
  "Family account sharing",
];

export const DownloadSection = () => {
  return (
    <section className="py-24 bg-gray-50 dark:bg-gray-800">
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16 items-center">
          {/* Content */}
          <div>
            <motion.span
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="inline-block text-ubi-green font-medium mb-4"
            >
              Download the App
            </motion.span>

            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl"
            >
              Your journey starts with a tap
            </motion.h2>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="mt-4 text-lg text-gray-600 dark:text-gray-300"
            >
              Get the UBI app on your phone and experience the future of
              mobility in Africa. Available on iOS and Android.
            </motion.p>

            {/* App Stats */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="mt-8 flex gap-8"
            >
              {appStats.map((stat) => (
                <div key={stat.label} className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-ubi-green/10 text-ubi-green">
                    <stat.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1">
                      <span className="font-bold text-gray-900 dark:text-white">
                        {stat.value}
                      </span>
                      {(stat.label === "App Store" || stat.label === "Play Store") && (
                        <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                      )}
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {stat.label}
                    </span>
                  </div>
                </div>
              ))}
            </motion.div>

            {/* Features List */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3 }}
              className="mt-8 grid grid-cols-2 gap-3"
            >
              {appFeatures.map((feature) => (
                <div key={feature} className="flex items-center gap-2">
                  <svg
                    className="h-5 w-5 text-ubi-green flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="text-sm text-gray-600 dark:text-gray-300">
                    {feature}
                  </span>
                </div>
              ))}
            </motion.div>

            {/* Store Buttons */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.4 }}
              className="mt-10 flex flex-wrap gap-4"
            >
              <a
                href="https://apps.apple.com/app/ubi"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-xl bg-black px-6 py-3 text-white transition hover:bg-gray-800"
              >
                <Apple className="h-6 w-6" />
                <div>
                  <div className="text-xs">Download on the</div>
                  <div className="font-semibold">App Store</div>
                </div>
              </a>

              <a
                href="https://play.google.com/store/apps/details?id=africa.ubi"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-xl bg-black px-6 py-3 text-white transition hover:bg-gray-800"
              >
                <Play className="h-6 w-6" />
                <div>
                  <div className="text-xs">Get it on</div>
                  <div className="font-semibold">Google Play</div>
                </div>
              </a>
            </motion.div>

            {/* SMS Download */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.5 }}
              className="mt-6"
            >
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Or text <span className="font-semibold">UBI</span> to{" "}
                <span className="font-semibold">22122</span> to get the download link
              </p>
            </motion.div>
          </div>

          {/* Phone Mockup */}
          <motion.div
            initial={{ opacity: 0, x: 50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="relative lg:ml-8"
          >
            <div className="relative mx-auto w-72 lg:w-80">
              {/* Background decorations */}
              <div className="absolute -left-4 -top-4 h-32 w-32 rounded-full bg-ubi-green/20 blur-3xl" />
              <div className="absolute -bottom-4 -right-4 h-32 w-32 rounded-full bg-ubi-green/20 blur-3xl" />

              {/* Phone frame */}
              <div className="relative rounded-[3rem] bg-black p-4 shadow-2xl">
                <div className="absolute left-1/2 top-5 h-7 w-28 -translate-x-1/2 rounded-full bg-black z-10" />
                <div className="relative overflow-hidden rounded-[2.5rem] bg-gray-100 dark:bg-gray-700 aspect-[9/19.5]">
                  {/* App screen mockup */}
                  <div className="absolute inset-0 flex flex-col">
                    {/* Status bar */}
                    <div className="flex items-center justify-between px-6 py-2 bg-black text-white text-xs">
                      <span>9:41</span>
                      <div className="flex items-center gap-1">
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 3v18m-9-9h18" />
                        </svg>
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                          <rect x="1" y="7" width="4" height="10" rx="1" />
                          <rect x="7" y="4" width="4" height="13" rx="1" />
                          <rect x="13" y="2" width="4" height="15" rx="1" />
                          <rect x="19" y="0" width="4" height="17" rx="1" />
                        </svg>
                        <span>100%</span>
                      </div>
                    </div>

                    {/* App content */}
                    <div className="flex-1 bg-white dark:bg-gray-900 p-4">
                      {/* Greeting */}
                      <div className="mb-4">
                        <p className="text-xs text-gray-500">Good morning</p>
                        <p className="font-semibold text-gray-900 dark:text-white">
                          Where to?
                        </p>
                      </div>

                      {/* Search bar */}
                      <div className="mb-4 rounded-lg bg-gray-100 dark:bg-gray-800 p-3">
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-3 rounded-full bg-ubi-green" />
                          <span className="text-xs text-gray-500">
                            Search destination
                          </span>
                        </div>
                      </div>

                      {/* Map placeholder */}
                      <div className="relative rounded-xl bg-gray-200 dark:bg-gray-700 h-32 mb-4 overflow-hidden">
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="h-6 w-6 rounded-full bg-ubi-green flex items-center justify-center">
                            <div className="h-2 w-2 rounded-full bg-white" />
                          </div>
                        </div>
                        {/* Decorative map lines */}
                        <svg className="absolute inset-0 w-full h-full opacity-30" viewBox="0 0 100 100">
                          <path d="M0,50 Q25,30 50,50 T100,50" stroke="currentColor" strokeWidth="0.5" fill="none" className="text-gray-400" />
                          <path d="M50,0 Q30,25 50,50 T50,100" stroke="currentColor" strokeWidth="0.5" fill="none" className="text-gray-400" />
                        </svg>
                      </div>

                      {/* Service tabs */}
                      <div className="flex gap-2 mb-4">
                        <div className="flex-1 rounded-lg bg-ubi-green p-2 text-center">
                          <span className="text-xs font-medium text-white">Move</span>
                        </div>
                        <div className="flex-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-2 text-center">
                          <span className="text-xs font-medium text-gray-600 dark:text-gray-300">Bites</span>
                        </div>
                        <div className="flex-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-2 text-center">
                          <span className="text-xs font-medium text-gray-600 dark:text-gray-300">Send</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Floating elements */}
              <motion.div
                animate={{ y: [0, -10, 0] }}
                transition={{ repeat: Infinity, duration: 3 }}
                className="absolute -left-12 top-1/4 rounded-xl bg-white p-3 shadow-lg dark:bg-gray-800"
              >
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-ubi-green flex items-center justify-center">
                    <Smartphone className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-900 dark:text-white">
                      Driver nearby
                    </p>
                    <p className="text-xs text-gray-500">2 min away</p>
                  </div>
                </div>
              </motion.div>

              <motion.div
                animate={{ y: [0, 10, 0] }}
                transition={{ repeat: Infinity, duration: 3, delay: 1 }}
                className="absolute -right-12 top-1/2 rounded-xl bg-white p-3 shadow-lg dark:bg-gray-800"
              >
                <div className="flex items-center gap-2">
                  <div className="flex -space-x-2">
                    <div className="h-6 w-6 rounded-full bg-yellow-400 text-xs flex items-center justify-center">
                      ⭐
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-900 dark:text-white">
                      4.8 Rating
                    </p>
                    <p className="text-xs text-gray-500">2,451 trips</p>
                  </div>
                </div>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
