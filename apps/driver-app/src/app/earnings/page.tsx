"use client";

import { useDriverEarnings } from "@/lib/hooks";
import {
  Car,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Download,
  TrendingUp,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

// Fallback mock earnings data (used when API is unavailable)
const mockEarnings = {
  today: {
    total: 4850,
    trips: 8,
    hours: 6.5,
    tips: 350,
    bonus: 200,
    hourly: [
      { hour: "6am", amount: 0 },
      { hour: "7am", amount: 450 },
      { hour: "8am", amount: 680 },
      { hour: "9am", amount: 520 },
      { hour: "10am", amount: 380 },
      { hour: "11am", amount: 650 },
      { hour: "12pm", amount: 420 },
      { hour: "1pm", amount: 580 },
      { hour: "2pm", amount: 720 },
      { hour: "3pm", amount: 450 },
    ],
  },
  week: {
    total: 28500,
    trips: 45,
    hours: 38,
    tips: 2100,
    bonus: 1500,
    daily: [
      { day: "Mon", amount: 4200 },
      { day: "Tue", amount: 3800 },
      { day: "Wed", amount: 4500 },
      { day: "Thu", amount: 3200 },
      { day: "Fri", amount: 5100 },
      { day: "Sat", amount: 4850 },
      { day: "Sun", amount: 2850 },
    ],
  },
  month: {
    total: 112500,
    trips: 180,
    hours: 152,
    tips: 8500,
    bonus: 6000,
    weekly: [
      { week: "Week 1", amount: 26500 },
      { week: "Week 2", amount: 28000 },
      { week: "Week 3", amount: 29500 },
      { week: "Week 4", amount: 28500 },
    ],
  },
};

const incentives = [
  {
    id: "1",
    title: "Complete 10 trips",
    description: "Earn KES 500 bonus",
    progress: 8,
    target: 10,
    reward: 500,
  },
  {
    id: "2",
    title: "Peak hours bonus",
    description: "Drive during 6-9am",
    progress: 2,
    target: 3,
    reward: 300,
  },
  {
    id: "3",
    title: "5-star rating",
    description: "Maintain 4.8+ rating",
    progress: 1,
    target: 1,
    reward: 200,
    completed: true,
  },
];

type Period = "day" | "week" | "month";

const getPeriodLabel = (p: Period): string => {
  switch (p) {
    case "day":
      return "Today";
    case "week":
      return "This Week";
    case "month":
      return "This Month";
  }
};

export default function EarningsPage() {
  const [period, setPeriod] = useState<Period>("day");

  // Fetch earnings from API
  const { data: apiEarnings, isLoading } = useDriverEarnings(period);

  // Use API data if available, otherwise fall back to mock data
  const periodKey = period === "day" ? "today" : period;
  const mockData = mockEarnings[periodKey];

  // Helper to get chart data based on period
  const getChartData = () => {
    if (apiEarnings) {
      return apiEarnings.breakdown.map((item) => ({
        label: item.label,
        amount: item.amount,
      }));
    }
    if ("hourly" in mockData) {
      return mockData.hourly.map((h) => ({ label: h.hour, amount: h.amount }));
    }
    if ("daily" in mockData) {
      return mockData.daily.map((d) => ({ label: d.day, amount: d.amount }));
    }
    return mockData.weekly.map((w) => ({ label: w.week, amount: w.amount }));
  };

  const chartData = getChartData();
  const data = apiEarnings || mockData;
  const maxChartValue = Math.max(...chartData.map((item) => item.amount), 1);

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <div className="mx-auto w-full max-w-lg lg:max-w-md">
        {/* Header */}
        <div className="bg-gradient-to-br from-primary to-primary-600 px-4 pb-8 pt-12 safe-area-top">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/dashboard"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white"
              >
                <ChevronLeft className="h-5 w-5" />
              </Link>
              <h1 className="text-xl font-bold text-white">Earnings</h1>
            </div>
            <Link
              href="/trips"
              className="flex items-center gap-1 rounded-full bg-white/20 px-3 py-2 text-sm font-medium text-white"
            >
              <Clock className="h-4 w-4" />
              History
            </Link>
          </div>

          {/* Period Tabs */}
          <div className="mt-6 flex rounded-xl bg-white/20 p-1">
            {(["day", "week", "month"] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
                  period === p
                    ? "bg-white text-primary"
                    : "text-white/80 hover:text-white"
                }`}
              >
                {getPeriodLabel(p)}
              </button>
            ))}
          </div>

          {/* Total Earnings */}
          <div className="mt-6 text-center">
            {isLoading ? (
              <div className="animate-pulse">
                <div className="h-4 w-24 bg-white/30 rounded mx-auto mb-2" />
                <div className="h-10 w-40 bg-white/30 rounded mx-auto" />
              </div>
            ) : (
              <>
                <p className="text-white/80">Total Earnings</p>
                <p className="mt-1 text-4xl font-bold text-white">
                  KES {data.total.toLocaleString()}
                </p>
              </>
            )}
          </div>
        </div>

        {/* Chart */}
        <div className="-mt-4 mx-4 rounded-xl bg-white p-4 shadow-lg">
          <div className="flex h-40 items-end justify-between gap-1">
            {chartData.map((item, idx) => (
              <div
                key={item.label || idx}
                className="flex flex-1 flex-col items-center gap-1"
              >
                <div
                  className="w-full rounded-t bg-primary/20 transition-all hover:bg-primary/30"
                  style={{
                    height: `${(item.amount / maxChartValue) * 100}%`,
                    minHeight: "4px",
                  }}
                >
                  <div
                    className="w-full rounded-t bg-primary"
                    style={{
                      height: `${(item.amount / maxChartValue) * 100}%`,
                      minHeight: "4px",
                    }}
                  />
                </div>
                <span className="text-xs text-gray-500">{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="mt-6 grid grid-cols-2 gap-4 px-4">
          <StatCard
            icon={<Car className="h-5 w-5 text-primary" />}
            label="Trips"
            value={data.trips.toString()}
          />
          <StatCard
            icon={<Clock className="h-5 w-5 text-primary" />}
            label="Hours"
            value={`${data.hours}h`}
          />
          <StatCard
            icon={<TrendingUp className="h-5 w-5 text-green-500" />}
            label="Tips"
            value={`KES ${data.tips.toLocaleString()}`}
          />
          <StatCard
            icon={<Wallet className="h-5 w-5 text-yellow-500" />}
            label="Bonus"
            value={`KES ${data.bonus.toLocaleString()}`}
          />
        </div>

        {/* Quick Actions */}
        <div className="mt-6 px-4">
          <div className="flex gap-3">
            <Link
              href="/payouts"
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-4 font-medium text-white"
            >
              <CreditCard className="h-5 w-5" />
              Cash Out
            </Link>
            <button className="flex items-center justify-center gap-2 rounded-xl bg-gray-100 px-6 py-4 font-medium text-gray-700">
              <Download className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Incentives */}
        <div className="mt-6 px-4">
          <h2 className="mb-4 text-lg font-bold text-gray-900">
            Incentives & Bonuses
          </h2>
          <div className="space-y-3">
            {incentives.map((incentive) => (
              <IncentiveCard key={incentive.id} incentive={incentive} />
            ))}
          </div>
        </div>

        {/* Payout History Link */}
        <div className="mt-6 px-4">
          <Link
            href="/payouts/history"
            className="flex items-center justify-between rounded-xl bg-white p-4 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                <CreditCard className="h-5 w-5 text-gray-600" />
              </div>
              <div>
                <p className="font-medium text-gray-900">Payout History</p>
                <p className="text-sm text-gray-500">View past withdrawals</p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-gray-400" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: Readonly<{
  icon: React.ReactNode;
  label: string;
  value: string;
}>) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm text-gray-500">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}

function IncentiveCard({
  incentive,
}: Readonly<{ incentive: (typeof incentives)[0] }>) {
  const progress = (incentive.progress / incentive.target) * 100;

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-medium text-gray-900">{incentive.title}</p>
          <p className="text-sm text-gray-500">{incentive.description}</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-sm font-medium ${
            incentive.completed
              ? "bg-green-100 text-green-600"
              : "bg-primary/10 text-primary"
          }`}
        >
          {incentive.completed ? "Earned" : `+KES ${incentive.reward}`}
        </span>
      </div>
      <div className="mt-3">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">
            {incentive.progress}/{incentive.target}
          </span>
          <span className="font-medium text-primary">
            {progress.toFixed(0)}%
          </span>
        </div>
        <div className="mt-1 h-2 rounded-full bg-gray-100">
          <div
            className={`h-full rounded-full transition-all ${
              incentive.completed ? "bg-green-500" : "bg-primary"
            }`}
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
