"use client";

import { motion } from "framer-motion";
import {
  Users,
  Car,
  UtensilsCrossed,
  Package,
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Activity,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { formatNumber, formatCurrency, cn } from "@/lib/utils";

// Mock data - replace with real API calls
const stats = [
  {
    name: "Total Users",
    value: 10_456_782,
    change: 12.5,
    icon: Users,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
  },
  {
    name: "Active Rides",
    value: 23_456,
    change: 8.2,
    icon: Car,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
  },
  {
    name: "Food Orders",
    value: 8_234,
    change: -3.1,
    icon: UtensilsCrossed,
    color: "text-orange-500",
    bgColor: "bg-orange-500/10",
  },
  {
    name: "Deliveries",
    value: 4_567,
    change: 15.3,
    icon: Package,
    color: "text-cyan-500",
    bgColor: "bg-cyan-500/10",
  },
];

const revenueData = [
  { date: "Jan", revenue: 2400000, rides: 1200000, food: 800000, delivery: 400000 },
  { date: "Feb", revenue: 2800000, rides: 1400000, food: 900000, delivery: 500000 },
  { date: "Mar", revenue: 3200000, rides: 1600000, food: 1000000, delivery: 600000 },
  { date: "Apr", revenue: 2900000, rides: 1450000, food: 950000, delivery: 500000 },
  { date: "May", revenue: 3500000, rides: 1750000, food: 1100000, delivery: 650000 },
  { date: "Jun", revenue: 4000000, rides: 2000000, food: 1300000, delivery: 700000 },
];

const recentAlerts = [
  {
    id: 1,
    type: "fraud",
    title: "Suspicious payment activity",
    description: "Multiple failed transactions from same IP",
    time: "5 mins ago",
    severity: "high",
  },
  {
    id: 2,
    type: "safety",
    title: "SOS triggered",
    description: "Emergency alert from ride #R-456789",
    time: "12 mins ago",
    severity: "critical",
  },
  {
    id: 3,
    type: "system",
    title: "API latency spike",
    description: "Ride service response time exceeded 500ms",
    time: "25 mins ago",
    severity: "medium",
  },
  {
    id: 4,
    type: "support",
    title: "High ticket volume",
    description: "Support queue exceeded 100 tickets",
    time: "1 hour ago",
    severity: "low",
  },
];

const topDrivers = [
  { name: "Chukwuemeka O.", trips: 156, rating: 4.98, earnings: 485000 },
  { name: "Amara K.", trips: 142, rating: 4.96, earnings: 438000 },
  { name: "David N.", trips: 138, rating: 4.95, earnings: 425000 },
  { name: "Grace A.", trips: 131, rating: 4.94, earnings: 398000 },
  { name: "Ibrahim M.", trips: 127, rating: 4.93, earnings: 385000 },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 mt-1">
            Welcome back! Here's what's happening today.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className="px-4 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-green-500">
            <option>Last 24 hours</option>
            <option>Last 7 days</option>
            <option>Last 30 days</option>
            <option>This month</option>
          </select>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, index) => (
          <motion.div
            key={stat.name}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="admin-stat-card"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-400">{stat.name}</p>
                <p className="mt-2 text-2xl font-bold text-white">
                  {formatNumber(stat.value)}
                </p>
              </div>
              <div className={cn("p-2 rounded-lg", stat.bgColor)}>
                <stat.icon className={cn("w-5 h-5", stat.color)} />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-1">
              {stat.change >= 0 ? (
                <TrendingUp className="w-4 h-4 text-green-500" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-500" />
              )}
              <span
                className={cn(
                  "text-sm font-medium",
                  stat.change >= 0 ? "text-green-500" : "text-red-500"
                )}
              >
                {Math.abs(stat.change)}%
              </span>
              <span className="text-sm text-gray-500">vs last period</span>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue Chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="admin-card lg:col-span-2"
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-white">Revenue Overview</h2>
              <p className="text-sm text-gray-400 mt-1">
                Total: {formatCurrency(18_800_000)}
              </p>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span className="text-gray-400">Rides</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-orange-500" />
                <span className="text-gray-400">Food</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-cyan-500" />
                <span className="text-gray-400">Delivery</span>
              </div>
            </div>
          </div>

          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueData}>
                <defs>
                  <linearGradient id="colorRides" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorFood" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorDelivery" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="date" stroke="#6b7280" fontSize={12} />
                <YAxis
                  stroke="#6b7280"
                  fontSize={12}
                  tickFormatter={(value) => `₦${(value / 1000000).toFixed(1)}M`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#111827",
                    border: "1px solid #374151",
                    borderRadius: "0.5rem",
                  }}
                  labelStyle={{ color: "#f9fafb" }}
                  formatter={(value: number) => [formatCurrency(value), ""]}
                />
                <Area
                  type="monotone"
                  dataKey="rides"
                  stroke="#22c55e"
                  fillOpacity={1}
                  fill="url(#colorRides)"
                />
                <Area
                  type="monotone"
                  dataKey="food"
                  stroke="#f97316"
                  fillOpacity={1}
                  fill="url(#colorFood)"
                />
                <Area
                  type="monotone"
                  dataKey="delivery"
                  stroke="#06b6d4"
                  fillOpacity={1}
                  fill="url(#colorDelivery)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Live Activity */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="admin-card"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Live Activity</h2>
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              <span className="text-xs text-gray-400">Live</span>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-gray-900 rounded-lg">
              <div className="flex items-center gap-3">
                <Activity className="w-5 h-5 text-green-500" />
                <div>
                  <p className="text-sm font-medium text-white">Active Rides</p>
                  <p className="text-xs text-gray-400">Right now</p>
                </div>
              </div>
              <span className="text-xl font-bold text-white">23,456</span>
            </div>

            <div className="flex items-center justify-between p-3 bg-gray-900 rounded-lg">
              <div className="flex items-center gap-3">
                <Activity className="w-5 h-5 text-orange-500" />
                <div>
                  <p className="text-sm font-medium text-white">Food Orders</p>
                  <p className="text-xs text-gray-400">In progress</p>
                </div>
              </div>
              <span className="text-xl font-bold text-white">8,234</span>
            </div>

            <div className="flex items-center justify-between p-3 bg-gray-900 rounded-lg">
              <div className="flex items-center gap-3">
                <Activity className="w-5 h-5 text-cyan-500" />
                <div>
                  <p className="text-sm font-medium text-white">Deliveries</p>
                  <p className="text-xs text-gray-400">En route</p>
                </div>
              </div>
              <span className="text-xl font-bold text-white">4,567</span>
            </div>

            <div className="flex items-center justify-between p-3 bg-gray-900 rounded-lg">
              <div className="flex items-center gap-3">
                <DollarSign className="w-5 h-5 text-blue-500" />
                <div>
                  <p className="text-sm font-medium text-white">Revenue Today</p>
                  <p className="text-xs text-gray-400">All services</p>
                </div>
              </div>
              <span className="text-lg font-bold text-white">₦156.8M</span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Alerts */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="admin-card"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Recent Alerts</h2>
            <Link
              href="/alerts"
              className="text-sm text-green-500 hover:text-green-400 flex items-center gap-1"
            >
              View all
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="space-y-3">
            {recentAlerts.map((alert) => (
              <div
                key={alert.id}
                className="flex items-start gap-3 p-3 rounded-lg bg-gray-900 hover:bg-gray-800 transition cursor-pointer"
              >
                <div
                  className={cn(
                    "p-2 rounded-lg",
                    alert.severity === "critical" && "bg-red-500/20",
                    alert.severity === "high" && "bg-orange-500/20",
                    alert.severity === "medium" && "bg-yellow-500/20",
                    alert.severity === "low" && "bg-blue-500/20"
                  )}
                >
                  <AlertTriangle
                    className={cn(
                      "w-4 h-4",
                      alert.severity === "critical" && "text-red-500",
                      alert.severity === "high" && "text-orange-500",
                      alert.severity === "medium" && "text-yellow-500",
                      alert.severity === "low" && "text-blue-500"
                    )}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">{alert.title}</p>
                  <p className="text-xs text-gray-400 truncate">
                    {alert.description}
                  </p>
                </div>
                <span className="text-xs text-gray-500 flex-shrink-0">
                  {alert.time}
                </span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Top Drivers */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="admin-card"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Top Drivers This Week</h2>
            <Link
              href="/users/drivers"
              className="text-sm text-green-500 hover:text-green-400 flex items-center gap-1"
            >
              View all
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Driver</th>
                  <th>Trips</th>
                  <th>Rating</th>
                  <th className="text-right">Earnings</th>
                </tr>
              </thead>
              <tbody>
                {topDrivers.map((driver, index) => (
                  <tr key={driver.name}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white text-xs font-medium">
                          #{index + 1}
                        </div>
                        <span className="font-medium text-white">{driver.name}</span>
                      </div>
                    </td>
                    <td className="text-gray-300">{driver.trips}</td>
                    <td>
                      <span className="flex items-center gap-1">
                        <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                        <span className="text-gray-300">{driver.rating}</span>
                      </span>
                    </td>
                    <td className="text-right text-gray-300">
                      {formatCurrency(driver.earnings)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
