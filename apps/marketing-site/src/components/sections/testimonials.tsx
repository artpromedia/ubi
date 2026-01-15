/**
 * Testimonials Section
 */

"use client";

import { motion } from "framer-motion";
import { Quote, Star } from "lucide-react";

const testimonials = [
  {
    id: 1,
    name: "Amina Okonkwo",
    role: "Business Owner",
    location: "Lagos, Nigeria",
    avatar: "👩🏾",
    rating: 5,
    content:
      "UBI has transformed how I commute daily. The drivers are professional, the app is easy to use, and I always feel safe. It's become an essential part of my routine.",
  },
  {
    id: 2,
    name: "James Mwangi",
    role: "Software Developer",
    location: "Nairobi, Kenya",
    avatar: "👨🏿",
    rating: 5,
    content:
      "As someone who doesn't own a car, UBI has given me freedom. I can get anywhere in the city quickly and affordably. The UBI Wallet feature is genius!",
  },
  {
    id: 3,
    name: "Fatou Diallo",
    role: "University Student",
    location: "Accra, Ghana",
    avatar: "👩🏾",
    rating: 5,
    content:
      "Love the ride-sharing option! I've saved so much money splitting rides with other students going the same direction. Plus, the promo codes are amazing.",
  },
  {
    id: 4,
    name: "Thabo Mokoena",
    role: "Marketing Manager",
    location: "Johannesburg, SA",
    avatar: "👨🏿",
    rating: 5,
    content:
      "UBI Bites is a game-changer. I can order lunch from my favorite restaurants and have it delivered to my office in 30 minutes. The food is always hot and fresh.",
  },
  {
    id: 5,
    name: "Aisha Kamara",
    role: "E-commerce Seller",
    location: "Kigali, Rwanda",
    avatar: "👩🏾",
    rating: 5,
    content:
      "UBI Send has revolutionized my small business. I can deliver products to customers across the city the same day. My customers love the real-time tracking!",
  },
  {
    id: 6,
    name: "Dawit Tekle",
    role: "Healthcare Worker",
    location: "Addis Ababa, Ethiopia",
    avatar: "👨🏿",
    rating: 5,
    content:
      "Working night shifts, I need reliable transportation at odd hours. UBI is always available, no matter the time. The safety features give me peace of mind.",
  },
];

export const TestimonialsSection = () => {
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
            Testimonials
          </motion.span>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl"
          >
            Loved by millions across Africa
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="mt-4 text-lg text-gray-600 dark:text-gray-300"
          >
            Don't just take our word for it. Here's what our community has to say.
          </motion.p>
        </div>

        {/* Testimonials grid */}
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {testimonials.map((testimonial, index) => (
            <motion.div
              key={testimonial.id}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="relative rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
            >
              {/* Quote icon */}
              <Quote className="absolute right-6 top-6 h-8 w-8 text-gray-200 dark:text-gray-700" />

              {/* Rating */}
              <div className="mb-4 flex gap-1">
                {Array.from({ length: testimonial.rating }).map((_, i) => (
                  <Star
                    key={i}
                    className="h-4 w-4 fill-yellow-400 text-yellow-400"
                  />
                ))}
              </div>

              {/* Content */}
              <p className="mb-6 text-gray-600 dark:text-gray-300">
                "{testimonial.content}"
              </p>

              {/* Author */}
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-xl dark:bg-gray-700">
                  {testimonial.avatar}
                </div>
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">
                    {testimonial.name}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {testimonial.role} • {testimonial.location}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
