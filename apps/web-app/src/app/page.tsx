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
import { Logo } from "../../../../packages/ui/src/components/logo";

// ===========================================
// Metadata for SEO
// ===========================================

export const metadata: Metadata = {
  title: "UBI - Your Ride, Your Way",
  description:
    "Request a ride with UBI. The fare is set when a driver is assigned and shown before you confirm. Other services roll out city by city.",
  keywords: ["ride-hailing", "mobility", "Africa", "Nigeria"],
  openGraph: {
    title: "UBI - Your Ride, Your Way",
    description:
      "Request a ride with UBI. The fare is set when a driver is assigned and shown before you confirm.",
    type: "website",
    locale: "en_US",
    siteName: "UBI",
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
      {/* Navigation */}
      <nav className="relative z-10 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-b border-gray-200 dark:border-gray-700">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            {/* Logo */}
            <Logo size="lg" />

            {/* Nav Links */}
            <div className="hidden md:flex items-center gap-8">
              <Link
                href="#services"
                className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
              >
                Services
              </Link>
              <Link
                href="#apps"
                className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
              >
                Apps
              </Link>
              <Link
                href="#countries"
                className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
              >
                Countries
              </Link>
              <Link
                href="/about"
                className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
              >
                About
              </Link>
            </div>

            {/* Auth Buttons */}
            <div className="flex items-center gap-4">
              <Link
                href="/auth/login"
                className="text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white font-medium"
              >
                Sign In
              </Link>
              <Link
                href="/auth/signup"
                className="bg-ubi-green-500 hover:bg-ubi-green-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </nav>

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
                <span className="text-ubi-green-500 dark:text-ubi-green-400">
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
                  className="inline-flex items-center justify-center rounded-xl bg-ubi-green-500 px-8 py-4 text-lg font-semibold text-white shadow-lg transition-all hover:bg-ubi-green-600 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-ubi-green-400 focus:ring-offset-2"
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

              <p className="mt-12 text-sm text-gray-500 dark:text-gray-400">
                Availability varies by city. Check the app for what&apos;s live
                near you.
              </p>
            </div>

            {/* Right Column - App Preview */}
            <div className="relative flex items-center justify-center lg:justify-end">
              <div className="relative">
                {/* Phone mockup placeholder */}
                <div className="h-[600px] w-[300px] rounded-[3rem] bg-gradient-to-br from-ubi-green-400 to-ubi-green-600 p-3 shadow-2xl">
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
                    <span className="text-2xl">📍</span>
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-white">
                        Fare shown upfront
                      </p>
                      <p className="text-sm text-gray-500">
                        Before you confirm
                      </p>
                    </div>
                  </div>
                </div>

                <div className="absolute -right-8 bottom-24 rounded-2xl bg-white p-4 shadow-xl dark:bg-gray-800">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🔒</span>
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-white">
                        PIN-verified pickup
                      </p>
                      <p className="text-sm text-gray-500">Every ride</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Services Section */}
      <section id="services" className="bg-white py-24 dark:bg-gray-900">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl">
              One App, Growing Services
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600 dark:text-gray-400">
              UBI Move is live today. Bites and Send are being introduced city
              by city — the app tells you what&apos;s on where you are.
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
                Request a ride. The fare is set when a driver is assigned and
                shown before you confirm.
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
                Food delivery, rolling out city by city. Not yet on in every
                market — the app shows where it&apos;s live.
              </p>
              <Link
                href="/auth/signup"
                className="mt-4 inline-flex items-center text-orange-600 hover:text-orange-700 dark:text-orange-400"
              >
                Check availability
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
                Package delivery, being introduced by market. Not yet on
                everywhere — the app shows where it&apos;s live.
              </p>
              <Link
                href="/auth/signup"
                className="mt-4 inline-flex items-center text-cyan-600 hover:text-cyan-700 dark:text-cyan-400"
              >
                Check availability
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

      {/* Availability Section */}
      <section id="countries" className="bg-gray-50 py-24 dark:bg-gray-800">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl">
            UBI launches city by city
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600 dark:text-gray-400">
            We don&apos;t publish launch dates or counts. Sign in to see exactly
            what&apos;s live where you are.
          </p>
        </div>
      </section>

      {/* Apps Section */}
      <section id="apps" className="bg-white py-24 dark:bg-gray-900">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl">
              The UBI Ecosystem
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600 dark:text-gray-400">
              Whether you&apos;re a rider, driver, restaurant, or business
              partner - we have an app for you.
            </p>
          </div>

          <div className="mt-16 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {/* Rider App */}
            <div className="group relative rounded-2xl border border-gray-200 bg-white p-8 shadow-sm transition-all hover:shadow-lg hover:border-ubi-green-300 dark:border-gray-700 dark:bg-gray-800">
              <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-ubi-green-500 text-2xl text-white">
                🚗
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                Rider App
              </h3>
              <p className="mt-2 text-gray-600 dark:text-gray-400">
                Request a ride from your browser. Native apps are not yet
                published.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Link
                  href="/auth/signup"
                  className="inline-flex items-center rounded-lg bg-ubi-green-500 px-4 py-2 text-sm font-medium text-white hover:bg-ubi-green-600"
                >
                  Web App
                </Link>
                <span className="inline-flex items-center rounded-lg border border-dashed border-gray-300 px-4 py-2 text-sm font-medium text-gray-400 dark:border-gray-600 dark:text-gray-500">
                  App Store &amp; Google Play — not yet published
                </span>
              </div>
            </div>

            {/* Driver App */}
            <div className="group relative rounded-2xl border border-gray-200 bg-white p-8 shadow-sm transition-all hover:shadow-lg hover:border-emerald-300 dark:border-gray-700 dark:bg-gray-800">
              <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-emerald-600 text-2xl text-white">
                🚘
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                Driver App
              </h3>
              <p className="mt-2 text-gray-600 dark:text-gray-400">
                Set your own hours. Your fare share is shown on every trip and
                on your weekly statement.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-lg border border-dashed border-gray-300 px-4 py-2 text-sm font-medium text-gray-500 dark:border-gray-600 dark:text-gray-400">
                  Driver sign-up opens with the launch in your city
                </span>
              </div>
            </div>

            {/* Restaurant Portal */}
            <div className="group relative rounded-2xl border border-gray-200 bg-white p-8 shadow-sm transition-all hover:shadow-lg hover:border-orange-300 dark:border-gray-700 dark:bg-gray-800">
              <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-orange-500 text-2xl text-white">
                🍽️
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                Restaurant Portal
              </h3>
              <p className="mt-2 text-gray-600 dark:text-gray-400">
                For managing orders and menus once UBI Bites is live in your
                city.
              </p>
              <p className="mt-6 text-sm font-medium text-gray-400 dark:text-gray-500">
                Not yet available — arranged directly with UBI.
              </p>
            </div>

            {/* Fleet Portal */}
            <div className="group relative rounded-2xl border border-gray-200 bg-white p-8 shadow-sm transition-all hover:shadow-lg hover:border-teal-300 dark:border-gray-700 dark:bg-gray-800">
              <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-teal-600 text-2xl text-white">
                🚚
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                Fleet Portal
              </h3>
              <p className="mt-2 text-gray-600 dark:text-gray-400">
                For fleet owners managing several drivers and vehicles.
              </p>
              <p className="mt-6 text-sm font-medium text-gray-400 dark:text-gray-500">
                Not yet available — arranged directly with UBI.
              </p>
            </div>

            {/* Merchant Portal */}
            <div className="group relative rounded-2xl border border-gray-200 bg-white p-8 shadow-sm transition-all hover:shadow-lg hover:border-purple-300 dark:border-gray-700 dark:bg-gray-800">
              <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-purple-600 text-2xl text-white">
                🏪
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                Merchant Portal
              </h3>
              <p className="mt-2 text-gray-600 dark:text-gray-400">
                For businesses sending packages through UBI Send once it&apos;s
                live in your city.
              </p>
              <p className="mt-6 text-sm font-medium text-gray-400 dark:text-gray-500">
                Not yet available — arranged directly with UBI.
              </p>
            </div>
          </div>

          {/* Become a Partner CTA */}
          <div className="mt-16 rounded-2xl bg-gradient-to-r from-ubi-green-500 to-emerald-600 p-8 text-center">
            <h3 className="text-2xl font-bold text-white">
              Want to Partner with UBI?
            </h3>
            <p className="mt-2 text-ubi-green-100">
              Driver, restaurant and business partnerships are being introduced
              market by market.
            </p>
            <p className="mt-6 text-sm text-ubi-green-100">
              Sign-up for these isn&apos;t open here yet — check back as UBI
              launches in your city.
            </p>
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
            Create an account and request a ride when UBI is live in your city.
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
          <div className="grid gap-8 md:grid-cols-4">
            {/* Brand */}
            <div>
              <Logo size="md" />
              <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
                Ubiquiti Mobility Inc. Rides today; more services rolling out
                city by city.
              </p>
            </div>

            {/* For Users */}
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white">
                For Users
              </h4>
              <ul className="mt-4 space-y-2">
                <li>
                  <Link
                    href="/auth/signup"
                    className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                  >
                    Rider App
                  </Link>
                </li>
                <li className="text-sm text-gray-500 dark:text-gray-400">
                  iOS &amp; Android apps: not yet published
                </li>
              </ul>
            </div>

            {/* For Partners */}
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white">
                For Partners
              </h4>
              <ul className="mt-4 space-y-2 text-sm text-gray-500 dark:text-gray-400">
                <li>Driver sign-up opens with the launch in your city.</li>
                <li>
                  Restaurant, fleet and merchant portals are arranged directly
                  with UBI — not yet self-serve here.
                </li>
              </ul>
            </div>

            {/* Company */}
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white">
                Company
              </h4>
              <ul className="mt-4 space-y-2 text-sm text-gray-500 dark:text-gray-400">
                <li>Ubiquiti Mobility Inc.</li>
                <li>Safety and legal pages are published before launch.</li>
              </ul>
            </div>
          </div>

          <div className="mt-12 border-t border-gray-200 pt-8 dark:border-gray-700">
            <p className="text-center text-sm text-gray-500 dark:text-gray-400">
              © {new Date().getFullYear()} Ubiquiti Mobility Inc. All rights
              reserved.
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
