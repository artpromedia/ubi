"use client";

import { useDriverStore } from "@/store/driver-store";
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  FileText,
  Globe,
  HelpCircle,
  Lock,
  LogOut,
  MapPin,
  MessageCircle,
  Moon,
  Shield,
  Smartphone,
  Sun,
  Volume2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SettingsPage() {
  const router = useRouter();
  const { logout } = useDriverStore();
  const [notifications, setNotifications] = useState(true);
  const [soundEffects, setSoundEffects] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [locationSharing, setLocationSharing] = useState(true);

  const handleLogout = () => {
    logout();
    router.push("/auth/login");
  };

  const settingSections = [
    {
      title: "Preferences",
      items: [
        {
          icon: <Bell className="h-5 w-5" />,
          label: "Push Notifications",
          description: "Receive trip requests and updates",
          toggle: true,
          value: notifications,
          onChange: setNotifications,
        },
        {
          icon: <Volume2 className="h-5 w-5" />,
          label: "Sound Effects",
          description: "Play sounds for new requests",
          toggle: true,
          value: soundEffects,
          onChange: setSoundEffects,
        },
        {
          icon: darkMode ? (
            <Moon className="h-5 w-5" />
          ) : (
            <Sun className="h-5 w-5" />
          ),
          label: "Dark Mode",
          description: "Switch between light and dark theme",
          toggle: true,
          value: darkMode,
          onChange: setDarkMode,
        },
        {
          icon: <MapPin className="h-5 w-5" />,
          label: "Location Sharing",
          description: "Share location while online",
          toggle: true,
          value: locationSharing,
          onChange: setLocationSharing,
        },
      ],
    },
    {
      title: "Account",
      items: [
        {
          icon: <Lock className="h-5 w-5" />,
          label: "Change Password",
          href: "/settings/password",
        },
        {
          icon: <Globe className="h-5 w-5" />,
          label: "Language",
          href: "/settings/language",
          value: "English",
        },
        {
          icon: <Shield className="h-5 w-5" />,
          label: "Privacy",
          href: "/settings/privacy",
        },
      ],
    },
    {
      title: "Support",
      items: [
        {
          icon: <HelpCircle className="h-5 w-5" />,
          label: "Help Center",
          href: "/help",
        },
        {
          icon: <MessageCircle className="h-5 w-5" />,
          label: "Contact Support",
          href: "/support",
        },
        {
          icon: <FileText className="h-5 w-5" />,
          label: "Terms of Service",
          href: "/terms",
        },
        {
          icon: <Shield className="h-5 w-5" />,
          label: "Privacy Policy",
          href: "/privacy",
        },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <div className="mx-auto w-full max-w-lg lg:max-w-md">
        {/* Header */}
        <div className="bg-ubi-black px-4 pb-6 pt-12 safe-area-top">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
            >
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-xl font-bold text-white">Settings</h1>
          </div>
        </div>

        <div className="px-4 py-6 space-y-6">
          {settingSections.map((section) => (
            <div key={section.title}>
              <h2 className="mb-3 text-sm font-semibold text-gray-500 uppercase">
                {section.title}
              </h2>
              <div className="rounded-xl bg-white shadow-sm overflow-hidden">
                {section.items.map((item, index) => (
                  <div
                    key={item.label}
                    className={
                      index < section.items.length - 1
                        ? "border-b border-gray-100"
                        : ""
                    }
                  >
                    {"toggle" in item && item.toggle ? (
                      <div className="flex items-center justify-between p-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-600">
                            {item.icon}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">
                              {item.label}
                            </p>
                            {"description" in item && (
                              <p className="text-sm text-gray-500">
                                {item.description}
                              </p>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => item.onChange(!item.value)}
                          className={`relative h-7 w-12 rounded-full transition-colors ${
                            item.value ? "bg-primary" : "bg-gray-300"
                          }`}
                        >
                          <div
                            className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                              item.value ? "translate-x-6" : "translate-x-1"
                            }`}
                          />
                        </button>
                      </div>
                    ) : (
                      <Link
                        href={"href" in item ? item.href : "#"}
                        className="flex items-center justify-between p-4"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-600">
                            {item.icon}
                          </div>
                          <p className="font-medium text-gray-900">
                            {item.label}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {"value" in item && (
                            <span className="text-sm text-gray-500">
                              {item.value}
                            </span>
                          )}
                          <ChevronRight className="h-5 w-5 text-gray-400" />
                        </div>
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* App Info */}
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <Smartphone className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-gray-900">UBI Driver</p>
                <p className="text-sm text-gray-500">Version 1.0.0</p>
              </div>
            </div>
          </div>

          {/* Logout Button */}
          <button
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-50 py-4 font-medium text-red-600"
          >
            <LogOut className="h-5 w-5" />
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}
