"use client";

import { driverService } from "@/lib/driver-service";
import { useDriverStore } from "@/store/driver-store";
import {
  AlertCircle,
  Camera,
  CheckCircle,
  ChevronLeft,
  Mail,
  Phone,
  Save,
  User,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export default function EditProfilePage() {
  const { profile, setProfile } = useDriverStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [formData, setFormData] = useState({
    firstName: profile?.firstName || "",
    lastName: profile?.lastName || "",
    email: profile?.email || "",
    phone: profile?.phone || "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await driverService.updateProfile(formData);

      if (response.success) {
        if (profile) {
          setProfile({
            ...profile,
            ...formData,
          });
        }
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      } else {
        setError(response.error?.message || "Failed to update profile");
      }
    } catch (err) {
      console.error(err);
      setError("An error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <div className="mx-auto w-full max-w-lg lg:max-w-md">
        {/* Header */}
        <div className="bg-ubi-black px-4 pb-6 pt-12">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/profile"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
              >
                <ChevronLeft className="h-5 w-5" />
              </Link>
              <h1 className="text-xl font-bold text-white">Edit Profile</h1>
            </div>
            <button
              onClick={handleSubmit}
              disabled={isLoading}
              className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              Save
            </button>
          </div>
        </div>

        <div className="px-4 py-6">
          {/* Success message */}
          {success && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-green-50 p-3 text-green-700">
              <CheckCircle className="h-5 w-5" />
              <span>Profile updated successfully!</span>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-red-700">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
            </div>
          )}

          {/* Profile Photo */}
          <div className="flex justify-center">
            <div className="relative">
              <div className="flex h-28 w-28 items-center justify-center rounded-full bg-gray-200">
                {profile?.photoUrl ? (
                  <img
                    src={profile.photoUrl}
                    alt={profile.firstName}
                    className="h-full w-full rounded-full object-cover"
                  />
                ) : (
                  <User className="h-14 w-14 text-gray-400" />
                )}
              </div>
              <button className="absolute bottom-0 right-0 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white shadow-lg">
                <Camera className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <label
                htmlFor="firstName"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                First Name
              </label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <input
                  id="firstName"
                  type="text"
                  value={formData.firstName}
                  onChange={(e) =>
                    setFormData({ ...formData, firstName: e.target.value })
                  }
                  className="w-full rounded-xl border border-gray-200 bg-white py-4 pl-12 pr-4 text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="lastName"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Last Name
              </label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <input
                  id="lastName"
                  type="text"
                  value={formData.lastName}
                  onChange={(e) =>
                    setFormData({ ...formData, lastName: e.target.value })
                  }
                  className="w-full rounded-xl border border-gray-200 bg-white py-4 pl-12 pr-4 text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  className="w-full rounded-xl border border-gray-200 bg-white py-4 pl-12 pr-4 text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="phone"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Phone Number
              </label>
              <div className="relative">
                <Phone className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  disabled
                  className="w-full rounded-xl border border-gray-200 bg-gray-100 py-4 pl-12 pr-4 text-gray-500 cursor-not-allowed"
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Contact support to change your phone number
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
