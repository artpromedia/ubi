"use client";

import { motion } from "framer-motion";
import {
  Search,
  Download,
  Eye,
  Ban,
  Shield,
  ChevronLeft,
  ChevronRight,
  Mail,
  Phone,
  MapPin,
  Calendar,
} from "lucide-react";
import { useState } from "react";

import { formatDate, formatRelativeTime, cn, getInitials } from "@/lib/utils";

// Mock data - replace with real API calls
const users = [
  {
    id: "USR-001",
    name: "Adaeze Obi",
    email: "adaeze@email.com",
    phone: "+234 801 234 5678",
    type: "rider",
    status: "active",
    location: "Lagos, Nigeria",
    joinedAt: "2024-01-15T10:30:00Z",
    lastActive: "2024-12-10T14:25:00Z",
    trips: 156,
    rating: 4.8,
  },
  {
    id: "USR-002",
    name: "Kwame Asante",
    email: "kwame@email.com",
    phone: "+233 20 123 4567",
    type: "driver",
    status: "active",
    location: "Accra, Ghana",
    joinedAt: "2023-06-20T08:15:00Z",
    lastActive: "2024-12-10T13:10:00Z",
    trips: 2_341,
    rating: 4.95,
  },
  {
    id: "USR-003",
    name: "Fatima Mohammed",
    email: "fatima@email.com",
    phone: "+254 712 345 678",
    type: "rider",
    status: "suspended",
    location: "Nairobi, Kenya",
    joinedAt: "2024-03-10T16:45:00Z",
    lastActive: "2024-11-28T09:30:00Z",
    trips: 45,
    rating: 3.2,
  },
  {
    id: "USR-004",
    name: "Oluwaseun Adeyemi",
    email: "seun@email.com",
    phone: "+234 803 456 7890",
    type: "courier",
    status: "active",
    location: "Lagos, Nigeria",
    joinedAt: "2023-11-05T12:00:00Z",
    lastActive: "2024-12-10T15:45:00Z",
    trips: 892,
    rating: 4.7,
  },
  {
    id: "USR-005",
    name: "Grace Nkosi",
    email: "grace@email.com",
    phone: "+27 82 123 4567",
    type: "rider",
    status: "blocked",
    location: "Johannesburg, SA",
    joinedAt: "2024-07-22T09:20:00Z",
    lastActive: "2024-10-15T11:00:00Z",
    trips: 12,
    rating: 2.1,
  },
];

const userTypes = ["all", "rider", "driver", "courier"];
const statuses = ["all", "active", "suspended", "blocked"];

export default function UsersPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = selectedType === "all" || user.type === selectedType;
    const matchesStatus =
      selectedStatus === "all" || user.status === selectedStatus;
    return matchesSearch && matchesType && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Users</h1>
          <p className="text-gray-400 mt-1">
            Manage riders, drivers, and couriers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 hover:bg-gray-700 transition">
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
          <input
            type="text"
            placeholder="Search by name, email, or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="px-4 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            {userTypes.map((type) => (
              <option key={type} value={type}>
                {type === "all"
                  ? "All Types"
                  : type.charAt(0).toUpperCase() + type.slice(1) + "s"}
              </option>
            ))}
          </select>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-4 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status === "all"
                  ? "All Status"
                  : status.charAt(0).toUpperCase() + status.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Users Table */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="admin-card overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Type</th>
                <th>Status</th>
                <th>Location</th>
                <th>Trips</th>
                <th>Rating</th>
                <th>Last Active</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white font-medium">
                        {getInitials(user.name)}
                      </div>
                      <div>
                        <p className="font-medium text-white">{user.name}</p>
                        <p className="text-xs text-gray-500">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span
                      className={cn(
                        "admin-badge",
                        user.type === "rider" && "bg-blue-500/20 text-blue-400",
                        user.type === "driver" &&
                          "bg-green-500/20 text-green-400",
                        user.type === "courier" &&
                          "bg-cyan-500/20 text-cyan-400",
                      )}
                    >
                      {user.type}
                    </span>
                  </td>
                  <td>
                    <span
                      className={cn(
                        "admin-badge",
                        user.status === "active" && "admin-badge-success",
                        user.status === "suspended" && "admin-badge-warning",
                        user.status === "blocked" && "admin-badge-danger",
                      )}
                    >
                      {user.status}
                    </span>
                  </td>
                  <td className="text-gray-400">{user.location}</td>
                  <td className="text-gray-300">
                    {user.trips.toLocaleString()}
                  </td>
                  <td>
                    <span className="flex items-center gap-1">
                      <svg
                        className="w-4 h-4 text-yellow-500"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                      <span className="text-gray-300">{user.rating}</span>
                    </span>
                  </td>
                  <td className="text-gray-400">
                    {formatRelativeTime(user.lastActive)}
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setSelectedUser(user.id)}
                        className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition"
                        title="View Details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        className="p-2 text-gray-400 hover:text-yellow-500 hover:bg-gray-800 rounded-lg transition"
                        title="Suspend User"
                      >
                        <Shield className="w-4 h-4" />
                      </button>
                      <button
                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-gray-800 rounded-lg transition"
                        title="Block User"
                      >
                        <Ban className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between p-4 border-t border-gray-800">
          <p className="text-sm text-gray-400">
            Showing <span className="font-medium text-white">1-10</span> of{" "}
            <span className="font-medium text-white">2,456</span> users
          </p>
          <div className="flex items-center gap-2">
            <button className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition disabled:opacity-50">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button className="px-3 py-1 bg-green-500/20 text-green-500 rounded-lg text-sm font-medium">
              1
            </button>
            <button className="px-3 py-1 text-gray-400 hover:bg-gray-800 rounded-lg text-sm">
              2
            </button>
            <button className="px-3 py-1 text-gray-400 hover:bg-gray-800 rounded-lg text-sm">
              3
            </button>
            <span className="text-gray-500">...</span>
            <button className="px-3 py-1 text-gray-400 hover:bg-gray-800 rounded-lg text-sm">
              246
            </button>
            <button className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </motion.div>

      {/* User Details Drawer */}
      {selectedUser && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setSelectedUser(null)}
          />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            className="fixed top-0 right-0 z-50 h-full w-full max-w-md bg-gray-950 border-l border-gray-800 overflow-y-auto"
          >
            {(() => {
              const user = users.find((u) => u.id === selectedUser);
              if (!user) {
                return null;
              }

              return (
                <div className="p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-semibold text-white">
                      User Details
                    </h2>
                    <button
                      onClick={() => setSelectedUser(null)}
                      className="text-gray-400 hover:text-white"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* User Profile */}
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white text-xl font-bold">
                      {getInitials(user.name)}
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold text-white">
                        {user.name}
                      </h3>
                      <p className="text-sm text-gray-400">{user.id}</p>
                      <span
                        className={cn(
                          "admin-badge mt-1",
                          user.status === "active" && "admin-badge-success",
                          user.status === "suspended" && "admin-badge-warning",
                          user.status === "blocked" && "admin-badge-danger",
                        )}
                      >
                        {user.status}
                      </span>
                    </div>
                  </div>

                  {/* Info Cards */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 p-3 bg-gray-900 rounded-lg">
                      <Mail className="w-5 h-5 text-gray-500" />
                      <div>
                        <p className="text-xs text-gray-500">Email</p>
                        <p className="text-sm text-white">{user.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 bg-gray-900 rounded-lg">
                      <Phone className="w-5 h-5 text-gray-500" />
                      <div>
                        <p className="text-xs text-gray-500">Phone</p>
                        <p className="text-sm text-white">{user.phone}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 bg-gray-900 rounded-lg">
                      <MapPin className="w-5 h-5 text-gray-500" />
                      <div>
                        <p className="text-xs text-gray-500">Location</p>
                        <p className="text-sm text-white">{user.location}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 bg-gray-900 rounded-lg">
                      <Calendar className="w-5 h-5 text-gray-500" />
                      <div>
                        <p className="text-xs text-gray-500">Member Since</p>
                        <p className="text-sm text-white">
                          {formatDate(user.joinedAt)}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-3 mt-6">
                    <div className="p-4 bg-gray-900 rounded-lg text-center">
                      <p className="text-2xl font-bold text-white">
                        {user.trips.toLocaleString()}
                      </p>
                      <p className="text-xs text-gray-500">Total Trips</p>
                    </div>
                    <div className="p-4 bg-gray-900 rounded-lg text-center">
                      <p className="text-2xl font-bold text-white">
                        {user.rating}
                      </p>
                      <p className="text-xs text-gray-500">Rating</p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-6 space-y-2">
                    <button className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white hover:bg-gray-700 transition">
                      <Eye className="w-4 h-4" />
                      View Full Profile
                    </button>
                    <button className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-yellow-500/20 border border-yellow-500/30 rounded-lg text-yellow-500 hover:bg-yellow-500/30 transition">
                      <Shield className="w-4 h-4" />
                      Suspend Account
                    </button>
                    <button className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-500/20 border border-red-500/30 rounded-lg text-red-500 hover:bg-red-500/30 transition">
                      <Ban className="w-4 h-4" />
                      Block Account
                    </button>
                  </div>
                </div>
              );
            })()}
          </motion.div>
        </>
      )}
    </div>
  );
}

const X = ({ className }: { className?: string }) => {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
};
