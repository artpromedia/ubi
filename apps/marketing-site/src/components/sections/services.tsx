/**
 * Services Section
 */

"use client";

import { motion } from "framer-motion";
import { ArrowRight, Car, Package, Utensils } from "lucide-react";
import Link from "next/link";

const services = [
  {
    id: "move",
    name: "UBI Move",
    tagline: "Get there safely",
    description:
      "Book affordable, safe rides anytime. From economy to premium, we've got a vehicle for every journey.",
    icon: Car,
    color: "#1DB954",
    features: ["24/7 Availability", "Real-time tracking", "Safe & vetted drivers"],
    href: "/ride",
  },
  {
    id: "bites",
    name: "UBI Bites",
    tagline: "Satisfy your cravings",
    description:
      "Order from thousands of restaurants. From local favorites to international cuisine, delivered hot and fresh.",
    icon: Utensils,
    color: "#FF7545",
    features: ["1000+ restaurants", "Live order tracking", "30-min delivery"],
    href: "/eat",
  },
  {
    id: "send",
    name: "UBI Send",
    tagline: "Deliver anything",
    description:
      "Send packages across the city in minutes. Safe, tracked, and affordable same-day delivery.",
    icon: Package,
    color: "#10AEBA",
    features: ["Same-day delivery", "Proof of delivery", "Insurance included"],
    href: "/deliver",
  },
];

export function ServicesSection() {
  return (
    <section className="py-24 bg-white dark:bg-gray-900">
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        {/* Header */}
        <div className="mx-auto max-w-2xl text-center mb-16">
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-block text-ubi-green font-medium mb-4"
          >
            Our Services
          </motion.span>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl"
          >
            Everything you need, one app
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="mt-4 text-lg text-gray-600 dark:text-gray-300"
          >
            From rides to food to packages, UBI has you covered across all your daily needs.
          </motion.p>
        </div>

        {/* Service cards */}
        <div className="grid gap-8 md:grid-cols-3">
          {services.map((service, index) => {
            const Icon = service.icon;
            return (
              <motion.div
                key={service.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="group relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-8 transition-all hover:shadow-xl dark:border-gray-700 dark:bg-gray-800"
              >
                {/* Icon */}
                <div
                  className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `${service.color}15` }}
                >
                  <Icon className="h-7 w-7" style={{ color: service.color }} />
                </div>

                {/* Content */}
                <h3 className="mb-2 text-xl font-bold text-gray-900 dark:text-white">
                  {service.name}
                </h3>
                <p
                  className="mb-4 text-sm font-medium"
                  style={{ color: service.color }}
                >
                  {service.tagline}
                </p>
                <p className="mb-6 text-gray-600 dark:text-gray-300">
                  {service.description}
                </p>

                {/* Features */}
                <ul className="mb-6 space-y-2">
                  {service.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400"
                    >
                      <div
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: service.color }}
                      />
                      {feature}
                    </li>
                  ))}
                </ul>

                {/* Link */}
                <Link
                  href={service.href}
                  className="inline-flex items-center text-sm font-medium transition-colors"
                  style={{ color: service.color }}
                >
                  Learn more
                  <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>

                {/* Hover gradient */}
                <div
                  className="absolute inset-0 -z-10 opacity-0 transition-opacity group-hover:opacity-100"
                  style={{
                    background: `linear-gradient(135deg, ${service.color}05 0%, transparent 60%)`,
                  }}
                />
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
