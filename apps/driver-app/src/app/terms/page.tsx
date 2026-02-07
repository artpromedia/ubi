"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";

export default function TermsOfServicePage() {
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
            <h1 className="text-xl font-bold text-white">Terms of Service</h1>
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
                Please read these Terms of Service carefully before using the
                UBI Driver application.
              </p>
            </div>

            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-3">
                1. Acceptance of Terms
              </h2>
              <p className="text-gray-600 text-sm leading-relaxed">
                By accessing or using the UBI Driver application, you agree to
                be bound by these Terms of Service and all applicable laws and
                regulations. If you do not agree with any of these terms, you
                are prohibited from using this application.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-3">
                2. Driver Requirements
              </h2>
              <p className="text-gray-600 text-sm leading-relaxed mb-3">
                To use the UBI Driver application, you must:
              </p>
              <ul className="list-disc list-inside text-gray-600 text-sm space-y-1 ml-2">
                <li>Be at least 21 years of age</li>
                <li>Hold a valid driver&apos;s license</li>
                <li>Have a clean driving record</li>
                <li>Pass a background check</li>
                <li>Have valid vehicle insurance</li>
                <li>Own or have access to an eligible vehicle</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-3">
                3. Service Description
              </h2>
              <p className="text-gray-600 text-sm leading-relaxed">
                UBI provides a technology platform that connects drivers with
                riders seeking transportation services. UBI does not provide
                transportation services directly and is not a transportation
                carrier. You acknowledge that UBI merely facilitates connections
                between independent contractors and riders.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-3">
                4. Driver Conduct
              </h2>
              <p className="text-gray-600 text-sm leading-relaxed mb-3">
                As a driver on the UBI platform, you agree to:
              </p>
              <ul className="list-disc list-inside text-gray-600 text-sm space-y-1 ml-2">
                <li>Maintain a professional and courteous demeanor</li>
                <li>Follow all traffic laws and regulations</li>
                <li>Keep your vehicle clean and well-maintained</li>
                <li>Not discriminate against riders</li>
                <li>Respect rider privacy and safety</li>
                <li>Not use the app while under the influence</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-3">
                5. Fees and Payment
              </h2>
              <p className="text-gray-600 text-sm leading-relaxed">
                UBI charges a service fee for each completed trip. The fee
                structure is clearly displayed in the app. Payments are
                processed weekly and deposited directly to your linked bank
                account. You are responsible for all applicable taxes on your
                earnings.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-3">
                6. Insurance
              </h2>
              <p className="text-gray-600 text-sm leading-relaxed">
                UBI provides supplemental insurance coverage during active
                trips. This coverage is secondary to your personal auto
                insurance. You must maintain the minimum insurance required by
                law in your jurisdiction.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-3">
                7. Termination
              </h2>
              <p className="text-gray-600 text-sm leading-relaxed">
                UBI reserves the right to deactivate or terminate your account
                at any time for violations of these terms, low ratings, safety
                concerns, or other reasons at our sole discretion. You may also
                terminate your account at any time through the app settings.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-3">
                8. Limitation of Liability
              </h2>
              <p className="text-gray-600 text-sm leading-relaxed">
                UBI shall not be liable for any indirect, incidental, special,
                consequential, or punitive damages arising from your use of the
                platform. Our total liability shall not exceed the amount of
                fees paid by you in the twelve months preceding the claim.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-3">
                9. Changes to Terms
              </h2>
              <p className="text-gray-600 text-sm leading-relaxed">
                UBI reserves the right to modify these terms at any time. We
                will notify you of significant changes through the app or via
                email. Continued use of the app after changes constitutes
                acceptance of the new terms.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-3">
                10. Contact Information
              </h2>
              <p className="text-gray-600 text-sm leading-relaxed">
                For questions about these Terms of Service, please contact us
                at:
              </p>
              <p className="text-gray-900 font-medium mt-2">legal@ubi.com</p>
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
