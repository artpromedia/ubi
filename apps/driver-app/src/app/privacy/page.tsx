"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <div className="mx-auto w-full max-w-lg lg:max-w-2xl">
        {/* Header */}
        <div className="bg-ubi-black px-4 pb-6 pt-12 safe-area-top">
          <div className="flex items-center gap-4">
            <Link
              href="/settings"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
            >
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-xl font-bold text-white">Privacy Policy</h1>
          </div>
        </div>

        {/* Content */}
        <div className="p-4">
          <div className="bg-white rounded-2xl p-6 space-y-6">
            <div>
              <p className="text-sm text-gray-500 mb-2">
                Last updated: January 2025
              </p>
              <p className="text-gray-600">
                This Privacy Policy describes how UBI Technologies, Inc.
                collects, uses, and shares information about you when you use
                our Driver application.
              </p>
            </div>

            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-3">
                1. Information We Collect
              </h2>
              <h3 className="font-semibold text-gray-800 mb-2">
                Information You Provide
              </h3>
              <ul className="list-disc list-inside text-gray-600 text-sm space-y-1 ml-2 mb-4">
                <li>Name, email, and phone number</li>
                <li>Driver&apos;s license information</li>
                <li>Vehicle registration and insurance details</li>
                <li>Bank account information for payments</li>
                <li>Profile photo</li>
                <li>Background check authorization</li>
              </ul>

              <h3 className="font-semibold text-gray-800 mb-2">
                Information We Collect Automatically
              </h3>
              <ul className="list-disc list-inside text-gray-600 text-sm space-y-1 ml-2">
                <li>GPS location data during trips</li>
                <li>Device information and identifiers</li>
                <li>App usage data and interactions</li>
                <li>Trip history and earnings</li>
                <li>Crash and error reports</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-3">
                2. How We Use Your Information
              </h2>
              <p className="text-gray-600 text-sm leading-relaxed mb-3">
                We use the information we collect to:
              </p>
              <ul className="list-disc list-inside text-gray-600 text-sm space-y-1 ml-2">
                <li>Verify your identity and eligibility to drive</li>
                <li>Match you with riders requesting trips</li>
                <li>Process payments and track earnings</li>
                <li>Provide customer support</li>
                <li>Ensure safety and prevent fraud</li>
                <li>Improve our services and develop new features</li>
                <li>Send important updates and notifications</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-3">
                3. Information Sharing
              </h2>
              <p className="text-gray-600 text-sm leading-relaxed mb-3">
                We may share your information with:
              </p>
              <ul className="list-disc list-inside text-gray-600 text-sm space-y-1 ml-2">
                <li>
                  <strong>Riders:</strong> Your name, photo, vehicle info, and
                  real-time location during trips
                </li>
                <li>
                  <strong>Payment processors:</strong> To process your earnings
                </li>
                <li>
                  <strong>Background check providers:</strong> To verify your
                  eligibility
                </li>
                <li>
                  <strong>Insurance providers:</strong> For claims processing
                </li>
                <li>
                  <strong>Law enforcement:</strong> When required by law or for
                  safety purposes
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-3">
                4. Location Data
              </h2>
              <p className="text-gray-600 text-sm leading-relaxed">
                We collect precise location data when you are online and
                available for trips, and during active trips. This data is
                essential for matching you with nearby riders, calculating
                fares, and ensuring safety. You can control location sharing
                through your device settings, but this may affect your ability
                to receive trip requests.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-3">
                5. Data Retention
              </h2>
              <p className="text-gray-600 text-sm leading-relaxed">
                We retain your information for as long as your account is active
                and for a reasonable period thereafter for legal, safety, and
                business purposes. Trip data is retained for 7 years for tax and
                regulatory compliance. You can request deletion of your data
                through the app settings.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-3">
                6. Data Security
              </h2>
              <p className="text-gray-600 text-sm leading-relaxed">
                We implement industry-standard security measures to protect your
                information, including encryption in transit and at rest, secure
                authentication, and regular security audits. However, no system
                is completely secure, and we cannot guarantee absolute security.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-3">
                7. Your Rights
              </h2>
              <p className="text-gray-600 text-sm leading-relaxed mb-3">
                Depending on your location, you may have the right to:
              </p>
              <ul className="list-disc list-inside text-gray-600 text-sm space-y-1 ml-2">
                <li>Access and download your personal data</li>
                <li>Correct inaccurate information</li>
                <li>Delete your account and data</li>
                <li>Opt out of certain data uses</li>
                <li>Port your data to another service</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-3">
                8. Children&apos;s Privacy
              </h2>
              <p className="text-gray-600 text-sm leading-relaxed">
                Our services are not intended for individuals under 21 years of
                age. We do not knowingly collect information from anyone under
                21. If we learn that we have collected information from someone
                under 21, we will delete it immediately.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-3">
                9. International Transfers
              </h2>
              <p className="text-gray-600 text-sm leading-relaxed">
                Your information may be transferred to and processed in
                countries other than your own. We ensure appropriate safeguards
                are in place for such transfers in compliance with applicable
                data protection laws.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-3">
                10. Updates to This Policy
              </h2>
              <p className="text-gray-600 text-sm leading-relaxed">
                We may update this Privacy Policy from time to time. We will
                notify you of material changes through the app or via email.
                Your continued use of the app after changes indicates acceptance
                of the updated policy.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-3">
                11. Contact Us
              </h2>
              <p className="text-gray-600 text-sm leading-relaxed">
                For questions about this Privacy Policy or your personal data,
                please contact our Data Protection Officer at:
              </p>
              <p className="text-gray-900 font-medium mt-2">privacy@ubi.com</p>
            </section>

            <div className="pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-400 text-center">
                © 2025 UBI Technologies, Inc. All rights reserved.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
