"use client";

import { driverService } from "@/lib/driver-service";
import {
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  Shield,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

interface PrivacySetting {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
}

export default function PrivacySettingsPage() {
  const [settings, setSettings] = useState<PrivacySetting[]>([
    {
      id: "share_location",
      title: "Share Location",
      description: "Allow UBI to access your location while using the app",
      enabled: true,
    },
    {
      id: "location_history",
      title: "Location History",
      description: "Save your trip routes and frequently visited places",
      enabled: true,
    },
    {
      id: "profile_visibility",
      title: "Profile Visibility",
      description: "Show your profile picture and name to riders",
      enabled: true,
    },
    {
      id: "analytics",
      title: "Usage Analytics",
      description: "Help us improve by sharing anonymous usage data",
      enabled: false,
    },
    {
      id: "marketing",
      title: "Marketing Communications",
      description: "Receive promotional offers and updates via email",
      enabled: false,
    },
  ]);

  const toggleSetting = async (id: string) => {
    const setting = settings.find((s) => s.id === id);
    if (!setting) return;

    const newValue = !setting.enabled;

    // Optimistically update UI
    setSettings(
      settings.map((s) => (s.id === id ? { ...s, enabled: newValue } : s)),
    );

    // Sync with API
    try {
      const settingsMap: Record<string, string> = {
        share_location: "locationTracking",
        analytics: "dataSharing",
      };

      const apiKey = settingsMap[id];
      if (apiKey) {
        await driverService.updateSettings({ [apiKey]: newValue });
      }
    } catch (err) {
      // Revert on failure
      setSettings(
        settings.map((s) => (s.id === id ? { ...s, enabled: !newValue } : s)),
      );
      console.error("Failed to update setting:", err);
    }
  };

  const dataOptions = [
    {
      icon: <Download className="w-5 h-5" />,
      title: "Download My Data",
      description: "Get a copy of all your personal data",
      action: "download",
    },
    {
      icon: <Trash2 className="w-5 h-5" />,
      title: "Delete My Account",
      description: "Permanently delete your account and all data",
      action: "delete",
      danger: true,
    },
  ];

  const handleDownloadData = async () => {
    try {
      const response = await driverService.requestDataDownload();
      if (response.success) {
        alert(
          "Your data export request has been submitted. You will receive an email with a download link.",
        );
      } else {
        alert(response.error?.message || "Failed to request data download");
      }
    } catch (err) {
      console.error("Failed to request data download:", err);
      alert("An error occurred. Please try again.");
    }
  };

  const handleDeleteAccount = async () => {
    const confirmed = confirm(
      "Are you sure you want to delete your account? This action cannot be undone.",
    );
    if (!confirmed) return;

    try {
      const response = await driverService.requestAccountDeletion();
      if (response.success) {
        alert(
          "Account deletion request submitted. You will receive a confirmation email.",
        );
      } else {
        alert(response.error?.message || "Failed to submit deletion request");
      }
    } catch (err) {
      console.error("Failed to request account deletion:", err);
      alert("An error occurred. Please try again.");
    }
  };

  const handleDataAction = (action: string) => {
    if (action === "download") {
      void handleDownloadData();
    } else if (action === "delete") {
      void handleDeleteAccount();
    }
  };

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
            <h1 className="text-xl font-bold text-white">Privacy Settings</h1>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-6">
          {/* Privacy Controls */}
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 px-1">
              Privacy Controls
            </h2>
            <div className="bg-white rounded-2xl overflow-hidden divide-y divide-gray-100">
              {settings.map((setting) => (
                <div
                  key={setting.id}
                  className="flex items-center justify-between p-4"
                >
                  <div className="flex-1 pr-4">
                    <p className="font-medium text-gray-900">{setting.title}</p>
                    <p className="text-sm text-gray-500">
                      {setting.description}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleSetting(setting.id)}
                    className={`relative w-12 h-7 rounded-full transition-colors ${
                      setting.enabled ? "bg-ubi-black" : "bg-gray-300"
                    }`}
                  >
                    <span
                      className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                        setting.enabled ? "left-6" : "left-1"
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Data & Account */}
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 px-1">
              Data & Account
            </h2>
            <div className="bg-white rounded-2xl overflow-hidden divide-y divide-gray-100">
              {dataOptions.map((option) => (
                <button
                  key={option.action}
                  onClick={() => handleDataAction(option.action)}
                  className={`w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors ${
                    option.danger ? "text-red-600" : ""
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        option.danger ? "bg-red-50" : "bg-gray-100"
                      }`}
                    >
                      {option.icon}
                    </div>
                    <div className="text-left">
                      <p
                        className={`font-medium ${
                          option.danger ? "text-red-600" : "text-gray-900"
                        }`}
                      >
                        {option.title}
                      </p>
                      <p
                        className={`text-sm ${
                          option.danger ? "text-red-400" : "text-gray-500"
                        }`}
                      >
                        {option.description}
                      </p>
                    </div>
                  </div>
                  <ChevronRight
                    className={`w-5 h-5 ${
                      option.danger ? "text-red-300" : "text-gray-300"
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Legal Links */}
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 px-1">
              Legal
            </h2>
            <div className="bg-white rounded-2xl overflow-hidden divide-y divide-gray-100">
              <Link
                href="/privacy"
                className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                    <Shield className="w-5 h-5 text-gray-600" />
                  </div>
                  <span className="font-medium text-gray-900">
                    Privacy Policy
                  </span>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-300" />
              </Link>
              <Link
                href="/terms"
                className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                    <Database className="w-5 h-5 text-gray-600" />
                  </div>
                  <span className="font-medium text-gray-900">
                    Terms of Service
                  </span>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-300" />
              </Link>
            </div>
          </div>

          {/* Info */}
          <p className="text-center text-sm text-gray-500 px-4">
            Your privacy matters. We only collect data necessary to provide our
            services and improve your experience.
          </p>
        </div>
      </div>
    </div>
  );
}
