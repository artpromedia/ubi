"use client";

import { useAuth } from "@/lib/hooks";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function VerifyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const phone = searchParams.get("phone") || "";
  const { login, requestOTP, error: authError } = useAuth();
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState(30);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (resendTimer > 0) {
      const timer = setTimeout(() => setResendTimer(resendTimer - 1), 1000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [resendTimer]);

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all digits entered
    if (newOtp.every(Boolean) && index === 5) {
      handleVerify(newOtp.join(""));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData("text").slice(0, 6);
    if (!/^\d+$/.test(pastedData)) return;

    const newOtp = [...otp];
    pastedData.split("").forEach((digit, i) => {
      if (i < 6) newOtp[i] = digit;
    });
    setOtp(newOtp);

    if (pastedData.length === 6) {
      handleVerify(pastedData);
    }
  };

  const handleVerify = async (code: string) => {
    if (!phone) {
      setError("Phone number not found. Please go back and try again.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await login(phone, code);

      if (result.success) {
        router.push("/onboarding");
      } else {
        setError(result.error || "Verification failed. Please try again.");
        setOtp(["", "", "", "", "", ""]);
        inputRefs.current[0]?.focus();
      }
    } catch (err) {
      console.error(err);
      setError("An error occurred. Please try again.");
      setOtp(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendTimer > 0 || !phone) return;

    setError(null);
    const response = await requestOTP(phone);

    if (response.success) {
      setResendTimer(30);
    } else {
      setError(
        response.error?.message || "Failed to resend code. Please try again.",
      );
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-ubi-black">
      <div className="mx-auto w-full max-w-lg lg:max-w-md flex flex-col flex-1">
        {/* Header */}
        <div className="flex items-center px-4 pt-6 safe-area-top">
          <Link
            href="/auth/signup"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white active:bg-white/20"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
        </div>

        {/* Content */}
        <div className="flex-1 rounded-t-3xl bg-white px-6 pt-8 pb-6 mt-8">
          <h1 className="text-2xl font-bold text-gray-900">
            Verify Your Phone
          </h1>
          <p className="mt-2 text-gray-600">
            We sent a 6-digit code to {phone || "your phone number"}. Enter it
            below to verify.
          </p>

          {/* Error Message */}
          {(error || authError) && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
              {error || authError}
            </div>
          )}

          {/* OTP Input */}
          <div className="mt-8 flex justify-center gap-3" onPaste={handlePaste}>
            {otp.map((digit, index) => (
              <input
                key={`otp-${index}`}
                ref={(el) => {
                  inputRefs.current[index] = el;
                }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                disabled={isLoading}
                className="h-14 w-12 rounded-xl border-2 border-gray-200 bg-gray-50 text-center text-xl font-bold text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
              />
            ))}
          </div>

          {/* Resend */}
          <div className="mt-8 text-center">
            <p className="text-gray-600">
              Didn&apos;t receive the code?{" "}
              {resendTimer > 0 ? (
                <span className="text-gray-400">Resend in {resendTimer}s</span>
              ) : (
                <button
                  onClick={handleResend}
                  className="font-semibold text-primary hover:underline"
                >
                  Resend Code
                </button>
              )}
            </p>
          </div>

          {/* Loading Indicator */}
          {isLoading && (
            <div className="mt-8 flex justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-3 border-primary border-t-transparent" />
            </div>
          )}

          {/* Verify Button */}
          <button
            onClick={() => handleVerify(otp.join(""))}
            disabled={isLoading || otp.some((d) => !d)}
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-4 font-semibold text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              "Verify"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
