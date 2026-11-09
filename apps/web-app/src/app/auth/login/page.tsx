"use client";

import { apiClient, type AuthUser, type LaunchedCity } from "@/lib/api-client";
import { useAuthStore, useUserStore } from "@/store";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Step = "phone" | "otp" | "city";

export default function LoginPage() {
  const router = useRouter();
  const { setAuth, updateTokens } = useAuthStore();
  const { setProfile } = useUserStore();
  const [step, setStep] = useState<Step>("phone");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [cities, setCities] = useState<LaunchedCity[]>([]);
  const [cityId, setCityId] = useState("");
  const [verifiedUser, setVerifiedUser] = useState<AuthUser | null>(null);

  const normalizedPhone = phone.replace(/[^\d+]/g, "");

  const applyAuthenticatedProfile = (user: AuthUser) => {
    setProfile({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      preferredLanguage: "en",
      preferredCurrency: "NGN",
    });
  };

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    const response = await apiClient.requestOtp(normalizedPhone);
    if (response.success) {
      setStep("otp");
    } else {
      setError(response.error?.message || "Could not send verification code.");
    }
    setIsLoading(false);
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    const response = await apiClient.verifyOtp(normalizedPhone, code.trim());
    if (response.success && response.data) {
      const { user, tokens, citySelectionRequired } = response.data;
      setAuth(user.id, tokens.accessToken, tokens.refreshToken);
      applyAuthenticatedProfile(user);
      const resolvedCity = user.cityId ?? user.homeCityId ?? null;
      if (citySelectionRequired || !resolvedCity) {
        setVerifiedUser(user);
        const catalog = await apiClient.getLaunchedCities();
        const list = catalog.data?.cities ?? [];
        setCities(list);
        if (list[0]) setCityId(list[0].id);
        setStep("city");
      } else {
        router.push("/home");
      }
    } else {
      setError(response.error?.message || "Invalid or expired code.");
    }
    setIsLoading(false);
  };

  const handleSelectCity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cityId) return;
    setIsLoading(true);
    setError(null);
    const response = await apiClient.selectCity(cityId);
    if (response.success && response.data) {
      updateTokens(
        response.data.tokens.accessToken,
        response.data.tokens.refreshToken,
      );
      if (verifiedUser) {
        applyAuthenticatedProfile({
          ...verifiedUser,
          cityId: response.data.cityId,
        });
      }
      router.push("/home");
    } else {
      setError(response.error?.message || "Could not save city.");
    }
    setIsLoading(false);
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        {step === "city" ? "Choose your city" : "Welcome back"}
      </h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6">
        {step === "phone" &&
          "Enter your phone number to receive a 6-digit verification code"}
        {step === "otp" && `Enter the 6-digit code sent to ${normalizedPhone}`}
        {step === "city" &&
          "Pick the city where you ride most so fares and local services match"}
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {step === "phone" && (
        <form onSubmit={handleRequestOtp} className="space-y-4">
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
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={isLoading}
              className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-ubi-green-400 focus:border-transparent disabled:opacity-50"
              placeholder="+234 801 234 5678"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isLoading || normalizedPhone.length < 10}
            className="w-full py-3 px-4 bg-ubi-green-500 hover:bg-ubi-green-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
          >
            {isLoading ? "Sending code..." : "Send verification code"}
          </button>
        </form>
      )}

      {step === "otp" && (
        <form onSubmit={handleVerifyOtp} className="space-y-4">
          <div>
            <label
              htmlFor="otp"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              6-digit code
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
            {isLoading ? "Verifying..." : "Verify & Sign in"}
          </button>

          <button
            type="button"
            onClick={() => {
              setStep("phone");
              setCode("");
              setError(null);
            }}
            className="w-full py-2 text-sm text-gray-600 dark:text-gray-400 hover:underline"
          >
            Use a different phone number
          </button>
        </form>
      )}

      {step === "city" && (
        <form onSubmit={handleSelectCity} className="space-y-4">
          <div>
            <label
              htmlFor="cityId"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Home City
            </label>
            <select
              id="cityId"
              value={cityId}
              onChange={(e) => setCityId(e.target.value)}
              disabled={isLoading || cities.length === 0}
              className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-ubi-green-400 focus:border-transparent disabled:opacity-50"
              required
            >
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.id})
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            disabled={isLoading || !cityId}
            className="w-full py-3 px-4 bg-ubi-green-500 hover:bg-ubi-green-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
          >
            {isLoading ? "Saving..." : "Continue"}
          </button>
        </form>
      )}

      {step !== "city" && (
        <p className="mt-6 text-center text-sm text-gray-600 dark:text-gray-400">
          Don&apos;t have an account?{" "}
          <Link
            href="/auth/signup"
            className="font-semibold text-ubi-green-600 hover:text-ubi-green-500"
          >
            Sign up
          </Link>
        </p>
      )}
    </div>
  );
}
