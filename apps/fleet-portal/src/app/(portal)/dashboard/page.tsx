"use client";

import { motion } from "framer-motion";
import {
  Users,
  Car,
  DollarSign,
  TrendingUp,
  TrendingDown,
  MapPin,
  Star,
  Clock,
  AlertTriangle,
  ChevronRight,
  Activity,
} from "lucide-react";
import Link from "next/link";
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";
import { formatCurrency, formatNumber, cn, getDriverStatusClass, getAcceptanceRateColor } from "@/lib/utils";

// Mock data
const stats = [
  {
    name: "Active Drivers",
    value: 156,
    total: 342,
    change: 8.5,
    icon: Users,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
  },
  {
    name: "Vehicles",
    value: 298,
    total: 320,
    change: 2.1,
    icon: Car,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
  },
  {
    name: "Today's Earnings",
    value: 4250000,
    total: null,
    change: 15.3,
    icon: DollarSign,
    color: "text-yellow-500",
    bgColor: "bg-yellow-500/10",
  },
  {
    name: "Avg Rating",
    value: 4.82,
    total: null,
    change: 1.2,
    icon: Star,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
  },
];

const driverPerformance = [
  { name: "Mon", trips: 456, earnings: 680000 },
  { name: "Tue", trips: 523, earnings: 785000 },
  { name: "Wed", trips: 498, earnings: 747000 },
  { name: "Thu", trips: 612, earnings: 918000 },
  { name: "Fri", trips: 701, earnings: 1051500 },
  { name: "Sat", trips: 756, earnings: 1134000 },
  { name: "Sun", trips: 589, earnings: 883500 },
];

const topDrivers = [
  {
    name: "Chukwuemeka O.",
    trips: 23,
    earnings: 68500,
    rating: 4.98,
    status: "online",
    acceptanceRate: 95,
  },
  {
    name: "Amara K.",
    trips: 21,
    earnings: 62300,
    rating: 4.96,
    status: "busy",
    acceptanceRate: 92,
  },
  {
    name: "David N.",
    trips: 19,
    earnings: 58100,
    rating: 4.95,
    status: "online",
    acceptanceRate: 88,
  },
  {
    name: "Grace A.",
    trips: 18,
    earnings: 54800,
    rating: 4.94,
    status: "online",
    acceptanceRate: 91,
  },
  {
    name: "Ibrahim M.",
    trips: 17,
    earnings: 51200,
    rating: 4.93,
    status: "offline",
    acceptanceRate: 85,
  },
];

const alerts = [
  {
    id: 1,
    type: "incident",
    title: "Minor accident reported",
    driver: "John D.",
    vehicle: "LAG-234-XY",
    time: "15 min ago",
    severity: "medium",
  },
  {
    id: 2,
    type: "maintenance",
    title: "Vehicle maintenance due",
    driver: "Sarah M.",
    vehicle: "LAG-567-AB",
    time: "2 hours ago",
    severity: "low",
  },
  {
    id: 3,
    type: "document",
    title: "License expiring soon",
    driver: "Peter O.",
    vehicle: "LAG-890-CD",
    time: "1 day ago",
    severity: "high",
  },
];

const liveDrivers = [
  { id: 1, name: "Driver 1", lat: 6.5244, lng: 3.3792, status: "online" },
  { id: 2, name: "Driver 2", lat: 6.5344, lng: 3.3892, status: "busy" },
  { id: 3, name: "Driver 3", lat: 6.5144, lng: 3.3692, status: "online" },
  { id: 4, name: "Driver 4", lat: 6.5044, lng: 3.3992, status: "online" },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Fleet Dashboard</h1>
          <p className="text-gray-400 mt-1">
            Monitor your drivers and vehicles in real-time
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className="px-4 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-green-500">
            <option>Today</option>
            <option>Yesterday</option>
            <option>Last 7 days</option>
            <option>This month</option>
          </select>
          <Link
            href="/map"
            className="px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 transition flex items-center gap-2"
          >
            <MapPin className="w-4 h-4" />
            Live Map
          </Link>
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
            className="fleet-stat-card"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-400">{stat.name}</p>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-white">
                    {stat.name === "Today's Earnings"
                      ? formatCurrency(stat.value)
                      : stat.value}
                  </span>
                  {stat.total && (
                    <span className="text-sm text-gray-500">/ {stat.total}</span>
                  )}
                </div>
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
              <span className="text-sm text-gray-500">vs yesterday</span>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Weekly Performance Chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="fleet-card lg:col-span-2"
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-white">
                Weekly Performance
              </h2>
              <p className="text-sm text-gray-400 mt-1">
                Trips and earnings this week
              </p>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span className="text-gray-400">Trips</span>
              </div>
            </div>
          </div>

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={driverPerformance}>
                <XAxis dataKey="name" stroke="#6b7280" fontSize={12} />
                <YAxis stroke="#6b7280" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#111827",
                    border: "1px solid #374151",
                    borderRadius: "0.5rem",
                  }}
                  labelStyle={{ color: "#f9fafb" }}
                  formatter={(value: number, name: string) => [
                    name === "earnings" ? formatCurrency(value) : value,
                    name === "earnings" ? "Earnings" : "Trips",
                  ]}
                />
                <Bar dataKey="trips" radius={[4, 4, 0, 0]}>
                  {driverPerformance.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={index === driverPerformance.length - 2 ? "#22c55e" : "#1f2937"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Alerts */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="fleet-card"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Alerts</h2>
            <Link
              href="/incidents"
              className="text-sm text-green-500 hover:text-green-400 flex items-center gap-1"
            >
              View all
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="space-y-3">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={cn(
                  "p-3 rounded-lg bg-gray-900 border-l-4",
                  alert.severity === "high" && "border-l-red-500",
                  alert.severity === "medium" && "border-l-yellow-500",
                  alert.severity === "low" && "border-l-blue-500"
                )}
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle
                    className={cn(
                      "w-4 h-4 mt-0.5 flex-shrink-0",
                      alert.severity === "high" && "text-red-500",
                      alert.severity === "medium" && "text-yellow-500",
                      alert.severity === "low" && "text-blue-500"
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white">
                      {alert.title}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {alert.driver} • {alert.vehicle}
                    </p>
                  </div>
                  <span className="text-xs text-gray-500">{alert.time}</span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Bottom Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Drivers */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="fleet-card"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">
              Top Drivers Today
            </h2>
            <Link
              href="/drivers/performance"
              className="text-sm text-green-500 hover:text-green-400 flex items-center gap-1"
            >
              View all
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="space-y-3">
            {topDrivers.map((driver, index) => (
              <div
                key={driver.name}
                className="flex items-center gap-4 p-3 bg-gray-900 rounded-lg"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white text-sm font-medium">
                  #{index + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white truncate">
                      {driver.name}
                    </p>
                    <span
                      className={cn(
                        "fleet-badge",
                        getDriverStatusClass(driver.status)
                      )}
                    >
                      {driver.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                    <span>{driver.trips} trips</span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Star className="w-3 h-3 text-yellow-500" />
                      {driver.rating}
                    </span>
                    <span>•</span>
                    <span className={getAcceptanceRateColor(driver.acceptanceRate)}>
                      {driver.acceptanceRate}% acceptance
                    </span>
                  </div>
                </div>
                <span className="text-sm font-medium text-white">
                  {formatCurrency(driver.earnings)}
                </span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Live Map Preview */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="fleet-card"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-white">Live Map</h2>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
            </div>
            <Link
              href="/map"
              className="text-sm text-green-500 hover:text-green-400 flex items-center gap-1"
            >
              Full screen
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          {/* Map placeholder */}
          <div className="relative h-64 bg-gray-900 rounded-lg overflow-hidden">
            <div className="absolute inset-0 flex items-center justify-center">
              <MapPin className="w-8 h-8 text-gray-700" />
            </div>

            {/* Simulated driver markers */}
            <div className="absolute inset-0">
              {liveDrivers.map((driver, index) => (
                <div
                  key={driver.id}
                  className={cn(
                    "absolute w-3 h-3 rounded-full",
                    driver.status === "online" && "bg-green-500",
                    driver.status === "busy" && "bg-yellow-500"
                  )}
                  style={{
                    left: `${20 + index * 20}%`,
                    top: `${30 + (index % 2) * 30}%`,
                  }}
                />
              ))}
            </div>

            {/* Map legend */}
            <div className="absolute bottom-3 left-3 flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-gray-400">Online</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-yellow-500" />
                <span className="text-gray-400">Busy</span>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-lg font-bold text-green-500">156</p>
              <p className="text-xs text-gray-500">Online</p>
            </div>
            <div>
              <p className="text-lg font-bold text-yellow-500">78</p>
              <p className="text-xs text-gray-500">On Trip</p>
            </div>
            <div>
              <p className="text-lg font-bold text-gray-500">108</p>
              <p className="text-xs text-gray-500">Offline</p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
