"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Search,
  Filter,
  AlertTriangle,
  Shield,
  Eye,
  CheckCircle,
  XCircle,
  Clock,
  TrendingUp,
  CreditCard,
  User,
  MapPin,
  AlertOctagon,
} from "lucide-react";
import { formatCurrency, formatRelativeTime, cn } from "@/lib/utils";

// Mock data
const fraudAlerts = [
  {
    id: "FRD-001",
    type: "payment_fraud",
    severity: "critical",
    status: "pending",
    title: "Multiple failed payment attempts",
    description: "10+ failed transactions in 5 minutes from same user",
    user: {
      name: "Unknown User",
      id: "USR-98765",
      email: "suspect@email.com",
    },
    amount: 450000,
    location: "Lagos, Nigeria",
    timestamp: "2024-12-10T15:30:00Z",
    indicators: ["velocity_spike", "card_testing", "ip_mismatch"],
  },
  {
    id: "FRD-002",
    type: "account_takeover",
    severity: "high",
    status: "investigating",
    title: "Suspicious login activity",
    description: "Login from new device in different country",
    user: {
      name: "Adaeze Obi",
      id: "USR-12345",
      email: "adaeze@email.com",
    },
    amount: 0,
    location: "Unknown (VPN detected)",
    timestamp: "2024-12-10T14:45:00Z",
    indicators: ["new_device", "vpn_detected", "location_change"],
  },
  {
    id: "FRD-003",
    type: "promo_abuse",
    severity: "medium",
    status: "resolved",
    title: "Promo code abuse detected",
    description: "Same promo used across 15 accounts",
    user: {
      name: "Suspicious Network",
      id: "NETWORK-001",
      email: "multiple@email.com",
    },
    amount: 125000,
    location: "Nairobi, Kenya",
    timestamp: "2024-12-10T12:00:00Z",
    indicators: ["device_fingerprint", "shared_payment", "referral_ring"],
  },
  {
    id: "FRD-004",
    type: "driver_fraud",
    severity: "high",
    status: "pending",
    title: "Ghost ride pattern detected",
    description: "Driver completing trips without passengers",
    user: {
      name: "Driver #DRV-456",
      id: "DRV-45678",
      email: "driver456@email.com",
    },
    amount: 89000,
    location: "Accra, Ghana",
    timestamp: "2024-12-10T11:30:00Z",
    indicators: ["no_passenger", "same_route", "suspicious_timing"],
  },
];

const fraudStats = [
  {
    label: "Alerts Today",
    value: 47,
    change: 12,
    icon: AlertTriangle,
    color: "text-red-500",
  },
  {
    label: "Under Investigation",
    value: 23,
    change: -5,
    icon: Search,
    color: "text-yellow-500",
  },
  {
    label: "Resolved",
    value: 156,
    change: 8,
    icon: CheckCircle,
    color: "text-green-500",
  },
  {
    label: "Amount at Risk",
    value: "₦2.4M",
    change: 15,
    icon: CreditCard,
    color: "text-blue-500",
  },
];

const severityColors = {
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  low: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

const statusColors = {
  pending: "admin-badge-warning",
  investigating: "admin-badge-info",
  resolved: "admin-badge-success",
  dismissed: "admin-badge-danger",
};

export default function FraudCenterPage() {
  const [selectedAlert, setSelectedAlert] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSeverity, setFilterSeverity] = useState("all");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Fraud Center</h1>
          <p className="text-gray-400 mt-1">
            Monitor and investigate suspicious activities
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
          </span>
          <span className="text-sm text-gray-400">Live monitoring active</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {fraudStats.map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="admin-stat-card"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-400">{stat.label}</p>
                <p className="mt-2 text-2xl font-bold text-white">{stat.value}</p>
              </div>
              <div className={cn("p-2 rounded-lg bg-gray-800")}>
                <stat.icon className={cn("w-5 h-5", stat.color)} />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-1">
              <TrendingUp
                className={cn(
                  "w-4 h-4",
                  stat.change >= 0 ? "text-red-500" : "text-green-500"
                )}
              />
              <span
                className={cn(
                  "text-sm font-medium",
                  stat.change >= 0 ? "text-red-500" : "text-green-500"
                )}
              >
                {Math.abs(stat.change)}%
              </span>
              <span className="text-sm text-gray-500">vs yesterday</span>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
          <input
            type="text"
            placeholder="Search alerts..."
            className="w-full pl-10 pr-4 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
            className="px-4 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            <option value="all">All Severity</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-4 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="investigating">Investigating</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
      </div>

      {/* Alerts List */}
      <div className="space-y-4">
        {fraudAlerts.map((alert, index) => (
          <motion.div
            key={alert.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className={cn(
              "admin-card border-l-4 cursor-pointer hover:bg-gray-800/50 transition",
              alert.severity === "critical" && "border-l-red-500",
              alert.severity === "high" && "border-l-orange-500",
              alert.severity === "medium" && "border-l-yellow-500",
              alert.severity === "low" && "border-l-blue-500"
            )}
            onClick={() => setSelectedAlert(alert.id)}
          >
            <div className="flex flex-col lg:flex-row lg:items-center gap-4">
              {/* Alert Info */}
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span
                    className={cn(
                      "admin-badge border",
                      severityColors[alert.severity as keyof typeof severityColors]
                    )}
                  >
                    {alert.severity}
                  </span>
                  <span
                    className={cn(
                      "admin-badge",
                      statusColors[alert.status as keyof typeof statusColors]
                    )}
                  >
                    {alert.status}
                  </span>
                  <span className="text-xs text-gray-500">{alert.id}</span>
                </div>
                <h3 className="text-lg font-semibold text-white">
                  {alert.title}
                </h3>
                <p className="text-sm text-gray-400 mt-1">{alert.description}</p>

                {/* Indicators */}
                <div className="flex flex-wrap gap-2 mt-3">
                  {alert.indicators.map((indicator) => (
                    <span
                      key={indicator}
                      className="px-2 py-1 bg-gray-800 rounded text-xs text-gray-400"
                    >
                      {indicator.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              </div>

              {/* User & Amount */}
              <div className="flex flex-col sm:flex-row lg:flex-col gap-4 lg:w-48">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-gray-500" />
                  <div>
                    <p className="text-sm text-white">{alert.user.name}</p>
                    <p className="text-xs text-gray-500">{alert.user.id}</p>
                  </div>
                </div>
                {alert.amount > 0 && (
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-gray-500" />
                    <span className="text-sm font-medium text-white">
                      {formatCurrency(alert.amount)}
                    </span>
                  </div>
                )}
              </div>

              {/* Time & Location */}
              <div className="flex flex-col gap-2 lg:w-40 text-right">
                <div className="flex items-center justify-end gap-2">
                  <Clock className="w-4 h-4 text-gray-500" />
                  <span className="text-sm text-gray-400">
                    {formatRelativeTime(alert.timestamp)}
                  </span>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <MapPin className="w-4 h-4 text-gray-500" />
                  <span className="text-sm text-gray-400">{alert.location}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex lg:flex-col gap-2">
                <button className="flex-1 lg:flex-none px-4 py-2 bg-green-500/20 text-green-500 rounded-lg text-sm font-medium hover:bg-green-500/30 transition">
                  Investigate
                </button>
                <button className="flex-1 lg:flex-none px-4 py-2 bg-gray-800 text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-700 transition">
                  Dismiss
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Fraud Detection Rules Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="admin-card"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Active Detection Rules</h2>
          <button className="text-sm text-green-500 hover:text-green-400">
            Manage Rules
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { name: "Velocity Check", triggers: 156, active: true },
            { name: "Card Testing", triggers: 89, active: true },
            { name: "Account Takeover", triggers: 45, active: true },
            { name: "Promo Abuse", triggers: 234, active: true },
            { name: "Ghost Rides", triggers: 67, active: true },
            { name: "Device Fingerprint", triggers: 123, active: false },
          ].map((rule) => (
            <div
              key={rule.name}
              className="flex items-center justify-between p-3 bg-gray-900 rounded-lg"
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "w-2 h-2 rounded-full",
                    rule.active ? "bg-green-500" : "bg-gray-500"
                  )}
                />
                <div>
                  <p className="text-sm font-medium text-white">{rule.name}</p>
                  <p className="text-xs text-gray-500">
                    {rule.triggers} triggers today
                  </p>
                </div>
              </div>
              <button className="text-gray-400 hover:text-white">
                <Eye className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
