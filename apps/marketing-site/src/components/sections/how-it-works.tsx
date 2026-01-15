/**
 * How It Works Section
 */

"use client";

import { motion } from "framer-motion";
import { Car, CheckCircle, CreditCard, MapPin } from "lucide-react";

const steps = [
  {
    number: "01",
    icon: MapPin,
    title: "Set your destination",
    description:
      "Enter your pickup and dropoff locations. We'll show you the estimated fare upfront.",
  },
  {
    number: "02",
    icon: Car,
    title: "Choose your ride",
    description:
      "Select from economy, comfort, or premium vehicles. Pick what fits your budget and style.",
  },
  {
    number: "03",
    icon: CreditCard,
    title: "Pay seamlessly",
    description:
      "Pay with cash, card, mobile money, or UBI Wallet. Split fares with friends easily.",
  },
  {
    number: "04",
    icon: CheckCircle,
    title: "Enjoy your ride",
    description:
      "Track your driver in real-time, share trip status with loved ones, and arrive safely.",
  },
];

export const HowItWorksSection = () => {
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
            How It Works
          </motion.span>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl"
          >
            Getting started is easy
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="mt-4 text-lg text-gray-600 dark:text-gray-300"
          >
            Request a ride in seconds and get where you need to go.
          </motion.p>
        </div>

        {/* Steps */}
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <motion.div
                key={step.number}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="relative text-center"
              >
                {/* Connector line */}
                {index < steps.length - 1 && (
                  <div className="absolute top-8 left-1/2 hidden h-0.5 w-full bg-gray-200 dark:bg-gray-700 lg:block" />
                )}

                {/* Step number */}
                <div className="relative mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-ubi-green text-white shadow-lg">
                  <Icon className="h-7 w-7" />
                </div>

                {/* Content */}
                <span className="mb-2 block text-sm font-medium text-ubi-green">
                  Step {step.number}
                </span>
                <h3 className="mb-3 text-lg font-bold text-gray-900 dark:text-white">
                  {step.title}
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  {step.description}
                </p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
