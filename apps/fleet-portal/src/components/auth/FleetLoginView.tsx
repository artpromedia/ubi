"use client";

import {
  AlertCircle,
  ArrowLeft,
  Car,
  KeyRound,
  Loader2,
  LogOut,
  Phone,
  ShieldX,
} from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactElement } from "react";

import { CitySelectionCard } from "@/components/auth/CitySelectionCard";
import { DeviceStepUpCard } from "@/components/auth/DeviceStepUpCard";
import { sanitizeNextPath, type PublicFleetSession } from "@/lib/session";
import { FLEET_ACCOUNT_TEST_IDS } from "@/lib/test-ids";

const E164_RE = /^\+[1-9]\d{7,14}$/;

type LoginStep = "phone" | "otp" | "city" | "step_up";

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
    session?: PublicFleetSession;
    citySelectionRequired?: boolean;
  };
  error?: {
    code?: string;
    message?: string;
    details?: { role?: string };
  };
}

export const FleetLoginView = ({
  nextPath = "/dashboard",
  reason = null,
}: {
  readonly nextPath?: string;
  readonly reason?: string | null;
}): ReactElement => {
  const safeNext = sanitizeNextPath(nextPath);

  const [step, setStep] = useState<LoginStep>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roleRefusal, setRoleRefusal] = useState<string | null>(null);
  const [suspendedMessage, setSuspendedMessage] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<PublicFleetSession | null>(
    null,
  );

  useEffect(() => {
    if (resendCooldown <= 0) {
      return;
    }
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const navigateToPortal = (): void => {
    if (typeof globalThis.location !== "undefined") {
      globalThis.location.assign(safeNext);
    }
  };

  const advanceAfterSessionState = (nextSession: PublicFleetSession): void => {
    setActiveSession(nextSession);
    if (nextSession.user.homeCityId === null) {
      setStep("city");
      return;
    }
    if (nextSession.mode === "limited") {
      setStep("step_up");
      return;
    }
    navigateToPortal();
  };

  const requestCode = async (targetPhone: string): Promise<boolean> => {
    setError(null);
    setRoleRefusal(null);
    setSuspendedMessage(null);
    const normalized = targetPhone.trim();
    if (!E164_RE.test(normalized)) {
      setError(
        "Enter your UBI phone number in international format (for example, +2348012345678).",
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
      if (res.status === 403 && /suspend/i.test(payload.error?.message ?? "")) {
        setSuspendedMessage(
          payload.error?.message ??
            "This UBI account is suspended. Contact UBI support for assistance.",
        );
        return false;
      }
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
    setSuspendedMessage(null);

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

      if (res.status === 403) {
        const msg = payload.error?.message ?? "";
        if (/suspend/i.test(msg)) {
          setSuspendedMessage(
            msg ||
              "This UBI account is suspended. Contact UBI support for assistance.",
          );
          setCode("");
          return;
        }
        setRoleRefusal(
          msg ||
            "This account does not have access to the UBI Fleet Portal. Sign in with a UBI account linked to your fleet.",
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

      advanceAfterSessionState(payload.data.session);
    } catch {
      setError("Cannot reach UBI authentication right now. Check connection.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOutFromFlow = async (): Promise<void> => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } finally {
      setActiveSession(null);
      setCode("");
      setStep("phone");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0B0B0B] p-4 text-zinc-100">
      <div className="relative w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[rgba(29,185,84,0.16)] border border-[#1DB954]/40 mb-4">
            <Car className="w-7 h-7 text-[#1DB954]" />
          </div>
          <h1 className="text-2xl font-bold text-zinc-100">UBI Fleet Portal</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Sign in with the phone number on your UBI account
          </p>
        </div>

        {step === "city" && activeSession ? (
          <CitySelectionCard
            session={activeSession}
            onSelected={(updated) => advanceAfterSessionState(updated)}
            onSignOut={handleSignOutFromFlow}
          />
        ) : step === "step_up" && activeSession ? (
          <DeviceStepUpCard
            session={activeSession}
            onVerified={(updated) => advanceAfterSessionState(updated)}
            onSignOut={handleSignOutFromFlow}
          />
        ) : (
          <div className="rounded-2xl border border-[#1F1F1F] bg-[#141414] p-6 lg:p-8 space-y-6">
            {reason === "session_ended" ? (
              <div
                role="status"
                data-testid={FLEET_ACCOUNT_TEST_IDS.signIn.signedOutElsewhere}
                className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-100 text-sm"
              >
                <LogOut className="w-4 h-4 text-amber-300 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold">Session ended</p>
                  <p className="text-zinc-300 text-xs mt-0.5">
                    Your session expired or was signed out from another device.
                    Sign in again to open your fleet.
                  </p>
                </div>
              </div>
            ) : null}

            {suspendedMessage ? (
              <div
                role="alert"
                data-testid={FLEET_ACCOUNT_TEST_IDS.signIn.accountSuspended}
                className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 text-sm"
              >
                <ShieldX className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p className="font-semibold text-red-200">
                    Account suspended
                  </p>
                  <p className="text-red-200/90 text-xs">{suspendedMessage}</p>
                </div>
              </div>
            ) : null}

            {roleRefusal ? (
              <div
                role="alert"
                data-testid={FLEET_ACCOUNT_TEST_IDS.signIn.roleRefused}
                className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 text-sm"
              >
                <ShieldX className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p className="font-semibold text-red-200">
                    Not available for this account
                  </p>
                  <p className="text-red-200/90 text-xs">{roleRefusal}</p>
                </div>
              </div>
            ) : null}

            {error ? (
              <div
                role="alert"
                data-testid={FLEET_ACCOUNT_TEST_IDS.signIn.error}
                className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            {step === "phone" ? (
              <form
                onSubmit={(e) => {
                  void handlePhoneSubmit(e);
                }}
                className="space-y-5"
                data-testid={FLEET_ACCOUNT_TEST_IDS.signIn.phoneForm}
              >
                <div className="space-y-2">
                  <label
                    htmlFor="fleet-phone"
                    className="block text-sm font-medium text-zinc-200"
                  >
                    Phone number
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                    <input
                      id="fleet-phone"
                      name="phone"
                      type="tel"
                      autoComplete="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+2348012345678"
                      data-testid={FLEET_ACCOUNT_TEST_IDS.signIn.phoneInput}
                      className="w-full pl-10 pr-4 py-3 bg-[#0F0F0F] border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#1DB954] focus:border-transparent transition"
                      required
                    />
                  </div>
                  <p className="text-xs text-zinc-400">
                    Enter your phone number in international format (E.164).
                    Your fleet role is verified after sign-in.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  data-testid={FLEET_ACCOUNT_TEST_IDS.signIn.sendCode}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-[#1DB954] hover:bg-[#19a349] disabled:bg-[#1DB954]/50 text-black font-semibold rounded-lg transition"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Sending one-time code…
                    </>
                  ) : (
                    "Send one-time code"
                  )}
                </button>
              </form>
            ) : (
              <form
                onSubmit={(e) => {
                  void handleOtpSubmit(e);
                }}
                className="space-y-5"
                data-testid={FLEET_ACCOUNT_TEST_IDS.signIn.otpForm}
              >
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    data-testid={FLEET_ACCOUNT_TEST_IDS.signIn.changePhone}
                    onClick={() => {
                      setStep("phone");
                      setCode("");
                      setError(null);
                      setRoleRefusal(null);
                      setSuspendedMessage(null);
                    }}
                    className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 transition"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Use a different number
                  </button>
                  <span className="text-xs text-zinc-400">{phone.trim()}</span>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="fleet-otp-code"
                    className="block text-sm font-medium text-zinc-200"
                  >
                    6-digit verification code
                  </label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                    <input
                      id="fleet-otp-code"
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
                      data-testid={FLEET_ACCOUNT_TEST_IDS.signIn.codeInput}
                      className="w-full pl-10 pr-4 py-3 bg-[#0F0F0F] border border-zinc-700 rounded-lg text-zinc-100 tracking-widest font-mono placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#1DB954] focus:border-transparent transition"
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  data-testid={FLEET_ACCOUNT_TEST_IDS.signIn.verifyCode}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-[#1DB954] hover:bg-[#19a349] disabled:bg-[#1DB954]/50 text-black font-semibold rounded-lg transition"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Verifying…
                    </>
                  ) : (
                    "Verify & open fleet"
                  )}
                </button>

                <div className="text-center">
                  <button
                    type="button"
                    disabled={isLoading || resendCooldown > 0}
                    data-testid={FLEET_ACCOUNT_TEST_IDS.signIn.resendCode}
                    onClick={() => {
                      void requestCode(phone);
                    }}
                    className="text-xs text-[#86EFAC] hover:text-white disabled:text-zinc-500 transition"
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

        <p className="text-center text-xs text-zinc-500">
          Fleet staff sign in with their UBI account. Sign-in attempts, browser
          trust checks, and staff role changes are recorded in the audit log.
        </p>
      </div>
    </div>
  );
};
