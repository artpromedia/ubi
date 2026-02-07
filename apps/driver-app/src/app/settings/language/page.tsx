"use client";

import { driverService } from "@/lib/driver-service";
import { Check, ChevronLeft, Globe } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const languages = [
  { code: "en", name: "English", native: "English" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "fr", name: "French", native: "Français" },
  { code: "de", name: "German", native: "Deutsch" },
  { code: "pt", name: "Portuguese", native: "Português" },
  { code: "zh", name: "Chinese (Simplified)", native: "简体中文" },
  { code: "ja", name: "Japanese", native: "日本語" },
  { code: "ko", name: "Korean", native: "한국어" },
  { code: "ar", name: "Arabic", native: "العربية" },
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "sw", name: "Swahili", native: "Kiswahili" },
  { code: "yo", name: "Yoruba", native: "Yorùbá" },
  { code: "ha", name: "Hausa", native: "Hausa" },
  { code: "ig", name: "Igbo", native: "Igbo" },
];

export default function LanguagePage() {
  const [selectedLanguage, setSelectedLanguage] = useState("en");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const filteredLanguages = languages.filter(
    (lang) =>
      lang.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lang.native.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleLanguageSelect = async (code: string) => {
    if (code === selectedLanguage) return;

    setIsLoading(true);
    try {
      const response = await driverService.updateSettings({ language: code });
      if (response.success) {
        setSelectedLanguage(code);
        // Store language preference locally for immediate use
        localStorage.setItem("language", code);
      }
    } catch (err) {
      console.error("Failed to update language:", err);
    } finally {
      setIsLoading(false);
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
            <h1 className="text-xl font-bold text-white">Language</h1>
          </div>

          {/* Search */}
          <div className="mt-4">
            <div className="relative">
              <Globe className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-12 py-3 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-white/30"
                placeholder="Search languages..."
              />
            </div>
          </div>
        </div>

        {/* Languages List */}
        <div className="p-4">
          <div className="bg-white rounded-2xl overflow-hidden divide-y divide-gray-100">
            {filteredLanguages.map((language) => (
              <button
                key={language.code}
                onClick={() => handleLanguageSelect(language.code)}
                disabled={isLoading}
                className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <div className="text-left">
                  <p className="font-medium text-gray-900">{language.name}</p>
                  <p className="text-sm text-gray-500">{language.native}</p>
                </div>
                {selectedLanguage === language.code && (
                  <div className="w-6 h-6 bg-ubi-black rounded-full flex items-center justify-center">
                    <Check className="w-4 h-4 text-white" />
                  </div>
                )}
              </button>
            ))}
          </div>

          {filteredLanguages.length === 0 && (
            <div className="text-center py-8">
              <Globe className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No languages found</p>
            </div>
          )}

          {/* Note */}
          <p className="text-center text-sm text-gray-500 mt-6">
            The app will be translated to your selected language where
            available.
          </p>
        </div>
      </div>
    </div>
  );
}
