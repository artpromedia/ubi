"use client";

import { useDriverStore } from "@/store/driver-store";
import {
  Camera,
  Car,
  ChevronLeft,
  ChevronRight,
  Edit,
  Mail,
  MapPin,
  Phone,
  Shield,
  Star,
  User,
} from "lucide-react";
import Link from "next/link";

export default function ProfilePage() {
  const { profile } = useDriverStore();

  const menuItems = [
    {
      icon: <User className="h-5 w-5" />,
      label: "Edit Profile",
      href: "/profile/edit",
      description: "Update your personal information",
    },
    {
      icon: <Car className="h-5 w-5" />,
      label: "Vehicle Details",
      href: "/profile/vehicle",
      description: "Manage your vehicle information",
    },
    {
      icon: <Shield className="h-5 w-5" />,
      label: "Documents",
      href: "/documents",
      description: "Upload and manage documents",
    },
    {
      icon: <Star className="h-5 w-5" />,
      label: "Ratings & Reviews",
      href: "/ratings",
      description: "View your ratings from riders",
    },
    {
      icon: <MapPin className="h-5 w-5" />,
      label: "Preferred Areas",
      href: "/profile/areas",
      description: "Set your preferred driving zones",
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <div className="mx-auto w-full max-w-lg lg:max-w-md">
        {/* Header */}
        <div className="bg-gradient-to-br from-ubi-black to-gray-800 px-4 pb-20 pt-12 safe-area-top">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
            >
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-xl font-bold text-white">Profile</h1>
          </div>
        </div>

        {/* Profile Card */}
        <div className="-mt-16 mx-4 rounded-2xl bg-white p-6 shadow-lg">
          <div className="flex flex-col items-center">
            {/* Avatar */}
            <div className="relative">
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gray-100">
                {profile?.photoUrl ? (
                  <img
                    src={profile.photoUrl}
                    alt={profile.firstName}
                    className="h-full w-full rounded-full object-cover"
                  />
                ) : (
                  <User className="h-12 w-12 text-gray-400" />
                )}
              </div>
              <button className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white shadow-lg">
                <Camera className="h-4 w-4" />
              </button>
            </div>

            {/* Name & Rating */}
            <h2 className="mt-4 text-xl font-bold text-gray-900">
              {profile?.firstName} {profile?.lastName}
            </h2>
            <div className="mt-1 flex items-center gap-2">
              <div className="flex items-center gap-1 text-yellow-500">
                <Star className="h-5 w-5 fill-current" />
                <span className="font-bold">{profile?.rating || 0}</span>
              </div>
              <span className="text-gray-400">•</span>
              <span className="text-gray-500">
                {profile?.totalTrips || 0} trips
              </span>
            </div>

            {/* Verification Badge */}
            {profile?.isVerified && (
              <div className="mt-3 flex items-center gap-1 rounded-full bg-green-100 px-3 py-1">
                <Shield className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium text-green-600">
                  Verified Driver
                </span>
              </div>
            )}
          </div>

          {/* Contact Info */}
          <div className="mt-6 space-y-3">
            <div className="flex items-center gap-3 rounded-xl bg-gray-50 p-3">
              <Phone className="h-5 w-5 text-gray-400" />
              <span className="text-gray-700">{profile?.phone}</span>
            </div>
            <div className="flex items-center gap-3 rounded-xl bg-gray-50 p-3">
              <Mail className="h-5 w-5 text-gray-400" />
              <span className="text-gray-700">{profile?.email}</span>
            </div>
          </div>

          {/* Vehicle Info */}
          <div className="mt-4 rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                  <Car className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">
                    {profile?.vehicleModel}
                  </p>
                  <p className="text-sm text-gray-500">
                    {profile?.vehiclePlate}
                  </p>
                </div>
              </div>
              <Link href="/profile/vehicle">
                <Edit className="h-5 w-5 text-gray-400" />
              </Link>
            </div>
          </div>
        </div>

        {/* Menu Items */}
        <div className="mt-6 px-4">
          <div className="rounded-xl bg-white shadow-sm">
            {menuItems.map((item, index) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-4 p-4 ${
                  index < menuItems.length - 1 ? "border-b border-gray-100" : ""
                }`}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                  {item.icon}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{item.label}</p>
                  <p className="text-sm text-gray-500">{item.description}</p>
                </div>
                <ChevronRight className="h-5 w-5 text-gray-400" />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
