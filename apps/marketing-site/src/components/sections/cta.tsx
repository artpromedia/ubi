/**
 * CTA Section
 */

"use client";

import { motion } from "framer-motion";
import { ArrowRight, Car, Package, UtensilsCrossed } from "lucide-react";
import Link from "next/link";

const partnerOptions = [
  {
    title: "Drive with UBI",
    description: "Earn money on your schedule. Be your own boss.",
    icon: Car,
    href: "/drive",
    cta: "Start driving",
    gradient: "from-ubi-green to-emerald-500",
  },
  {
    title: "Partner your restaurant",
    description: "Reach millions of hungry customers in your city.",
    icon: UtensilsCrossed,
    href: "/restaurant",
    cta: "Get started",
    gradient: "from-ubi-bites to-orange-500",
  },
  {
    title: "Ship with UBI",
    description: "Scale your business with same-day delivery.",
    icon: Package,
    href: "/merchant",
    cta: "Learn more",
    gradient: "from-ubi-send to-cyan-500",
  },
];

export const CTASection = () => {
  return (
    <section className="py-24 bg-ubi-black">
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        {/* Main CTA */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-ubi-green to-emerald-600 p-8 md:p-12 lg:p-16 mb-16">
          {/* Background pattern */}
          <div className="absolute inset-0 opacity-10">
            <svg
              className="h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <pattern
                id="grid"
                width="10"
                height="10"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 10 0 L 0 0 0 10"
                  fill="none"
                  stroke="white"
                  strokeWidth="0.5"
                />
              </pattern>
              <rect width="100%" height="100%" fill="url(#grid)" />
            </svg>
          </div>

          <div className="relative z-10 flex flex-col items-center text-center">
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-3xl font-bold text-white sm:text-4xl lg:text-5xl"
            >
              Ready to get moving?
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="mt-4 max-w-xl text-lg text-white/80"
            >
              Join millions of people who use UBI every day to move around their
              cities, order food, and send packages.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="mt-8 flex flex-wrap justify-center gap-4"
            >
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-4 font-semibold text-ubi-black transition hover:bg-gray-100"
              >
                Sign up free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/download"
                className="inline-flex items-center gap-2 rounded-full border-2 border-white px-8 py-4 font-semibold text-white transition hover:bg-white/10"
              >
                Download app
              </Link>
            </motion.div>
          </div>

          {/* Decorative elements */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 50, repeat: Infinity, ease: "linear" }}
            className="absolute -right-20 -top-20 h-60 w-60 rounded-full border-2 border-white/20"
          />
          <motion.div
            animate={{ rotate: -360 }}
            transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
            className="absolute -bottom-32 -left-32 h-80 w-80 rounded-full border-2 border-white/10"
          />
        </div>

        {/* Partner Options */}
        <div className="mb-8 text-center">
          <motion.h3
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-2xl font-bold text-white"
          >
            Grow with UBI
          </motion.h3>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="mt-2 text-gray-400"
          >
            Join our partner network and expand your business
          </motion.p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {partnerOptions.map((option, index) => (
            <motion.div
              key={option.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
            >
              <Link
                href={option.href}
                className="group flex flex-col rounded-2xl border border-gray-800 bg-gray-900 p-6 transition hover:border-gray-700 hover:bg-gray-800"
              >
                <div
                  className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${option.gradient}`}
                >
                  <option.icon className="h-6 w-6 text-white" />
                </div>
                <h4 className="text-lg font-semibold text-white">
                  {option.title}
                </h4>
                <p className="mt-2 flex-1 text-sm text-gray-400">
                  {option.description}
                </p>
                <div className="mt-4 flex items-center gap-2 text-sm font-medium text-ubi-green group-hover:gap-3 transition-all">
                  {option.cta}
                  <ArrowRight className="h-4 w-4" />
                </div>
              </Link>
            </motion.div>
          ))}
        </div>

        {/* Trust badges */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
          className="mt-16 flex flex-wrap items-center justify-center gap-8 opacity-60"
        >
          <div className="flex items-center gap-2 text-gray-400">
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-sm">PCI DSS Compliant</span>
          </div>
          <div className="flex items-center gap-2 text-gray-400">
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-sm">256-bit SSL</span>
          </div>
          <div className="flex items-center gap-2 text-gray-400">
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
              <path
                fillRule="evenodd"
                d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm9.707 5.707a1 1 0 00-1.414-1.414L9 12.586l-1.293-1.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-sm">GDPR Compliant</span>
          </div>
          <div className="flex items-center gap-2 text-gray-400">
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-sm">ISO 27001</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
};
