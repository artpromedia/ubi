"use client";

import { driverService } from "@/lib/driver-service";
import {
  AlertCircle,
  CheckCircle,
  ChevronLeft,
  Clock,
  Mail,
  MessageCircle,
  Phone,
  Send,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export default function SupportPage() {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contactOptions = [
    {
      icon: <Phone className="w-5 h-5" />,
      title: "Call Us",
      description: "Speak with a support agent",
      action: "tel:+1-800-UBI-HELP",
      info: "1-800-UBI-HELP",
    },
    {
      icon: <MessageCircle className="w-5 h-5" />,
      title: "Live Chat",
      description: "Chat with our support team",
      action: "/chat",
      info: "Available 24/7",
    },
    {
      icon: <Mail className="w-5 h-5" />,
      title: "Email Us",
      description: "Get a response within 24 hours",
      action: "mailto:support@ubi.com",
      info: "support@ubi.com",
    },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await driverService.submitSupportTicket({
        subject,
        message,
      });

      if (response.success) {
        setSubmitted(true);
      } else {
        setError(response.error?.message || "Failed to submit ticket");
      }
    } catch (err) {
      console.error("Failed to submit support ticket:", err);
      setError("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-8 text-center max-w-sm w-full">
          <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            Message Sent!
          </h2>
          <p className="text-gray-600 mb-6">
            We&apos;ve received your message and will get back to you within 24
            hours.
          </p>
          <Link
            href="/settings"
            className="block w-full bg-ubi-black text-white rounded-xl py-3 font-semibold"
          >
            Back to Settings
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <div className="mx-auto w-full max-w-lg lg:max-w-md">
        {/* Header */}
        <div className="bg-ubi-black px-4 pb-6 pt-12 safe-area-top">
          <div className="flex items-center gap-4">
            <Link
              href="/settings"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
            >
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-xl font-bold text-white">Contact Support</h1>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-6">
          {/* Quick Contact Options */}
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 px-1">
              Get in Touch
            </h2>
            <div className="bg-white rounded-2xl overflow-hidden divide-y divide-gray-100">
              {contactOptions.map((option) => (
                <a
                  key={option.title}
                  href={option.action}
                  className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600">
                      {option.icon}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">
                        {option.title}
                      </p>
                      <p className="text-sm text-gray-500">
                        {option.description}
                      </p>
                    </div>
                  </div>
                  <span className="text-sm text-ubi-green font-medium">
                    {option.info}
                  </span>
                </a>
              ))}
            </div>
          </div>

          {/* Support Hours */}
          <div className="bg-blue-50 rounded-xl p-4 flex items-start gap-3">
            <Clock className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-blue-900">Support Hours</p>
              <p className="text-sm text-blue-700">
                Phone support: Mon-Fri 8AM-8PM, Sat-Sun 9AM-6PM
              </p>
              <p className="text-sm text-blue-700">
                Live chat &amp; email: Available 24/7
              </p>
            </div>
          </div>

          {/* Contact Form */}
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 px-1">
              Send a Message
            </h2>

            {/* Error message */}
            {error && (
              <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-red-700">
                <AlertCircle className="h-5 w-5" />
                <span>{error}</span>
              </div>
            )}

            <form
              onSubmit={handleSubmit}
              className="bg-white rounded-2xl p-4 space-y-4"
            >
              <div>
                <label
                  htmlFor="support-subject"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  Subject
                </label>
                <select
                  id="support-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-ubi-black"
                  required
                >
                  <option value="">Select a topic</option>
                  <option value="trip">Trip Issue</option>
                  <option value="payment">Payment Problem</option>
                  <option value="account">Account Help</option>
                  <option value="app">App Bug/Issue</option>
                  <option value="safety">Safety Concern</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="support-message"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  Message
                </label>
                <textarea
                  id="support-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-ubi-black resize-none"
                  placeholder="Describe your issue in detail..."
                  required
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting || !subject || !message}
                className="w-full bg-ubi-black text-white rounded-xl py-4 font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  "Sending..."
                ) : (
                  <>
                    <Send className="w-5 h-5" />
                    Send Message
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
