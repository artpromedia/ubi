"use client";

import { useAuth } from "@/lib/hooks";
import { useDriverStore } from "@/store/driver-store";
import { ChevronRight, Eye, EyeOff, Lock, Phone } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const { setAuthenticated, setOnboarded, setProfile } = useDriverStore();
  const { login: authLogin } = useAuth();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      // Try real API login first
      const apiResult = await authLogin(phone, password);

      if (apiResult.success) {
        // API login succeeded, redirect to dashboard
        setOnboarded(true);
        router.push("/dashboard");
        return;
      }

      // Fall back to demo mode for testing
      console.log("API login failed, using demo mode:", apiResult.error);

      // Mock successful login for demo/testing
      setProfile({
        id: "driver-123",
        firstName: "John",
        lastName: "Kamau",
        email: "john.kamau@example.com",
        phone: phone || "+254712345678",
        rating: 4.8,
        totalTrips: 1250,
        isVerified: true,
        vehicleType: "Sedan",
        vehiclePlate: "KBZ 123A",
        vehicleModel: "Toyota Corolla 2022",
      });
      setAuthenticated(true);
      setOnboarded(true);
      router.push("/dashboard");
    } catch {
      setError("Invalid phone number or password");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-ubi-black">
      <div className="mx-auto w-full max-w-lg lg:max-w-md flex flex-col flex-1">
        {/* Header */}
        <div className="flex flex-col items-center justify-center px-6 pt-16 pb-8 safe-area-top">
          <UBIDriverLogo />
          <p className="mt-4 text-white/70">Drive with UBI</p>
        </div>

        {/* Login Form */}
        <div className="flex-1 rounded-t-3xl bg-white px-6 pt-8 pb-6">
          <h1 className="text-2xl font-bold text-gray-900">Welcome back</h1>
          <p className="mt-2 text-gray-600">Sign in to your driver account</p>

          {/* Test Credentials Banner */}
          <div className="mt-4 rounded-lg bg-primary/10 border border-primary/20 p-3">
            <p className="text-xs font-medium text-primary">🧪 Test Mode</p>
            <p className="text-xs text-gray-600 mt-1">
              Use any phone & password to login (demo mode)
            </p>
          </div>

          <form onSubmit={handleLogin} className="mt-6 space-y-6">
            {error && (
              <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600">
                {error}
              </div>
            )}

            {/* Phone Input */}
            <div>
              <label
                htmlFor="login-phone"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Phone Number
              </label>
              <div className="relative">
                <Phone className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <input
                  id="login-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+254 712 345 678"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 py-4 pl-12 pr-4 text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            {/* Password Input */}
            <div>
              <label
                htmlFor="login-password"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 py-4 pl-12 pr-12 text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            {/* Forgot Password */}
            <div className="text-right">
              <Link
                href="/auth/forgot-password"
                className="text-sm font-medium text-primary hover:underline"
              >
                Forgot password?
              </Link>
            </div>

            {/* Login Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-4 font-semibold text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <>
                  Sign In
                  <ChevronRight className="h-5 w-5" />
                </>
              )}
            </button>
          </form>

          {/* Sign Up Link */}
          <div className="mt-8 text-center">
            <p className="text-gray-600">
              New to UBI?{" "}
              <Link
                href="/auth/signup"
                className="font-semibold text-primary hover:underline"
              >
                Become a driver
              </Link>
            </p>
          </div>

          {/* Download App Prompt */}
          <div className="mt-8 rounded-xl bg-gray-50 p-4">
            <p className="text-center text-sm text-gray-600">
              For the best experience on the go, download the{" "}
              <span className="font-semibold text-ubi-black">
                UBI Driver App
              </span>
            </p>
            <div className="mt-3 flex justify-center gap-3">
              <Link
                href="#"
                className="rounded-lg bg-ubi-black px-4 py-2 text-xs font-medium text-white"
              >
                App Store
              </Link>
              <Link
                href="#"
                className="rounded-lg bg-ubi-black px-4 py-2 text-xs font-medium text-white"
              >
                Google Play
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function UBIDriverLogo() {
  return (
    <div className="flex flex-col items-center">
      {/* Official UBI Logo - White variant for dark backgrounds */}
      <svg
        width="120"
        height="60"
        viewBox="0 0 120 60"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-12 w-auto"
      >
        {/* U - sitting lower */}
        <path
          d="M8 18 L8 42 Q8 54 20 54 Q32 54 32 42 L32 18"
          stroke="#FFFFFF"
          strokeWidth="9"
          strokeLinecap="round"
          fill="none"
        />
        {/* b - bounced up */}
        <path
          d="M46 4 L46 44 M46 26 Q46 18 56 18 Q68 18 68 31 Q68 44 56 44 Q46 44 46 36"
          stroke="#FFFFFF"
          strokeWidth="9"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {/* i */}
        <line
          x1="84"
          y1="24"
          x2="84"
          y2="52"
          stroke="#FFFFFF"
          strokeWidth="9"
          strokeLinecap="round"
        />
        {/* Green dot */}
        <circle cx="84" cy="12" r="6" fill="#1DB954" />
      </svg>
      <span className="mt-2 text-lg font-bold text-white tracking-wider">
        DRIVER
      </span>
    </div>
  );
}
