"use client";

import { authService } from "@/lib/auth-service";
import { Check, ChevronLeft, Eye, EyeOff, Lock } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const passwordRequirements = [
    { label: "At least 8 characters", met: newPassword.length >= 8 },
    { label: "Contains uppercase letter", met: /[A-Z]/.test(newPassword) },
    { label: "Contains lowercase letter", met: /[a-z]/.test(newPassword) },
    { label: "Contains a number", met: /\d/.test(newPassword) },
    {
      label: "Contains special character",
      met: /[!@#$%^&*(),.?":{}|<>]/.test(newPassword),
    },
  ];

  const allRequirementsMet = passwordRequirements.every((req) => req.met);
  const passwordsMatch =
    newPassword === confirmPassword && confirmPassword !== "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!allRequirementsMet) {
      setError("Please meet all password requirements");
      return;
    }

    if (!passwordsMatch) {
      setError("Passwords do not match");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await authService.changePassword(
        currentPassword,
        newPassword,
      );

      if (response.success) {
        setSuccess(true);
      } else {
        setError(response.error?.message || "Failed to change password");
      }
    } catch (err) {
      console.error("Failed to change password:", err);
      setError("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-8 text-center max-w-sm w-full">
          <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <Check className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            Password Changed
          </h2>
          <p className="text-gray-600 mb-6">
            Your password has been updated successfully.
          </p>
          <Link
            href="/settings"
            className="block w-full bg-ubi-black text-white rounded-xl py-3 font-semibold"
          >
            Back to Settings
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <div className="mx-auto w-full max-w-lg lg:max-w-md">
        {/* Header */}
        <div className="bg-ubi-black px-4 pb-6 pt-12 safe-area-top">
          <div className="flex items-center gap-4">
            <Link
              href="/settings"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
            >
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-xl font-bold text-white">Change Password</h1>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-4 text-sm">
              {error}
            </div>
          )}

          {/* Current Password */}
          <div>
            <label
              htmlFor="current-password"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Current Password
            </label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                id="current-password"
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-xl px-12 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-ubi-black"
                placeholder="Enter current password"
                required
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400"
              >
                {showCurrent ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          {/* New Password */}
          <div>
            <label
              htmlFor="new-password"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              New Password
            </label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                id="new-password"
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-xl px-12 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-ubi-black"
                placeholder="Enter new password"
                required
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400"
              >
                {showNew ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          {/* Password Requirements */}
          {newPassword && (
            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              <p className="text-sm font-medium text-gray-700 mb-2">
                Password Requirements
              </p>
              {passwordRequirements.map((req) => (
                <div
                  key={req.label}
                  className={`flex items-center gap-2 text-sm ${
                    req.met ? "text-green-600" : "text-gray-400"
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full flex items-center justify-center ${
                      req.met ? "bg-green-100" : "bg-gray-200"
                    }`}
                  >
                    {req.met && <Check className="w-3 h-3" />}
                  </div>
                  {req.label}
                </div>
              ))}
            </div>
          )}

          {/* Confirm Password */}
          <div>
            <label
              htmlFor="confirm-password"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Confirm New Password
            </label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                id="confirm-password"
                type={showConfirm ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`w-full bg-white border rounded-xl px-12 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-ubi-black ${
                  confirmPassword && !passwordsMatch
                    ? "border-red-300"
                    : "border-gray-200"
                }`}
                placeholder="Confirm new password"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400"
              >
                {showConfirm ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
            {confirmPassword && !passwordsMatch && (
              <p className="text-red-500 text-sm mt-1">
                Passwords do not match
              </p>
            )}
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={
              isSubmitting ||
              !currentPassword ||
              !allRequirementsMet ||
              !passwordsMatch
            }
            className="w-full bg-ubi-black text-white rounded-xl py-4 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Updating..." : "Update Password"}
          </button>
        </form>
      </div>
    </div>
  );
}
