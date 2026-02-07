"use client";

import {
  Car,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Phone,
  User,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Step = "personal" | "vehicle" | "credentials";

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("personal");
  const [isLoading, setIsLoading] = useState(false);

  // Personal Info
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  // Vehicle Info
  const [vehicleType, setVehicleType] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");

  // Credentials
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (step === "personal") {
      setStep("vehicle");
      return;
    }

    if (step === "vehicle") {
      setStep("credentials");
      return;
    }

    // Final step - submit
    setIsLoading(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      router.push("/auth/verify");
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const vehicleTypes = [
    { id: "bike", name: "Motorcycle", icon: "🏍️" },
    { id: "sedan", name: "Sedan", icon: "🚗" },
    { id: "suv", name: "SUV", icon: "🚙" },
    { id: "van", name: "Van", icon: "🚐" },
    { id: "truck", name: "Truck", icon: "🛻" },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-ubi-black">
      <div className="mx-auto w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-6 safe-area-top">
          {step === "personal" ? (
            <Link
              href="/auth/login"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
            >
              <ChevronLeft className="h-5 w-5" />
            </Link>
          ) : (
            <button
              onClick={() =>
                setStep(step === "credentials" ? "vehicle" : "personal")
              }
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          <div className="flex gap-2">
            {["personal", "vehicle", "credentials"].map((s, i) => (
              <div
                key={s}
                className={`h-2 w-8 rounded-full transition-colors ${
                  ["personal", "vehicle", "credentials"].indexOf(step) >= i
                    ? "bg-primary"
                    : "bg-white/20"
                }`}
              />
            ))}
          </div>
          <div className="w-10" />
        </div>

        {/* Content */}
        <div className="flex-1 rounded-t-3xl bg-white px-6 pt-8 pb-6 mt-8">
          <form onSubmit={handleSubmit}>
            {step === "personal" && (
              <>
                <h1 className="text-2xl font-bold text-gray-900">
                  Personal Information
                </h1>
                <p className="mt-2 text-gray-600">
                  Tell us about yourself to get started
                </p>

                <div className="mt-8 space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label
                        htmlFor="signup-firstName"
                        className="mb-2 block text-sm font-medium text-gray-700"
                      >
                        First Name
                      </label>
                      <div className="relative">
                        <User className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                        <input
                          id="signup-firstName"
                          type="text"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          placeholder="John"
                          required
                          className="w-full rounded-xl border border-gray-200 bg-gray-50 py-4 pl-12 pr-4 text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                      </div>
                    </div>
                    <div>
                      <label
                        htmlFor="signup-lastName"
                        className="mb-2 block text-sm font-medium text-gray-700"
                      >
                        Last Name
                      </label>
                      <input
                        id="signup-lastName"
                        type="text"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        placeholder="Doe"
                        required
                        className="w-full rounded-xl border border-gray-200 bg-gray-50 py-4 px-4 text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="signup-phone"
                      className="mb-2 block text-sm font-medium text-gray-700"
                    >
                      Phone Number
                    </label>
                    <div className="relative">
                      <Phone className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                      <input
                        id="signup-phone"
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+254 712 345 678"
                        required
                        className="w-full rounded-xl border border-gray-200 bg-gray-50 py-4 pl-12 pr-4 text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="signup-email"
                      className="mb-2 block text-sm font-medium text-gray-700"
                    >
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                      <input
                        id="signup-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="john@example.com"
                        required
                        className="w-full rounded-xl border border-gray-200 bg-gray-50 py-4 pl-12 pr-4 text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                  </div>
                </div>
              </>
            )}

            {step === "vehicle" && (
              <>
                <h1 className="text-2xl font-bold text-gray-900">
                  Vehicle Information
                </h1>
                <p className="mt-2 text-gray-600">Tell us about your vehicle</p>

                <div className="mt-8 space-y-5">
                  <fieldset>
                    <legend className="mb-3 block text-sm font-medium text-gray-700">
                      Vehicle Type
                    </legend>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {vehicleTypes.map((type) => (
                        <button
                          key={type.id}
                          type="button"
                          onClick={() => setVehicleType(type.id)}
                          className={`flex flex-col items-center justify-center rounded-xl border-2 p-3 sm:p-4 transition-colors ${
                            vehicleType === type.id
                              ? "border-primary bg-primary/5"
                              : "border-gray-200 hover:border-gray-300 active:bg-gray-50"
                          }`}
                        >
                          <span className="text-xl sm:text-2xl">
                            {type.icon}
                          </span>
                          <span className="mt-1 sm:mt-2 text-xs sm:text-sm font-medium text-gray-700">
                            {type.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <div>
                    <label
                      htmlFor="signup-plate"
                      className="mb-2 block text-sm font-medium text-gray-700"
                    >
                      License Plate
                    </label>
                    <div className="relative">
                      <Car className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                      <input
                        id="signup-plate"
                        type="text"
                        value={vehiclePlate}
                        onChange={(e) =>
                          setVehiclePlate(e.target.value.toUpperCase())
                        }
                        placeholder="KBZ 123A"
                        required
                        className="w-full rounded-xl border border-gray-200 bg-gray-50 py-4 pl-12 pr-4 text-gray-900 uppercase placeholder:text-gray-400 placeholder:normal-case focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="signup-model"
                      className="mb-2 block text-sm font-medium text-gray-700"
                    >
                      Vehicle Model
                    </label>
                    <input
                      id="signup-model"
                      type="text"
                      value={vehicleModel}
                      onChange={(e) => setVehicleModel(e.target.value)}
                      placeholder="Toyota Corolla 2022"
                      required
                      className="w-full rounded-xl border border-gray-200 bg-gray-50 py-4 px-4 text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                </div>
              </>
            )}

            {step === "credentials" && (
              <>
                <h1 className="text-2xl font-bold text-gray-900">
                  Create Password
                </h1>
                <p className="mt-2 text-gray-600">
                  Secure your account with a strong password
                </p>

                <div className="mt-8 space-y-5">
                  <div>
                    <label
                      htmlFor="signup-password"
                      className="mb-2 block text-sm font-medium text-gray-700"
                    >
                      Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                      <input
                        id="signup-password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Create a strong password"
                        required
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

                  <div>
                    <label
                      htmlFor="signup-confirmPassword"
                      className="mb-2 block text-sm font-medium text-gray-700"
                    >
                      Confirm Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                      <input
                        id="signup-confirmPassword"
                        type={showPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Confirm your password"
                        required
                        className="w-full rounded-xl border border-gray-200 bg-gray-50 py-4 pl-12 pr-4 text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                    {confirmPassword && password !== confirmPassword && (
                      <p className="mt-2 text-sm text-red-500">
                        Passwords do not match
                      </p>
                    )}
                  </div>

                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={acceptTerms}
                      onChange={(e) => setAcceptTerms(e.target.checked)}
                      className="mt-1 h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <span className="text-sm text-gray-600">
                      I agree to the{" "}
                      <Link
                        href="/terms"
                        className="text-primary hover:underline"
                      >
                        Terms of Service
                      </Link>{" "}
                      and{" "}
                      <Link
                        href="/privacy"
                        className="text-primary hover:underline"
                      >
                        Privacy Policy
                      </Link>
                    </span>
                  </label>
                </div>
              </>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={
                isLoading ||
                (step === "credentials" &&
                  (!acceptTerms || password !== confirmPassword))
              }
              className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-4 font-semibold text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <>
                  {step === "credentials" ? "Create Account" : "Continue"}
                  <ChevronRight className="h-5 w-5" />
                </>
              )}
            </button>
          </form>

          {/* Sign In Link */}
          {step === "personal" && (
            <div className="mt-8 text-center">
              <p className="text-gray-600">
                Already have an account?{" "}
                <Link
                  href="/auth/login"
                  className="font-semibold text-primary hover:underline"
                >
                  Sign in
                </Link>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
