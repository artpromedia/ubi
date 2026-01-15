/**
 * Cities Section
 */

"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";

const cities = [
  {
    city: "Lagos",
    country: "Nigeria",
    flag: "🇳🇬",
    // Lagos skyline
    image:
      "https://images.unsplash.com/photo-1618828665011-0abd973f7bb8?w=800&q=80",
    riders: "2M+",
  },
  {
    city: "Nairobi",
    country: "Kenya",
    flag: "🇰🇪",
    // Nairobi skyline
    image:
      "https://images.unsplash.com/photo-1611348586804-61bf6c080437?w=800&q=80",
    riders: "1.5M+",
  },
  {
    city: "Johannesburg",
    country: "South Africa",
    flag: "🇿🇦",
    // Johannesburg skyline
    image:
      "https://images.unsplash.com/photo-1577948000111-9c970dfe3743?w=800&q=80",
    riders: "1.2M+",
  },
  {
    city: "Accra",
    country: "Ghana",
    flag: "🇬🇭",
    // Accra cityscape
    image:
      "https://images.unsplash.com/photo-1567789884554-0b844b597180?w=800&q=80",
    riders: "800K+",
  },
  {
    city: "Kigali",
    country: "Rwanda",
    flag: "🇷🇼",
    // Kigali city view
    image:
      "https://images.unsplash.com/photo-1580060839134-75a5edca2e99?w=800&q=80",
    riders: "400K+",
  },
  {
    city: "Addis Ababa",
    country: "Ethiopia",
    flag: "🇪🇹",
    // Addis Ababa cityscape
    image:
      "https://images.unsplash.com/photo-1523805009345-7448845a9e53?w=800&q=80",
    riders: "600K+",
  },
  {
    city: "Abuja",
    country: "Nigeria",
    flag: "🇳🇬",
    // Abuja city center
    image:
      "https://images.unsplash.com/photo-1606146485652-75b352ce408a?w=800&q=80",
    riders: "750K+",
  },
  {
    city: "Cotonou",
    country: "Benin",
    flag: "🇧🇯",
    // African coastal city
    image:
      "https://images.unsplash.com/photo-1504681869696-d977211a5f4c?w=800&q=80",
    riders: "300K+",
  },
  {
    city: "Abidjan",
    country: "Côte d'Ivoire",
    flag: "🇨🇮",
    // Abidjan skyline
    image:
      "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&q=80",
    riders: "900K+",
  },
];

export const CitiesSection = () => {
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
            From major metropolises to growing cities, UBI is connecting
            millions across the continent.
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
              {/* Background Image */}
              <div className="aspect-[4/3] relative">
                <Image
                  src={city.image}
                  alt={`${city.city}, ${city.country}`}
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-110"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                />
              </div>

              {/* Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />

              {/* Content */}
              <div className="absolute bottom-0 left-0 right-0 p-6">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">{city.flag}</span>
                  <span className="text-sm text-gray-300">{city.country}</span>
                </div>
                <h3 className="text-2xl font-bold text-white mb-1">
                  {city.city}
                </h3>
                <p className="text-gray-300 text-sm">
                  {city.riders} active riders
                </p>
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
};
