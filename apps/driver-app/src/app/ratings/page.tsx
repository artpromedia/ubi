"use client";

import { useDriverStore } from "@/store/driver-store";
import {
  ChevronLeft,
  MessageCircle,
  Star,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";

// Mock ratings data
const ratingBreakdown = {
  5: 850,
  4: 280,
  3: 80,
  2: 25,
  1: 15,
};

const recentReviews = [
  {
    id: "1",
    rating: 5,
    comment: "Very professional driver, car was clean and ride was smooth.",
    riderName: "Sarah M.",
    date: "2026-01-30",
    tripType: "ride",
  },
  {
    id: "2",
    rating: 5,
    comment: "Quick and efficient delivery. Thank you!",
    riderName: "Food Order",
    date: "2026-01-30",
    tripType: "delivery",
  },
  {
    id: "3",
    rating: 4,
    comment: "Good ride, arrived on time.",
    riderName: "John K.",
    date: "2026-01-29",
    tripType: "ride",
  },
  {
    id: "4",
    rating: 5,
    comment: null,
    riderName: "Mary W.",
    date: "2026-01-29",
    tripType: "ride",
  },
  {
    id: "5",
    rating: 3,
    comment: "Driver took a longer route than expected.",
    riderName: "Peter O.",
    date: "2026-01-28",
    tripType: "ride",
  },
];

const tags = [
  { label: "Great Navigation", count: 450, positive: true },
  { label: "Clean Vehicle", count: 380, positive: true },
  { label: "Friendly", count: 320, positive: true },
  { label: "On Time", count: 290, positive: true },
  { label: "Safe Driver", count: 250, positive: true },
  { label: "Needs Improvement", count: 15, positive: false },
];

export default function RatingsPage() {
  const { profile } = useDriverStore();
  const totalRatings = Object.values(ratingBreakdown).reduce(
    (a, b) => a + b,
    0,
  );

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <div className="mx-auto w-full max-w-lg lg:max-w-md">
        {/* Header */}
        <div className="bg-gradient-to-br from-yellow-400 to-yellow-500 px-4 pb-8 pt-12 safe-area-top">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-black/10 text-white"
            >
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-xl font-bold text-white">Ratings & Reviews</h1>
          </div>

          {/* Overall Rating */}
          <div className="mt-6 flex items-center justify-center gap-4">
            <div className="text-center">
              <div className="flex items-center justify-center gap-2">
                <Star className="h-10 w-10 fill-white text-white" />
                <span className="text-5xl font-bold text-white">
                  {profile?.rating || 0}
                </span>
              </div>
              <p className="mt-1 text-white/80">
                Based on {totalRatings.toLocaleString()} ratings
              </p>
            </div>
          </div>
        </div>

        <div className="px-4 py-6 space-y-6">
          {/* Rating Breakdown */}
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-4 font-bold text-gray-900">Rating Breakdown</h2>
            <div className="space-y-3">
              {[5, 4, 3, 2, 1].map((stars) => {
                const count =
                  ratingBreakdown[stars as keyof typeof ratingBreakdown];
                const percentage = (count / totalRatings) * 100;

                return (
                  <div key={stars} className="flex items-center gap-3">
                    <div className="flex w-12 items-center gap-1">
                      <span className="text-sm font-medium text-gray-700">
                        {stars}
                      </span>
                      <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                    </div>
                    <div className="flex-1 h-3 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-yellow-400"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                    <span className="w-12 text-right text-sm text-gray-500">
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tags */}
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-4 font-bold text-gray-900">What Riders Say</h2>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <div
                  key={tag.label}
                  className={`flex items-center gap-1 rounded-full px-3 py-1.5 ${
                    tag.positive
                      ? "bg-green-50 text-green-700"
                      : "bg-red-50 text-red-700"
                  }`}
                >
                  {tag.positive ? (
                    <ThumbsUp className="h-3 w-3" />
                  ) : (
                    <ThumbsDown className="h-3 w-3" />
                  )}
                  <span className="text-sm font-medium">{tag.label}</span>
                  <span className="text-sm opacity-60">({tag.count})</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Reviews */}
          <div>
            <h2 className="mb-3 font-bold text-gray-900">Recent Reviews</h2>
            <div className="space-y-3">
              {recentReviews.map((review) => (
                <div
                  key={review.id}
                  className="rounded-xl bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="flex">
                          {[1, 2, 3, 4, 5].map((starIndex) => (
                            <Star
                              key={`star-${review.id}-${starIndex}`}
                              className={`h-4 w-4 ${
                                starIndex <= review.rating
                                  ? "fill-yellow-400 text-yellow-400"
                                  : "text-gray-200"
                              }`}
                            />
                          ))}
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            review.tripType === "ride"
                              ? "bg-primary/10 text-primary"
                              : "bg-orange-100 text-orange-600"
                          }`}
                        >
                          {review.tripType === "ride" ? "Ride" : "Delivery"}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-gray-500">
                        {review.riderName} •{" "}
                        {new Date(review.date).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  {review.comment && (
                    <div className="mt-3 flex items-start gap-2">
                      <MessageCircle className="mt-0.5 h-4 w-4 text-gray-400" />
                      <p className="text-sm text-gray-600">{review.comment}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Tips Card */}
          <div className="rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 p-4 border border-primary/20">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20">
                <TrendingUp className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-gray-900">Improve Your Rating</p>
                <ul className="mt-2 space-y-1 text-sm text-gray-600">
                  <li>• Keep your vehicle clean and comfortable</li>
                  <li>• Follow the navigation for the best route</li>
                  <li>• Be friendly and professional</li>
                  <li>• Arrive on time for pickups</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
