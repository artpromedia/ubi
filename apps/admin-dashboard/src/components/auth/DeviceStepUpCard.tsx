"use client";

import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Fingerprint,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Smartphone,
} from "lucide-react";
import {
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactElement,
} from "react";

import type { PublicAdminSession } from "@/lib/session";

export interface DeviceStepUpCardProps {
  readonly session: PublicAdminSession;
  readonly onVerified: (nextSession: PublicAdminSession) => void;
  readonly onSignOut: () => Promise<void> | void;
}

interface RefreshApiResponse {
  success?: boolean;
  data?: { session?: PublicAdminSession };
  error?: { code?: string; message?: string };
}

interface SelfieApiResponse {
  success?: boolean;
  data?: {
    status?: "passed" | "failed";
    reason?: string | null;
    appealMessage?: string | null;
    session?: PublicAdminSession;
  };
  error?: { code?: string; message?: string };
}

export const DeviceStepUpCard = ({
  session,
  onVerified,
  onSignOut,
}: DeviceStepUpCardProps): ReactElement => {
  const challengeId = session.stepUp?.challengeId ?? "";
  const methods = session.stepUp?.methods ?? [
    "old_device_approve",
    "selfie_nin",
  ];
  const canOldDevice = methods.includes("old_device_approve");
  const canSelfieNin = methods.includes("selfie_nin");

  const [nin, setNin] = useState("");
  const [imageBase64, setImageBase64] = useState("");
  const [fileName, setFileName] = useState("");
  const [isCheckingApproval, setIsCheckingApproval] = useState(false);
  const [isSubmittingSelfie, setIsSubmittingSelfie] = useState(false);
  const [copied, setCopied] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCopyChallenge = async (): Promise<void> => {
    if (!challengeId || typeof navigator === "undefined") {
      return;
    }
    try {
      await navigator.clipboard.writeText(challengeId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked in non-HTTPS contexts; operator can copy text directly.
    }
  };

  const handleCheckApproval = async (): Promise<void> => {
    setError(null);
    setStatusMessage(null);
    setIsCheckingApproval(true);
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "same-origin",
      });
      const payload = (await res.json()) as RefreshApiResponse;
      if (!res.ok || !payload.data?.session) {
        setError(
          payload.error?.message ??
            "Could not check verification status. Sign in again if your session ended.",
        );
        return;
      }
      if (payload.data.session.mode === "full") {
        onVerified(payload.data.session);
        return;
      }
      setStatusMessage(
        "This device is still awaiting verification. Approve the challenge on a verified device or complete NIN + selfie verification below.",
      );
    } catch {
      setError("Network error while checking device verification status.");
    } finally {
      setIsCheckingApproval(false);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setFileName(file.name);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const commaIdx = result.indexOf(",");
      const rawB64 = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
      setImageBase64(rawB64);
    };
    reader.onerror = () => {
      setError("Could not read the selected image file.");
    };
    reader.readAsDataURL(file);
  };

  const handleSelfieSubmit = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setError(null);
    setStatusMessage(null);

    const trimmedNin = nin.trim();
    if (!/^\d{11}$/.test(trimmedNin)) {
      setError("Enter a valid 11-digit National Identity Number (NIN).");
      return;
    }
    if (imageBase64.length < 64) {
      setError("Select or capture a clear selfie photo before submitting.");
      return;
    }

    setIsSubmittingSelfie(true);
    try {
      const res = await fetch("/api/auth/step-up/selfie", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId,
          nin: trimmedNin,
          imageBase64,
        }),
      });
      const payload = (await res.json()) as SelfieApiResponse;
      if (!res.ok) {
        setError(
          payload.error?.message ??
            "Device verification failed. Check your details and try again.",
        );
        return;
      }
      if (payload.data?.status === "passed" && payload.data.session) {
        onVerified(payload.data.session);
        return;
      }
      setError(
        payload.data?.appealMessage ??
          "Identity verification did not match. Try again in clear lighting or approve from an already-verified device.",
      );
    } catch {
      setError("Network error while submitting device verification.");
    } finally {
      setIsSubmittingSelfie(false);
    }
  };

  return (
    <div
      className="bg-gray-900 rounded-2xl border border-amber-500/30 p-6 lg:p-8 space-y-6"
      data-testid="admin.step-up-card"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
          <ShieldAlert className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white">
            Verify this device
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            You signed in on a new browser or device. For security, operator
            dashboards and actions stay locked until this device completes a
            second check.
          </p>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {statusMessage ? (
        <div
          role="status"
          className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-200 text-sm"
        >
          <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{statusMessage}</span>
        </div>
      ) : null}

      {canOldDevice && challengeId ? (
        <div className="rounded-xl bg-gray-950/70 border border-gray-800 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <Smartphone className="w-4 h-4 text-green-400" />
            <span>Option 1: Approve from an already-verified device</span>
          </div>
          <p className="text-xs text-gray-400">
            Open UBI Admin on a browser you have already verified, select{" "}
            <strong className="text-gray-200">Approve device</strong> in the top
            bar, and enter this challenge ID:
          </p>
          <div className="flex items-center gap-2">
            <code
              className="flex-1 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-xs text-green-300 font-mono select-all break-all"
              data-testid="admin.step-up-challenge-id"
            >
              {challengeId}
            </code>
            <button
              type="button"
              onClick={() => {
                void handleCopyChallenge();
              }}
              className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-xs text-gray-200 flex items-center gap-1.5 transition"
            >
              <Copy className="w-3.5 h-3.5" />
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <button
            type="button"
            disabled={isCheckingApproval}
            onClick={() => {
              void handleCheckApproval();
            }}
            data-testid="admin.step-up-check-approval"
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 border border-gray-700 text-sm text-white font-medium transition"
          >
            {isCheckingApproval ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Checking verification status…
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />I approved this device —
                continue
              </>
            )}
          </button>
        </div>
      ) : null}

      {canSelfieNin && challengeId ? (
        <form
          onSubmit={(e) => {
            void handleSelfieSubmit(e);
          }}
          className="rounded-xl bg-gray-950/70 border border-gray-800 p-4 space-y-4"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <Fingerprint className="w-4 h-4 text-green-400" />
            <span>Option 2: Verify with NIN &amp; liveness selfie</span>
          </div>
          <p className="text-xs text-gray-400">
            Your photo is forwarded to the identity verifier for a one-time
            match and immediately discarded — UBI stores only the verification
            outcome.
          </p>

          <div className="space-y-1.5">
            <label
              htmlFor="step-up-nin"
              className="block text-xs font-medium text-gray-300"
            >
              11-digit National Identity Number (NIN)
            </label>
            <input
              id="step-up-nin"
              type="text"
              inputMode="numeric"
              maxLength={11}
              value={nin}
              onChange={(e) => setNin(e.target.value.replace(/\D/g, ""))}
              placeholder="12345678901"
              className="w-full px-3 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="step-up-selfie"
              className="block text-xs font-medium text-gray-300"
            >
              Live selfie photo
            </label>
            <input
              id="step-up-selfie"
              type="file"
              accept="image/*"
              capture="user"
              onChange={handleFileChange}
              className="w-full text-xs text-gray-300 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-gray-800 file:text-white hover:file:bg-gray-700"
            />
            {fileName ? (
              <p className="text-xs text-gray-400">Selected: {fileName}</p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={isSubmittingSelfie}
            data-testid="admin.step-up-selfie-submit"
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-green-600 hover:bg-green-500 disabled:bg-green-600/50 text-sm text-white font-medium transition"
          >
            {isSubmittingSelfie ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Verifying identity…
              </>
            ) : (
              "Verify this device"
            )}
          </button>
        </form>
      ) : null}

      <div className="pt-2 border-t border-gray-800 flex items-center justify-between text-xs text-gray-400">
        <span>
          Signed in as{" "}
          <strong className="text-gray-200">{session.user.phone}</strong>
        </span>
        <button
          type="button"
          onClick={() => {
            void onSignOut();
          }}
          data-testid="admin.step-up-signout"
          className="text-red-400 hover:text-red-300 font-medium transition"
        >
          Sign out
        </button>
      </div>
    </div>
  );
};
