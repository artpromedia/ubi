"use client";

import { apiClient } from "@/lib/api-client";
import { useAuthStore, useUserStore } from "@/store";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignUpPage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const { setProfile } = useUserStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    // Parse full name into first and last name
    const nameParts = formData.name.trim().split(" ");
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    const response = await apiClient.signUp({
      firstName,
      lastName,
      email: formData.email,
      phone: formData.phone,
      password: formData.password,
    });

    if (response.success && response.data) {
      const { user, tokens } = response.data;

      // Update auth store
      setAuth(user.id, tokens.accessToken, tokens.refreshToken);

      // Update user profile
      setProfile({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        preferredLanguage: "en",
        preferredCurrency: "KES",
      });

      // Redirect to home
      router.push("/home");
    } else {
      setError(response.error?.message || "Sign up failed. Please try again.");
    }

    setIsLoading(false);
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        Create your account
      </h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6">
        Join millions of riders across Africa
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

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
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            disabled={isLoading}
            className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-ubi-green-400 focus:border-transparent disabled:opacity-50"
            placeholder="John Doe"
            required
          />
        </div>

        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Email
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
            placeholder="+234 800 000 0000"
            required
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Password
          </label>
          <input
            type="password"
            id="password"
            value={formData.password}
            onChange={(e) =>
              setFormData({ ...formData, password: e.target.value })
            }
            disabled={isLoading}
            className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-ubi-green-400 focus:border-transparent disabled:opacity-50"
            placeholder="••••••••"
            required
            minLength={8}
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-ubi-green-500 hover:bg-ubi-green-600 text-white font-semibold py-3 px-4 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-ubi-green-400 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <svg
                className="animate-spin h-5 w-5 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              Creating account...
            </>
          ) : (
            "Create Account"
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-gray-600 dark:text-gray-400">
        Already have an account?{" "}
        <Link
          href="/auth/login"
          className="text-ubi-green-500 hover:text-ubi-green-600 font-medium"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
