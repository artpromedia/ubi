/**
 * Cities Section
 */

"use client";

import { motion } from "framer-motion";
import Link from "next/link";

const cities = [
  {
    city: "Lagos",
    country: "Nigeria",
    flag: "🇳🇬",
    image: "/cities/lagos.jpg",
    riders: "2M+",
  },
  {
    city: "Nairobi",
    country: "Kenya",
    flag: "🇰🇪",
    image: "/cities/nairobi.jpg",
    riders: "1.5M+",
  },
  {
    city: "Johannesburg",
    country: "South Africa",
    flag: "🇿🇦",
    image: "/cities/johannesburg.jpg",
    riders: "1.2M+",
  },
  {
    city: "Accra",
    country: "Ghana",
    flag: "🇬🇭",
    image: "/cities/accra.jpg",
    riders: "800K+",
  },
  {
    city: "Kigali",
    country: "Rwanda",
    flag: "🇷🇼",
    image: "/cities/kigali.jpg",
    riders: "400K+",
  },
  {
    city: "Addis Ababa",
    country: "Ethiopia",
    flag: "🇪🇹",
    image: "/cities/addis.jpg",
    riders: "600K+",
  },
];

export function CitiesSection() {
  return (
    <section className="py-24 bg-gray-50 dark:bg-gray-800">
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        {/* Header */}
        <div className="mx-auto max-w-2xl text-center mb-16">
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-block text-ubi-green font-medium mb-4"
          >
            Across Africa
          </motion.span>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl"
          >
            Available in 50+ cities
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="mt-4 text-lg text-gray-600 dark:text-gray-300"
          >
            From major metropolises to growing cities, UBI is connecting millions across the continent.
          </motion.p>
        </div>

        {/* Cities grid */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {cities.map((city, index) => (
            <motion.div
              key={city.city}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="group relative overflow-hidden rounded-2xl"
            >
              {/* Background */}
              <div className="aspect-[4/3] bg-gradient-to-br from-gray-700 to-gray-900">
                {/* Placeholder for city image */}
                <div className="absolute inset-0 flex items-center justify-center text-6xl opacity-30">
                  {city.flag}
                </div>
              </div>

              {/* Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />

              {/* Content */}
              <div className="absolute bottom-0 left-0 right-0 p-6">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">{city.flag}</span>
                  <span className="text-sm text-gray-300">{city.country}</span>
                </div>
                <h3 className="text-2xl font-bold text-white mb-1">{city.city}</h3>
                <p className="text-gray-300 text-sm">{city.riders} active riders</p>
              </div>

              {/* Hover effect */}
              <div className="absolute inset-0 bg-ubi-green/20 opacity-0 transition-opacity group-hover:opacity-100" />
            </motion.div>
          ))}
        </div>

        {/* View all link */}
        <div className="mt-12 text-center">
          <Link
            href="/cities"
            className="inline-flex items-center text-ubi-green font-medium hover:underline"
          >
            View all cities
            <span className="ml-2">→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
