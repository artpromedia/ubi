"use client";

import { AlertCircle, Globe2, Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactElement } from "react";

import type { PublicFleetSession } from "@/lib/session";
import { FLEET_ACCOUNT_TEST_IDS } from "@/lib/test-ids";

interface LaunchedCity {
  id: string;
  name: string;
  country: string;
}

export interface CitySelectionCardProps {
  readonly session: PublicFleetSession;
  readonly onSelected: (nextSession: PublicFleetSession) => void;
  readonly onSignOut: () => Promise<void> | void;
}

export const CitySelectionCard = ({
  session,
  onSelected,
  onSignOut,
}: CitySelectionCardProps): ReactElement => {
  const [cities, setCities] = useState<LaunchedCity[]>([
    { id: "LOS", name: "Lagos", country: "NG" },
  ]);
  const [selectedCityId, setSelectedCityId] = useState("LOS");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadCities = async (): Promise<void> => {
      try {
        const res = await fetch("/api/auth/cities", {
          method: "GET",
          credentials: "same-origin",
        });
        if (!res.ok || cancelled) {
          return;
        }
        const payload = (await res.json()) as {
          data?: { cities?: LaunchedCity[] };
        };
        const list = payload.data?.cities ?? [];
        if (list.length > 0 && !cancelled) {
          setCities(list);
          setSelectedCityId(list[0]?.id ?? "LOS");
        }
      } catch {
        // Fallback to Lagos when city list endpoint cannot be reached.
      }
    };
    void loadCities();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/city", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `flt-city-${session.user.id}-${selectedCityId}`,
        },
        body: JSON.stringify({ cityId: selectedCityId }),
      });
      const payload = (await res.json()) as {
        data?: { session?: PublicFleetSession };
        error?: { message?: string };
      };
      if (!res.ok || !payload.data?.session) {
        setError(
          payload.error?.message ??
            "Could not set your home city right now. Try again.",
        );
        return;
      }
      onSelected(payload.data.session);
    } catch {
      setError("Network error while saving your city.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      data-testid={FLEET_ACCOUNT_TEST_IDS.signIn.cityForm}
      className="rounded-2xl border border-zinc-800 bg-[#141414] p-6 lg:p-8 space-y-6"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-[rgba(29,185,84,0.12)] border border-[#1DB954]/30 flex items-center justify-center flex-shrink-0">
          <Globe2 className="w-5 h-5 text-[#1DB954]" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">
            Choose your operating city
          </h2>
          <p className="text-sm text-zinc-400 mt-1">
            Your UBI account has no home city recorded yet. Fleet schedules,
            remittance caps, and KYB rules are enforced per city.
          </p>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-200 text-sm"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="space-y-2">
        <label
          htmlFor="fleet-city-select"
          className="block text-sm font-medium text-zinc-300"
        >
          Launched UBI city
        </label>
        <select
          id="fleet-city-select"
          value={selectedCityId}
          onChange={(e) => setSelectedCityId(e.target.value)}
          data-testid={FLEET_ACCOUNT_TEST_IDS.signIn.citySelect}
          className="w-full px-3 py-3 bg-[#0F0F0F] border border-zinc-700 rounded-lg text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#1DB954]"
        >
          {cities.map((city) => (
            <option key={city.id} value={city.id}>
              {city.name} ({city.id} · {city.country})
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        data-testid={FLEET_ACCOUNT_TEST_IDS.signIn.cityConfirm}
        className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg bg-[#1DB954] hover:bg-[#19a349] disabled:bg-[#1DB954]/50 text-sm text-black font-semibold transition"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Saving city…
          </>
        ) : (
          "Confirm city & continue"
        )}
      </button>

      <div className="pt-2 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-400">
        <span>
          Signed in as{" "}
          <strong className="text-zinc-200">{session.user.phone}</strong>
        </span>
        <button
          type="button"
          onClick={() => {
            void onSignOut();
          }}
          data-testid={FLEET_ACCOUNT_TEST_IDS.signIn.signOut}
          className="text-red-400 hover:text-red-300 font-medium transition"
        >
          Sign out
        </button>
      </div>
    </form>
  );
};
