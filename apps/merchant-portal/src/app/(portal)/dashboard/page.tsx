"use client";

import { motion } from "framer-motion";
import {
  Package,
  Truck,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Clock,
  CheckCircle,
  AlertTriangle,
  ChevronRight,
  MapPin,
  ArrowRight,
  RotateCw,
  Star,
} from "lucide-react";
import Link from "next/link";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import {
  formatCurrency,
  formatNumber,
  cn,
  formatRelativeTime,
  getDeliveryStatusClass,
  getPriorityClass,
  getEstimatedDelivery,
} from "@/lib/utils";

// Mock data
const stats = [
  {
    name: "Total Deliveries",
    value: 1234,
    change: 12.5,
    icon: Package,
    color: "text-cyan-500",
    bgColor: "bg-cyan-500/10",
  },
  {
    name: "In Transit",
    value: 48,
    change: 8.2,
    icon: Truck,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
  },
  {
    name: "This Month",
    value: 2850000,
    change: 15.3,
    icon: DollarSign,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
  },
  {
    name: "Delivery Rate",
    value: 98.5,
    change: 1.2,
    icon: CheckCircle,
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
    suffix: "%",
  },
];

const weeklyData = [
  { name: "Mon", deliveries: 145, revenue: 425000 },
  { name: "Tue", deliveries: 178, revenue: 520000 },
  { name: "Wed", deliveries: 156, revenue: 456000 },
  { name: "Thu", deliveries: 189, revenue: 551000 },
  { name: "Fri", deliveries: 212, revenue: 618000 },
  { name: "Sat", deliveries: 178, revenue: 519000 },
  { name: "Sun", deliveries: 134, revenue: 391000 },
];

const recentDeliveries = [
  {
    id: "UBI-2024-0001234",
    recipient: "Adaeze Okonkwo",
    address: "12 Victoria Island, Lagos",
    status: "in-transit",
    priority: "express",
    eta: "30 min",
    amount: 3500,
  },
  {
    id: "UBI-2024-0001235",
    recipient: "Emeka Chukwu",
    address: "45 Ikoyi, Lagos",
    status: "assigned",
    priority: "same-day",
    eta: "2 hrs",
    amount: 2800,
  },
  {
    id: "UBI-2024-0001236",
    recipient: "Fatima Ibrahim",
    address: "78 Lekki Phase 1, Lagos",
    status: "pending",
    priority: "standard",
    eta: "Tomorrow",
    amount: 1500,
  },
  {
    id: "UBI-2024-0001237",
    recipient: "David Obi",
    address: "23 Surulere, Lagos",
    status: "delivered",
    priority: "express",
    eta: "Delivered",
    amount: 4200,
  },
  {
    id: "UBI-2024-0001238",
    recipient: "Grace Ade",
    address: "56 Yaba, Lagos",
    status: "picked-up",
    priority: "same-day",
    eta: "4 hrs",
    amount: 2100,
  },
];

const pendingPickups = [
  {
    id: 1,
    address: "Main Warehouse, 15 Apapa Road, Lagos",
    packages: 12,
    scheduledTime: "10:00 AM",
    status: "awaiting",
  },
  {
    id: 2,
    address: "Ikeja Office, 45 Allen Avenue",
    packages: 5,
    scheduledTime: "2:00 PM",
    status: "confirmed",
  },
  {
    id: 3,
    address: "VI Hub, 8 Akin Adesola Street",
    packages: 8,
    scheduledTime: "4:30 PM",
    status: "awaiting",
  },
];

const deliveryZones = [
  { zone: "Lagos Island", deliveries: 145, percentage: 35 },
  { zone: "Ikeja", deliveries: 89, percentage: 21 },
  { zone: "Lekki", deliveries: 78, percentage: 19 },
  { zone: "Victoria Island", deliveries: 56, percentage: 14 },
  { zone: "Others", deliveries: 45, percentage: 11 },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Merchant Dashboard</h1>
          <p className="text-gray-400 mt-1">
            Track your deliveries and manage your shipments
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className="px-4 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500">
            <option>Today</option>
            <option>Yesterday</option>
            <option>Last 7 days</option>
            <option>This month</option>
          </select>
          <Link
            href="/deliveries/new"
            className="px-4 py-2 bg-cyan-500 text-white rounded-lg text-sm font-medium hover:bg-cyan-600 transition flex items-center gap-2"
          >
            <Package className="w-4 h-4" />
            Create Shipment
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
            className="merchant-stat-card"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-400">{stat.name}</p>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-white">
                    {stat.name === "This Month"
                      ? formatCurrency(stat.value)
                      : formatNumber(stat.value)}
                  </span>
                  {stat.suffix && (
                    <span className="text-lg text-gray-400">{stat.suffix}</span>
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
              <span className="text-sm text-gray-500">vs last month</span>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Delivery Trends */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="merchant-card lg:col-span-2"
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-white">
                Weekly Delivery Trends
              </h2>
              <p className="text-sm text-gray-400 mt-1">
                Deliveries and revenue this week
              </p>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-cyan-500" />
                <span className="text-gray-400">Deliveries</span>
              </div>
            </div>
          </div>

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weeklyData}>
                <defs>
                  <linearGradient id="colorDeliveries" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10AEBA" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10AEBA" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="name" stroke="#6b7280" fontSize={12} />
                <YAxis stroke="#6b7280" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#111827",
                    border: "1px solid #374151",
                    borderRadius: "0.5rem",
                  }}
                  labelStyle={{ color: "#f9fafb" }}
                />
                <Area
                  type="monotone"
                  dataKey="deliveries"
                  stroke="#10AEBA"
                  strokeWidth={2}
                  fill="url(#colorDeliveries)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Pending Pickups */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="merchant-card"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Pending Pickups</h2>
            <Link
              href="/pickups"
              className="text-sm text-cyan-500 hover:text-cyan-400 flex items-center gap-1"
            >
              View all
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="space-y-3">
            {pendingPickups.map((pickup) => (
              <div
                key={pickup.id}
                className="p-3 bg-gray-900 rounded-lg"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-cyan-500/10 rounded-lg">
                      <Truck className="w-4 h-4 text-cyan-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white truncate max-w-[180px]">
                        {pickup.address}
                      </p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                        <span>{pickup.packages} packages</span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {pickup.scheduledTime}
                        </span>
                      </div>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "text-xs font-medium px-2 py-1 rounded",
                      pickup.status === "confirmed"
                        ? "bg-green-500/10 text-green-500"
                        : "bg-yellow-500/10 text-yellow-500"
                    )}
                  >
                    {pickup.status}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <Link
            href="/pickups/request"
            className="mt-4 flex items-center justify-center gap-2 px-4 py-2 border border-dashed border-gray-700 rounded-lg text-sm text-gray-400 hover:border-cyan-500 hover:text-cyan-500 transition"
          >
            <Package className="w-4 h-4" />
            Request New Pickup
          </Link>
        </motion.div>
      </div>

      {/* Recent Deliveries */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="merchant-card"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Recent Deliveries</h2>
          <Link
            href="/deliveries"
            className="text-sm text-cyan-500 hover:text-cyan-400 flex items-center gap-1"
          >
            View all
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="merchant-table">
            <thead>
              <tr>
                <th>Tracking ID</th>
                <th>Recipient</th>
                <th>Priority</th>
                <th>Status</th>
                <th>ETA</th>
                <th>Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recentDeliveries.map((delivery) => (
                <tr key={delivery.id}>
                  <td>
                    <span className="font-mono text-cyan-500">{delivery.id}</span>
                  </td>
                  <td>
                    <div>
                      <p className="font-medium text-white">{delivery.recipient}</p>
                      <p className="text-xs text-gray-500">{delivery.address}</p>
                    </div>
                  </td>
                  <td>
                    <span
                      className={cn(
                        "merchant-badge",
                        getPriorityClass(delivery.priority)
                      )}
                    >
                      {delivery.priority}
                    </span>
                  </td>
                  <td>
                    <span
                      className={cn(
                        "merchant-badge",
                        getDeliveryStatusClass(delivery.status)
                      )}
                    >
                      {delivery.status.replace("-", " ")}
                    </span>
                  </td>
                  <td className="text-gray-400">{delivery.eta}</td>
                  <td className="font-medium text-white">
                    {formatCurrency(delivery.amount)}
                  </td>
                  <td>
                    <Link
                      href={`/tracking/${delivery.id}`}
                      className="p-2 hover:bg-surface rounded-lg text-gray-400 hover:text-cyan-500 transition inline-flex"
                    >
                      <MapPin className="w-4 h-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* Bottom Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Delivery Zones */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="merchant-card"
        >
          <h2 className="text-lg font-semibold text-white mb-4">
            Top Delivery Zones
          </h2>

          <div className="space-y-4">
            {deliveryZones.map((zone) => (
              <div key={zone.zone}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-gray-300">{zone.zone}</span>
                  <span className="text-sm text-gray-500">
                    {zone.deliveries} ({zone.percentage}%)
                  </span>
                </div>
                <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400 rounded-full"
                    style={{ width: `${zone.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Quick Actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
          className="merchant-card"
        >
          <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>

          <div className="grid grid-cols-2 gap-3">
            <Link
              href="/deliveries/new"
              className="p-4 bg-gray-900 rounded-lg hover:bg-gray-800 transition group"
            >
              <Package className="w-6 h-6 text-cyan-500 mb-2" />
              <p className="text-sm font-medium text-white">New Shipment</p>
              <p className="text-xs text-gray-500 mt-1">Create a delivery</p>
            </Link>

            <Link
              href="/pickups/request"
              className="p-4 bg-gray-900 rounded-lg hover:bg-gray-800 transition group"
            >
              <Truck className="w-6 h-6 text-blue-500 mb-2" />
              <p className="text-sm font-medium text-white">Request Pickup</p>
              <p className="text-xs text-gray-500 mt-1">Schedule a pickup</p>
            </Link>

            <Link
              href="/tracking"
              className="p-4 bg-gray-900 rounded-lg hover:bg-gray-800 transition group"
            >
              <MapPin className="w-6 h-6 text-green-500 mb-2" />
              <p className="text-sm font-medium text-white">Track Package</p>
              <p className="text-xs text-gray-500 mt-1">Find your delivery</p>
            </Link>

            <Link
              href="/integrations"
              className="p-4 bg-gray-900 rounded-lg hover:bg-gray-800 transition group"
            >
              <RotateCw className="w-6 h-6 text-purple-500 mb-2" />
              <p className="text-sm font-medium text-white">API & Webhooks</p>
              <p className="text-xs text-gray-500 mt-1">Integrate your store</p>
            </Link>
          </div>

          {/* API Usage */}
          <div className="mt-4 p-3 bg-gray-900 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">API Requests</p>
                <p className="text-xs text-gray-500">This month</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-white">8,456</p>
                <p className="text-xs text-gray-500">/ 10,000</p>
              </div>
            </div>
            <div className="mt-2 h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full bg-cyan-500 rounded-full" style={{ width: "84.56%" }} />
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
