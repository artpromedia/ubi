"use client";

import { apiClient, type LaunchedCity } from "@/lib/api-client";
import { useAuthStore, useUserStore } from "@/store";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function SignUpPage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const { setProfile } = useUserStore();
  const [step, setStep] = useState<"details" | "otp">("details");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cities, setCities] = useState<LaunchedCity[]>([]);
  const [code, setCode] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    cityId: "",
  });

  useEffect(() => {
    let mounted = true;
    void apiClient.getLaunchedCities().then((res) => {
      if (!mounted) return;
      const list = res.data?.cities ?? [];
      setCities(list);
      if (list[0]) {
        setFormData((prev) => ({
          ...prev,
          cityId: prev.cityId || list[0]!.id,
        }));
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const normalizedPhone = formData.phone.replace(/[^\d+]/g, "");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const nameParts = formData.name.trim().split(/\s+/);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || firstName;
    const selectedCity = cities.find((c) => c.id === formData.cityId);

    const response = await apiClient.signUp({
      firstName,
      lastName,
      email: formData.email.trim() || undefined,
      phone: normalizedPhone,
      cityId: formData.cityId,
      country: selectedCity?.country,
    });

    if (response.success) {
      setStep("otp");
    } else {
      setError(response.error?.message || "Sign up failed. Please try again.");
    }

    setIsLoading(false);
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const response = await apiClient.verifyOtp(normalizedPhone, code.trim());
    if (response.success && response.data) {
      const { user, tokens } = response.data;
      setAuth(user.id, tokens.accessToken, tokens.refreshToken);
      setProfile({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        preferredLanguage: "en",
        preferredCurrency: "NGN",
      });
      router.push("/home");
    } else {
      setError(response.error?.message || "Invalid verification code.");
    }

    setIsLoading(false);
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        {step === "otp" ? "Verify your number" : "Create your account"}
      </h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6">
        {step === "otp"
          ? `Enter the 6-digit code sent to ${normalizedPhone}`
          : "Sign up with your phone number and home city"}
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {step === "details" ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Full Name
            </label>
            <input
              type="text"
              id="name"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              disabled={isLoading}
              className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-ubi-green-400 focus:border-transparent disabled:opacity-50"
              placeholder="Adaeze Okafor"
              required
            />
          </div>

          <div>
            <label
              htmlFor="phone"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Phone Number
            </label>
            <input
              type="tel"
              id="phone"
              value={formData.phone}
              onChange={(e) =>
                setFormData({ ...formData, phone: e.target.value })
              }
              disabled={isLoading}
              className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-ubi-green-400 focus:border-transparent disabled:opacity-50"
              placeholder="+234 801 234 5678"
              required
            />
          </div>

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Email (optional)
            </label>
            <input
              type="email"
              id="email"
              value={formData.email}
              onChange={(e) =>
                setFormData({ ...formData, email: e.target.value })
              }
              disabled={isLoading}
              className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-ubi-green-400 focus:border-transparent disabled:opacity-50"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label
              htmlFor="cityId"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Home City
            </label>
            <select
              id="cityId"
              value={formData.cityId}
              onChange={(e) =>
                setFormData({ ...formData, cityId: e.target.value })
              }
              disabled={isLoading || cities.length === 0}
              className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-ubi-green-400 focus:border-transparent disabled:opacity-50"
              required
            >
              {cities.length === 0 ? (
                <option value="">Loading cities...</option>
              ) : (
                cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.id})
                  </option>
                ))
              )}
            </select>
          </div>

          <button
            type="submit"
            disabled={
              isLoading || !formData.cityId || normalizedPhone.length < 10
            }
            className="w-full py-3 px-4 bg-ubi-green-500 hover:bg-ubi-green-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
          >
            {isLoading ? "Sending code..." : "Continue"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerify} className="space-y-4">
          <div>
            <label
              htmlFor="otp"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              6-digit verification code
            </label>
            <input
              type="text"
              id="otp"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              disabled={isLoading}
              className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white tracking-widest text-center text-lg focus:ring-2 focus:ring-ubi-green-400 focus:border-transparent disabled:opacity-50"
              placeholder="123456"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isLoading || code.length !== 6}
            className="w-full py-3 px-4 bg-ubi-green-500 hover:bg-ubi-green-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
          >
            {isLoading ? "Verifying..." : "Verify & Create account"}
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-gray-600 dark:text-gray-400">
        Already have an account?{" "}
        <Link
          href="/auth/login"
          className="font-semibold text-ubi-green-600 hover:text-ubi-green-500"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
