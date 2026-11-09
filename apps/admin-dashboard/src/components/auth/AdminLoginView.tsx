"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  KeyRound,
  Loader2,
  Phone,
  Shield,
  ShieldX,
} from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactElement } from "react";

import { DeviceStepUpCard } from "@/components/auth/DeviceStepUpCard";
import { sanitizeNextPath, type PublicAdminSession } from "@/lib/session";

const E164_RE = /^\+[1-9]\d{7,14}$/;

type LoginStep = "phone" | "otp" | "step_up";

interface OtpApiResponse {
  success?: boolean;
  data?: {
    expiresInSeconds?: number;
    resendAfterSeconds?: number;
  };
  error?: {
    code?: string;
    message?: string;
  };
}

interface VerifyApiResponse {
  success?: boolean;
  data?: {
    session?: PublicAdminSession;
  };
  error?: {
    code?: string;
    message?: string;
    details?: { role?: string };
  };
}

export const AdminLoginView = ({
  nextPath = "/dashboard",
}: {
  readonly nextPath?: string;
}): ReactElement => {
  const safeNext = sanitizeNextPath(nextPath);

  const [step, setStep] = useState<LoginStep>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roleRefusal, setRoleRefusal] = useState<string | null>(null);
  const [limitedSession, setLimitedSession] =
    useState<PublicAdminSession | null>(null);

  useEffect(() => {
    if (resendCooldown <= 0) {
      return;
    }
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const navigateToConsole = (): void => {
    if (typeof globalThis.location !== "undefined") {
      globalThis.location.assign(safeNext);
    }
  };

  const requestCode = async (targetPhone: string): Promise<boolean> => {
    setError(null);
    setRoleRefusal(null);
    const normalized = targetPhone.trim();
    if (!E164_RE.test(normalized)) {
      setError(
        "Enter your operator phone number in international format (for example, +2348012345678).",
      );
      return false;
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/otp", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalized }),
      });
      const payload = (await res.json()) as OtpApiResponse;
      if (!res.ok) {
        setError(
          payload.error?.message ??
            "Could not send a verification code right now.",
        );
        return false;
      }
      setResendCooldown(payload.data?.resendAfterSeconds ?? 60);
      setStep("otp");
      return true;
    } catch {
      setError("Cannot reach UBI authentication right now. Check connection.");
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const handlePhoneSubmit = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    await requestCode(phone);
  };

  const handleOtpSubmit = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setError(null);
    setRoleRefusal(null);

    const trimmedCode = code.trim();
    if (!/^\d{6}$/.test(trimmedCode)) {
      setError("Enter the 6-digit verification code sent to your phone.");
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), code: trimmedCode }),
      });
      const payload = (await res.json()) as VerifyApiResponse;

      if (res.status === 403 && payload.error?.code === "forbidden") {
        setRoleRefusal(
          payload.error.message ??
            "This account does not have operator access to the UBI Admin Console.",
        );
        setCode("");
        return;
      }

      if (!res.ok || !payload.data?.session) {
        setError(
          payload.error?.message ??
            "Verification failed. Check the code and try again.",
        );
        return;
      }

      const session = payload.data.session;
      if (session.mode === "limited") {
        setLimitedSession(session);
        setStep("step_up");
        return;
      }

      navigateToConsole();
    } catch {
      setError("Cannot reach UBI authentication right now. Check connection.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOutFromStepUp = async (): Promise<void> => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } finally {
      setLimitedSession(null);
      setCode("");
      setStep("phone");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 p-4">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1a1a1a_1px,transparent_1px),linear-gradient(to_bottom,#1a1a1a_1px,transparent_1px)] bg-[size:4rem_4rem]" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-md"
      >
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 mb-4">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">UBI Admin</h1>
          <p className="text-gray-400 mt-2">
            Internal operations &amp; safety console
          </p>
        </div>

        {step === "step_up" && limitedSession ? (
          <DeviceStepUpCard
            session={limitedSession}
            onVerified={() => navigateToConsole()}
            onSignOut={handleSignOutFromStepUp}
          />
        ) : (
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8">
            <AnimatePresence>
              {roleRefusal ? (
                <motion.div
                  key="role-refusal"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  role="alert"
                  data-testid="login.role-refused"
                  className="mb-6 flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200"
                >
                  <ShieldX className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
                  <div className="text-sm space-y-1">
                    <p className="font-semibold text-red-300">
                      Operator role required
                    </p>
                    <p className="text-red-200/90">{roleRefusal}</p>
                  </div>
                </motion.div>
              ) : null}

              {error ? (
                <motion.div
                  key="login-error"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  role="alert"
                  data-testid="login.error"
                  className="mb-6 flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400"
                >
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span className="text-sm">{error}</span>
                </motion.div>
              ) : null}
            </AnimatePresence>

            {step === "phone" ? (
              <form
                onSubmit={(e) => {
                  void handlePhoneSubmit(e);
                }}
                className="space-y-6"
                data-testid="login.phone-form"
              >
                <div className="space-y-2">
                  <label
                    htmlFor="phone"
                    className="block text-sm font-medium text-gray-300"
                  >
                    Operator phone number
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                    <input
                      id="phone"
                      name="phone"
                      type="tel"
                      autoComplete="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+2348012345678"
                      className="w-full pl-10 pr-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition"
                      required
                    />
                  </div>
                  <p className="text-xs text-gray-500">
                    Use the E.164 phone number registered to your UBI operator
                    account.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  data-testid="login.send-code"
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-green-600 hover:bg-green-500 disabled:bg-green-600/50 text-white font-medium rounded-lg transition"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Sending verification code…
                    </>
                  ) : (
                    "Send verification code"
                  )}
                </button>
              </form>
            ) : (
              <form
                onSubmit={(e) => {
                  void handleOtpSubmit(e);
                }}
                className="space-y-6"
                data-testid="login.otp-form"
              >
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      setStep("phone");
                      setCode("");
                      setError(null);
                      setRoleRefusal(null);
                    }}
                    className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Use a different number
                  </button>
                  <span className="text-xs text-gray-500">{phone.trim()}</span>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="otp-code"
                    className="block text-sm font-medium text-gray-300"
                  >
                    6-digit verification code
                  </label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                    <input
                      id="otp-code"
                      name="code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={code}
                      onChange={(e) =>
                        setCode(e.target.value.replace(/\D/g, ""))
                      }
                      placeholder="123456"
                      className="w-full pl-10 pr-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white tracking-widest font-mono placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition"
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  data-testid="login.verify-code"
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-green-600 hover:bg-green-500 disabled:bg-green-600/50 text-white font-medium rounded-lg transition"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Verifying…
                    </>
                  ) : (
                    "Verify & sign in"
                  )}
                </button>

                <div className="text-center">
                  <button
                    type="button"
                    disabled={isLoading || resendCooldown > 0}
                    onClick={() => {
                      void requestCode(phone);
                    }}
                    className="text-xs text-green-500 hover:text-green-400 disabled:text-gray-500 transition"
                  >
                    {resendCooldown > 0
                      ? `Resend code in ${resendCooldown}s`
                      : "Resend verification code"}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        <p className="text-center text-xs text-gray-600 mt-6">
          Authorised UBI operators only. Sign-in attempts, device verifications,
          and administrative actions are recorded in the audit log.
        </p>
      </motion.div>
    </div>
  );
};
