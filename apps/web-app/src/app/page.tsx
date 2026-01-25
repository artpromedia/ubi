/**
 * Landing Page
 *
 * Shows a compelling landing page for unauthenticated users,
 * or redirects authenticated users to the home dashboard.
 */

import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

// ===========================================
// Metadata for SEO
// ===========================================

export const metadata: Metadata = {
  title: "UBI - Your Ride, Your Way | Africa's Super App",
  description:
    "Book rides, order food, and send packages across Africa with UBI. Fast, reliable, and affordable mobility solutions designed for Africa.",
  keywords: [
    "ride-hailing",
    "food delivery",
    "package delivery",
    "mobility",
    "Africa",
    "Nigeria",
    "Kenya",
    "South Africa",
    "Ghana",
  ],
  openGraph: {
    title: "UBI - Your Ride, Your Way",
    description:
      "Book rides, order food, and send packages across Africa with UBI.",
    type: "website",
    locale: "en_US",
    siteName: "UBI Africa",
  },
};

// ===========================================
// Server-side Auth Check
// ===========================================

async function checkAuth(): Promise<boolean> {
  const cookieStore = await cookies();
  const authToken = cookieStore.get("ubi_auth_token");

  if (!authToken?.value) {
    return false;
  }

  // Optionally validate token with API (for more robust check)
  // For now, presence of token indicates authenticated state
  // The actual validation happens on protected routes via middleware
  return true;
}

// ===========================================
// Landing Page Component
// ===========================================

export default async function LandingPage() {
  const isAuthenticated = await checkAuth();

  // Redirect authenticated users to the main app
  if (isAuthenticated) {
    redirect("/home");
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 bg-[url('/grid-pattern.svg')] opacity-5" />

        <div className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8 lg:py-32">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-8">
            {/* Left Column - Copy */}
            <div className="flex flex-col justify-center">
              <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-5xl lg:text-6xl">
                Your Ride,{" "}
                <span className="text-primary-600 dark:text-primary-400">
                  Your Way
                </span>
              </h1>

              <p className="mt-6 text-lg leading-8 text-gray-600 dark:text-gray-300 sm:text-xl">
                Book rides, order food, and send packages across Africa. One
                app, endless possibilities.
              </p>

              {/* CTA Buttons */}
              <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:gap-6">
                <Link
                  href="/auth/signup"
                  className="inline-flex items-center justify-center rounded-xl bg-primary-600 px-8 py-4 text-lg font-semibold text-white shadow-lg transition-all hover:bg-primary-700 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
                >
                  Get Started
                  <svg
                    className="ml-2 h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 7l5 5m0 0l-5 5m5-5H6"
                    />
                  </svg>
                </Link>

                <Link
                  href="/auth/login"
                  className="inline-flex items-center justify-center rounded-xl border-2 border-gray-300 bg-white px-8 py-4 text-lg font-semibold text-gray-700 transition-all hover:border-gray-400 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  Sign In
                </Link>
              </div>

              {/* Trust Indicators */}
              <div className="mt-12 flex items-center gap-8">
                <div className="text-center">
                  <p className="text-3xl font-bold text-gray-900 dark:text-white">
                    10M+
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Happy Riders
                  </p>
                </div>
                <div className="h-12 w-px bg-gray-200 dark:bg-gray-700" />
                <div className="text-center">
                  <p className="text-3xl font-bold text-gray-900 dark:text-white">
                    6
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Countries
                  </p>
                </div>
                <div className="h-12 w-px bg-gray-200 dark:bg-gray-700" />
                <div className="text-center">
                  <p className="text-3xl font-bold text-gray-900 dark:text-white">
                    4.8★
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    App Rating
                  </p>
                </div>
              </div>
            </div>

            {/* Right Column - App Preview */}
            <div className="relative flex items-center justify-center lg:justify-end">
              <div className="relative">
                {/* Phone mockup placeholder */}
                <div className="h-[600px] w-[300px] rounded-[3rem] bg-gradient-to-br from-primary-500 to-primary-700 p-3 shadow-2xl">
                  <div className="h-full w-full rounded-[2.5rem] bg-white dark:bg-gray-900">
                    <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                      <div className="mb-4 text-6xl">🚗</div>
                      <p className="text-lg font-medium text-gray-600 dark:text-gray-400">
                        Download the UBI app
                      </p>
                    </div>
                  </div>
                </div>

                {/* Floating elements */}
                <div className="absolute -left-8 top-12 rounded-2xl bg-white p-4 shadow-xl dark:bg-gray-800">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🍔</span>
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-white">
                        Food Delivered
                      </p>
                      <p className="text-sm text-gray-500">In 25 min</p>
                    </div>
                  </div>
                </div>

                <div className="absolute -right-8 bottom-24 rounded-2xl bg-white p-4 shadow-xl dark:bg-gray-800">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">📦</span>
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-white">
                        Package Sent
                      </p>
                      <p className="text-sm text-gray-500">Same day delivery</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Services Section */}
      <section className="bg-white py-24 dark:bg-gray-900">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl">
              One App, Three Services
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600 dark:text-gray-400">
              Everything you need to move, eat, and send – all in one place.
            </p>
          </div>

          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {/* Move */}
            <div className="group rounded-2xl bg-gradient-to-br from-green-50 to-green-100 p-8 transition-all hover:shadow-xl dark:from-green-900/20 dark:to-green-800/20">
              <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-green-500 text-2xl text-white">
                🚗
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                UBI Move
              </h3>
              <p className="mt-2 text-gray-600 dark:text-gray-400">
                Book safe, affordable rides anytime. From daily commutes to
                special trips.
              </p>
              <Link
                href="/auth/signup"
                className="mt-4 inline-flex items-center text-green-600 hover:text-green-700 dark:text-green-400"
              >
                Start Riding
                <svg
                  className="ml-1 h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </Link>
            </div>

            {/* Bites */}
            <div className="group rounded-2xl bg-gradient-to-br from-orange-50 to-orange-100 p-8 transition-all hover:shadow-xl dark:from-orange-900/20 dark:to-orange-800/20">
              <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-orange-500 text-2xl text-white">
                🍕
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                UBI Bites
              </h3>
              <p className="mt-2 text-gray-600 dark:text-gray-400">
                Order from your favorite restaurants. Delicious food delivered
                to your door.
              </p>
              <Link
                href="/auth/signup"
                className="mt-4 inline-flex items-center text-orange-600 hover:text-orange-700 dark:text-orange-400"
              >
                Order Now
                <svg
                  className="ml-1 h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </Link>
            </div>

            {/* Send */}
            <div className="group rounded-2xl bg-gradient-to-br from-cyan-50 to-cyan-100 p-8 transition-all hover:shadow-xl dark:from-cyan-900/20 dark:to-cyan-800/20">
              <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-cyan-500 text-2xl text-white">
                📦
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                UBI Send
              </h3>
              <p className="mt-2 text-gray-600 dark:text-gray-400">
                Send packages across the city or across the country. Fast and
                reliable.
              </p>
              <Link
                href="/auth/signup"
                className="mt-4 inline-flex items-center text-cyan-600 hover:text-cyan-700 dark:text-cyan-400"
              >
                Send Package
                <svg
                  className="ml-1 h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Countries Section */}
      <section className="bg-gray-50 py-24 dark:bg-gray-800">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl">
              Available Across Africa
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600 dark:text-gray-400">
              We&apos;re growing fast. UBI is now live in 6 countries with more
              coming soon.
            </p>
          </div>

          <div className="mt-12 flex flex-wrap justify-center gap-8">
            {[
              { flag: "🇳🇬", name: "Nigeria", cities: "Lagos, Abuja, Ibadan" },
              { flag: "🇰🇪", name: "Kenya", cities: "Nairobi, Mombasa" },
              {
                flag: "🇿🇦",
                name: "South Africa",
                cities: "Johannesburg, Cape Town",
              },
              { flag: "🇬🇭", name: "Ghana", cities: "Accra, Kumasi" },
              { flag: "🇷🇼", name: "Rwanda", cities: "Kigali" },
              { flag: "🇪🇹", name: "Ethiopia", cities: "Addis Ababa" },
            ].map((country) => (
              <div
                key={country.name}
                className="flex items-center gap-4 rounded-xl bg-white p-6 shadow-md dark:bg-gray-900"
              >
                <span className="text-4xl">{country.flag}</span>
                <div>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {country.name}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {country.cities}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-primary-600 py-24">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Ready to Get Started?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-primary-100">
            Join millions of users across Africa. Download UBI today.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-4 sm:flex-row">
            <Link
              href="/auth/signup"
              className="inline-flex items-center justify-center rounded-xl bg-white px-8 py-4 text-lg font-semibold text-primary-600 shadow-lg transition-all hover:bg-gray-100"
            >
              Create Account
            </Link>
            <Link
              href="/auth/login"
              className="inline-flex items-center justify-center rounded-xl border-2 border-white px-8 py-4 text-lg font-semibold text-white transition-all hover:bg-primary-700"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white py-12 dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-primary-600">UBI</span>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                © 2024 UBI Africa. All rights reserved.
              </span>
            </div>
            <div className="flex gap-6">
              <Link
                href="/privacy"
                className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              >
                Privacy
              </Link>
              <Link
                href="/terms"
                className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              >
                Terms
              </Link>
              <Link
                href="/safety"
                className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              >
                Safety
              </Link>
              <Link
                href="/about"
                className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              >
                About
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
