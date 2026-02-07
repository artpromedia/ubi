"use client";

import {
  ChevronLeft,
  ChevronRight,
  FileText,
  HelpCircle,
  MessageCircle,
  Phone,
  Shield,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

const helpCategories = [
  {
    icon: <MessageCircle className="h-6 w-6" />,
    title: "Live Chat",
    description: "Chat with our support team",
    href: "/help/chat",
    available: true,
  },
  {
    icon: <Phone className="h-6 w-6" />,
    title: "Call Support",
    description: "24/7 driver support line",
    href: "tel:+254800123456",
    available: true,
  },
  {
    icon: <FileText className="h-6 w-6" />,
    title: "Report an Issue",
    description: "Report problems with trips or app",
    href: "/help/report",
    available: true,
  },
  {
    icon: <Shield className="h-6 w-6" />,
    title: "Safety Center",
    description: "Emergency assistance and safety tools",
    href: "/help/safety",
    available: true,
  },
];

const faqItems = [
  {
    question: "How do I receive trip requests?",
    answer:
      "Go online by tapping the status toggle on your dashboard. You'll receive requests when riders nearby need a ride.",
  },
  {
    question: "When do I get paid?",
    answer:
      "Earnings are automatically transferred to your M-Pesa every Monday. You can also request instant cashout for a small fee.",
  },
  {
    question: "What if a rider cancels?",
    answer:
      "If a rider cancels after you've arrived at pickup, you may receive a cancellation fee. This will appear in your earnings.",
  },
  {
    question: "How do I update my documents?",
    answer:
      "Go to Profile > Documents to upload or update your driver license, insurance, and other required documents.",
  },
  {
    question: "How is my rating calculated?",
    answer:
      "Your rating is the average of your last 500 trip ratings. Maintain excellent service to keep your rating high.",
  },
];

export default function HelpPage() {
  const searchParams = useSearchParams();
  const tripId = searchParams.get("tripId");

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <div className="mx-auto w-full max-w-lg lg:max-w-md">
        {/* Header */}
        <div className="bg-ubi-black px-4 pb-6 pt-12">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
            >
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-xl font-bold text-white">Help & Support</h1>
          </div>
        </div>

        <div className="px-4 py-6 space-y-6">
          {/* Trip Context */}
          {tripId && (
            <div className="rounded-xl bg-primary/10 border border-primary/20 p-4">
              <p className="text-sm font-medium text-primary">
                Getting help for Trip #{tripId}
              </p>
              <p className="text-xs text-gray-600 mt-1">
                Our support team will have access to your trip details.
              </p>
            </div>
          )}

          {/* Contact Options */}
          <div className="rounded-xl bg-white shadow-sm overflow-hidden">
            <h2 className="px-4 pt-4 font-bold text-gray-900">Contact Us</h2>
            <div className="mt-3">
              {helpCategories.map((category, index) => (
                <Link
                  key={category.title}
                  href={category.href}
                  className={`flex items-center gap-4 p-4 hover:bg-gray-50 ${
                    index < helpCategories.length - 1
                      ? "border-b border-gray-100"
                      : ""
                  }`}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    {category.icon}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">
                      {category.title}
                    </p>
                    <p className="text-sm text-gray-500">
                      {category.description}
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-gray-400" />
                </Link>
              ))}
            </div>
          </div>

          {/* FAQ */}
          <div>
            <h2 className="mb-3 font-bold text-gray-900">
              Frequently Asked Questions
            </h2>
            <div className="space-y-3">
              {faqItems.map((item) => (
                <details
                  key={item.question}
                  className="group rounded-xl bg-white shadow-sm"
                >
                  <summary className="flex cursor-pointer items-center justify-between p-4 font-medium text-gray-900">
                    <span className="flex items-center gap-3">
                      <HelpCircle className="h-5 w-5 text-primary" />
                      {item.question}
                    </span>
                    <ChevronRight className="h-5 w-5 text-gray-400 transition-transform group-open:rotate-90" />
                  </summary>
                  <div className="px-4 pb-4 text-sm text-gray-600">
                    {item.answer}
                  </div>
                </details>
              ))}
            </div>
          </div>

          {/* Emergency */}
          <div className="rounded-xl bg-red-50 border border-red-200 p-4">
            <h3 className="font-bold text-red-800">Emergency?</h3>
            <p className="text-sm text-red-700 mt-1">
              If you're in immediate danger, call emergency services:
            </p>
            <a
              href="tel:999"
              className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-red-600 py-3 font-bold text-white"
            >
              <Phone className="h-5 w-5" />
              Call 999
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
