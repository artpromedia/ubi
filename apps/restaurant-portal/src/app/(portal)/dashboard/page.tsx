"use client";

import { motion } from "framer-motion";
import {
  DollarSign,
  ShoppingBag,
  Clock,
  Star,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  ChevronRight,
  Check,
  X,
  Timer,
} from "lucide-react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { formatCurrency, cn, getOrderStatusClass } from "@/lib/utils";

// Mock data
const stats = [
  {
    name: "Today's Revenue",
    value: 285000,
    change: 15.3,
    icon: DollarSign,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
  },
  {
    name: "Total Orders",
    value: 47,
    change: 8.2,
    icon: ShoppingBag,
    color: "text-orange-500",
    bgColor: "bg-orange-500/10",
  },
  {
    name: "Avg Prep Time",
    value: "18 min",
    change: -12.5,
    icon: Clock,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
  },
  {
    name: "Rating",
    value: "4.8",
    change: 2.1,
    icon: Star,
    color: "text-yellow-500",
    bgColor: "bg-yellow-500/10",
  },
];

const revenueData = [
  { time: "9am", revenue: 15000 },
  { time: "10am", revenue: 28000 },
  { time: "11am", revenue: 35000 },
  { time: "12pm", revenue: 65000 },
  { time: "1pm", revenue: 82000 },
  { time: "2pm", revenue: 55000 },
  { time: "3pm", revenue: 35000 },
  { time: "4pm", revenue: 28000 },
  { time: "5pm", revenue: 42000 },
  { time: "6pm", revenue: 68000 },
  { time: "7pm", revenue: 95000 },
  { time: "8pm", revenue: 78000 },
];

const activeOrders = [
  {
    id: "ORD-001",
    items: ["Jollof Rice (2)", "Suya", "Chapman"],
    total: 8500,
    customer: "Adaeze O.",
    status: "new",
    time: "2 min ago",
    prepTime: 15,
  },
  {
    id: "ORD-002",
    items: ["Fried Rice", "Chicken", "Juice"],
    total: 6200,
    customer: "Kwame A.",
    status: "preparing",
    time: "8 min ago",
    prepTime: 10,
  },
  {
    id: "ORD-003",
    items: ["Egusi Soup", "Pounded Yam", "Assorted Meat"],
    total: 12000,
    customer: "Grace N.",
    status: "preparing",
    time: "12 min ago",
    prepTime: 5,
  },
  {
    id: "ORD-004",
    items: ["Small Chops (10pcs)", "Pepper Soup"],
    total: 4500,
    customer: "David M.",
    status: "ready",
    time: "18 min ago",
    prepTime: 0,
  },
];

const topItems = [
  { name: "Jollof Rice", orders: 156, revenue: 468000 },
  { name: "Fried Rice", orders: 124, revenue: 372000 },
  { name: "Egusi Soup", orders: 98, revenue: 490000 },
  { name: "Suya", orders: 87, revenue: 174000 },
  { name: "Small Chops", orders: 76, revenue: 228000 },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 mt-1">
            Welcome back, Mama's Bistro! Here's your day at a glance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className="px-4 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500">
            <option>Today</option>
            <option>Yesterday</option>
            <option>Last 7 days</option>
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
            className="restaurant-stat-card"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-400">{stat.name}</p>
                <p className="mt-2 text-2xl font-bold text-white">
                  {typeof stat.value === "number"
                    ? formatCurrency(stat.value)
                    : stat.value}
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
                  stat.change >= 0 ? "text-green-500" : "text-red-500",
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
        {/* Active Orders */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="restaurant-card lg:col-span-2"
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-white">
                Active Orders
              </h2>
              <span className="px-2 py-0.5 bg-orange-500/20 text-orange-500 text-xs font-medium rounded-full">
                {activeOrders.length} orders
              </span>
            </div>
            <Link
              href="/orders"
              className="text-sm text-orange-500 hover:text-orange-400 flex items-center gap-1"
            >
              View all
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="space-y-4">
            {activeOrders.map((order) => (
              <div
                key={order.id}
                className={cn(
                  "p-4 rounded-lg bg-gray-900 border-l-4 transition-all",
                  order.status === "new" && "border-l-blue-500 order-pulse",
                  order.status === "preparing" && "border-l-yellow-500",
                  order.status === "ready" && "border-l-green-500",
                )}
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  {/* Order Info */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-white">{order.id}</span>
                      <span
                        className={cn(
                          "restaurant-badge",
                          getOrderStatusClass(order.status),
                        )}
                      >
                        {order.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-400 mb-2">
                      {order.items.join(", ")}
                    </p>
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>{order.customer}</span>
                      <span>•</span>
                      <span>{order.time}</span>
                    </div>
                  </div>

                  {/* Price & Prep Time */}
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="font-semibold text-white">
                        {formatCurrency(order.total)}
                      </p>
                      {order.status !== "ready" && (
                        <div className="flex items-center gap-1 text-xs text-gray-400">
                          <Timer className="w-3 h-3" />
                          <span>{order.prepTime} min left</span>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      {order.status === "new" && (
                        <>
                          <button className="p-2 bg-green-500/20 text-green-500 rounded-lg hover:bg-green-500/30 transition">
                            <Check className="w-4 h-4" />
                          </button>
                          <button className="p-2 bg-red-500/20 text-red-500 rounded-lg hover:bg-red-500/30 transition">
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      {order.status === "preparing" && (
                        <button className="px-3 py-1.5 bg-green-500 text-white text-sm font-medium rounded-lg hover:bg-green-600 transition">
                          Ready
                        </button>
                      )}
                      {order.status === "ready" && (
                        <span className="px-3 py-1.5 bg-green-500/20 text-green-500 text-sm font-medium rounded-lg">
                          Awaiting pickup
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Top Items */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="restaurant-card"
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-white">Top Items</h2>
            <Link
              href="/menu"
              className="text-sm text-orange-500 hover:text-orange-400"
            >
              Manage
            </Link>
          </div>

          <div className="space-y-4">
            {topItems.map((item, index) => (
              <div key={item.name} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400 text-sm font-medium">
                  #{index + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {item.name}
                  </p>
                  <p className="text-xs text-gray-500">{item.orders} orders</p>
                </div>
                <span className="text-sm font-medium text-white">
                  {formatCurrency(item.revenue)}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Revenue Chart */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="restaurant-card"
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Today's Revenue
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              Total: {formatCurrency(626000)}
            </p>
          </div>
        </div>

        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={revenueData}>
              <defs>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" stroke="#6b7280" fontSize={12} />
              <YAxis
                stroke="#6b7280"
                fontSize={12}
                tickFormatter={(value) => `₦${(value / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#111827",
                  border: "1px solid #374151",
                  borderRadius: "0.5rem",
                }}
                labelStyle={{ color: "#f9fafb" }}
                formatter={(value: number) => [
                  formatCurrency(value),
                  "Revenue",
                ]}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="#f97316"
                fillOpacity={1}
                fill="url(#colorRevenue)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      {/* Alerts */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7 }}
        className="flex items-center gap-3 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20"
      >
        <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-sm text-yellow-500 font-medium">
            Menu items running low
          </p>
          <p className="text-xs text-yellow-500/70">
            Jollof Rice and Chicken stock may run out in 2 hours based on
            current orders.
          </p>
        </div>
        <Link
          href="/menu"
          className="text-sm text-yellow-500 hover:text-yellow-400 font-medium"
        >
          Update stock
        </Link>
      </motion.div>
    </div>
  );
}
