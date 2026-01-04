/**
 * Safety Section
 */

"use client";

import { motion } from "framer-motion";
import { AlertTriangle, Clock, MapPin, Phone, Shield, UserCheck } from "lucide-react";

const safetyFeatures = [
  {
    icon: UserCheck,
    title: "Verified drivers",
    description: "All drivers undergo thorough background checks and vehicle inspections.",
  },
  {
    icon: MapPin,
    title: "Real-time tracking",
    description: "Share your trip with loved ones and let them track your journey live.",
  },
  {
    icon: Phone,
    title: "24/7 support",
    description: "Our safety team is available around the clock to help with any issues.",
  },
  {
    icon: Shield,
    title: "Insurance coverage",
    description: "Every trip is covered by comprehensive insurance for your peace of mind.",
  },
  {
    icon: AlertTriangle,
    title: "Emergency button",
    description: "In-app emergency button connects you directly to local emergency services.",
  },
  {
    icon: Clock,
    title: "Trip verification",
    description: "PIN verification ensures you get into the right vehicle with the right driver.",
  },
];

export function SafetySection() {
  return (
    <section className="py-24 bg-white dark:bg-gray-900">
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-24 items-center">
          {/* Content */}
          <div>
            <motion.span
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="inline-block text-ubi-green font-medium mb-4"
            >
              Your Safety Matters
            </motion.span>
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mb-6 text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl"
            >
              Built with safety at the core
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="mb-8 text-lg text-gray-600 dark:text-gray-300"
            >
              We invest heavily in technology and processes to make every trip as safe as possible.
              Your well-being is our top priority.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
            >
              <a
                href="/safety"
                className="inline-flex items-center text-ubi-green font-medium hover:underline"
              >
                Learn more about safety
                <span className="ml-2">→</span>
              </a>
            </motion.div>
          </div>

          {/* Features grid */}
          <div className="grid gap-6 sm:grid-cols-2">
            {safetyFeatures.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="rounded-xl border border-gray-200 bg-gray-50 p-6 dark:border-gray-700 dark:bg-gray-800"
                >
                  <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-ubi-green/10">
                    <Icon className="h-5 w-5 text-ubi-green" />
                  </div>
                  <h3 className="mb-2 font-semibold text-gray-900 dark:text-white">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {feature.description}
                  </p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
