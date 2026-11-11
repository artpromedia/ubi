"use client";

import { Loader2 } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import { CitySelectionCard } from "@/components/auth/CitySelectionCard";
import { DeviceStepUpCard } from "@/components/auth/DeviceStepUpCard";
import { FleetGate, FleetProvider } from "@/components/fleet/fleet-context";
import { FleetHeader, Sidebar } from "@/components/layout/navigation";
import { REFRESH_BUFFER_MS, type PublicFleetSession } from "@/lib/session";
import { FLEET_ACCOUNT_TEST_IDS, FLEET_STATE_TEST_IDS } from "@/lib/test-ids";

export interface FleetSessionContextValue {
  readonly session: PublicFleetSession | null;
  readonly isLoading: boolean;
  readonly setSession: (next: PublicFleetSession | null) => void;
  readonly refreshSession: () => Promise<PublicFleetSession | null>;
  readonly signOut: () => Promise<void>;
}

const DEFAULT_CONTEXT: FleetSessionContextValue = {
  session: null,
  isLoading: false,
  setSession: () => undefined,
  refreshSession: async () => {
    await Promise.resolve();
    return null;
  },
  signOut: async () => {
    await Promise.resolve();
  },
};

const FleetSessionContext =
  createContext<FleetSessionContextValue>(DEFAULT_CONTEXT);

export function useFleetSession(): FleetSessionContextValue {
  return useContext(FleetSessionContext);
}

interface SessionEnvelope {
  success?: boolean;
  data?: { session?: PublicFleetSession };
  error?: { code?: string };
}

function redirectToLogin(reason?: string): void {
  if (typeof globalThis.location === "undefined") {
    return;
  }
  const currentPath = `${globalThis.location.pathname}${globalThis.location.search}`;
  const encoded = encodeURIComponent(currentPath || "/dashboard");
  const reasonQuery = reason ? `reason=${encodeURIComponent(reason)}&` : "";
  globalThis.location.assign(`/login?${reasonQuery}next=${encoded}`);
}

export const FleetSessionProvider = ({
  children,
  initialSession = null,
}: {
  readonly children: ReactNode;
  readonly initialSession?: PublicFleetSession | null;
}): ReactElement => {
  const [session, setSession] = useState<PublicFleetSession | null>(
    initialSession,
  );
  const [isLoading, setIsLoading] = useState<boolean>(initialSession === null);

  const refreshSession =
    useCallback(async (): Promise<PublicFleetSession | null> => {
      try {
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "same-origin",
        });
        if (!res.ok) {
          const payload = (await res
            .json()
            .catch(() => ({}))) as SessionEnvelope;
          setSession(null);
          redirectToLogin(
            payload.error?.code === "session_ended"
              ? "session_ended"
              : undefined,
          );
          return null;
        }
        const payload = (await res.json()) as SessionEnvelope;
        const next = payload.data?.session ?? null;
        setSession(next);
        return next;
      } catch {
        return null;
      }
    }, []);

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } finally {
      setSession(null);
      if (typeof globalThis.location !== "undefined") {
        globalThis.location.assign("/login");
      }
    }
  }, []);

  // Load the current cookie-backed session on mount when not pre-hydrated.
  useEffect(() => {
    if (initialSession !== null) {
      return;
    }
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const res = await fetch("/api/auth/session", {
          method: "GET",
          credentials: "same-origin",
        });
        if (cancelled) {
          return;
        }
        if (!res.ok) {
          const payload = (await res
            .json()
            .catch(() => ({}))) as SessionEnvelope;
          setSession(null);
          setIsLoading(false);
          redirectToLogin(
            payload.error?.code === "session_ended"
              ? "session_ended"
              : undefined,
          );
          return;
        }
        const payload = (await res.json()) as SessionEnvelope;
        setSession(payload.data?.session ?? null);
      } catch {
        // Keep loading false so offline states surface honestly.
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [initialSession]);

  // Proactive refresh timer before access-token expiry while the portal stays open.
  useEffect(() => {
    if (session === null) {
      return;
    }
    const msUntilRefresh = Math.max(
      5_000,
      session.expiresAt - Date.now() - REFRESH_BUFFER_MS,
    );
    const timer = setTimeout(() => {
      void refreshSession();
    }, msUntilRefresh);
    return () => {
      clearTimeout(timer);
    };
  }, [session, refreshSession]);

  const value = useMemo<FleetSessionContextValue>(
    () => ({
      session,
      isLoading,
      setSession,
      refreshSession,
      signOut,
    }),
    [session, isLoading, refreshSession, signOut],
  );

  return (
    <FleetSessionContext.Provider value={value}>
      {children}
    </FleetSessionContext.Provider>
  );
};

/**
 * Rendered across every `(portal)` route when `session.mode === "limited"`.
 *
 * Replaces `{children}` completely so an unverified device sees a clear
 * "Verify this browser" state and ZERO fleet action buttons (CC-C01).
 */
export const LimitedModeGate = ({
  session,
  onVerified,
  onSignOut,
}: {
  readonly session: PublicFleetSession;
  readonly onVerified: (nextSession: PublicFleetSession) => void;
  readonly onSignOut: () => Promise<void> | void;
}): ReactElement => (
  <div
    className="max-w-xl mx-auto py-10"
    data-testid={FLEET_ACCOUNT_TEST_IDS.signIn.limitedModeGate}
  >
    <DeviceStepUpCard
      session={session}
      onVerified={onVerified}
      onSignOut={onSignOut}
    />
  </div>
);

export const CitySelectionGate = ({
  session,
  onSelected,
  onSignOut,
}: {
  readonly session: PublicFleetSession;
  readonly onSelected: (nextSession: PublicFleetSession) => void;
  readonly onSignOut: () => Promise<void> | void;
}): ReactElement => (
  <div className="max-w-xl mx-auto py-10">
    <CitySelectionCard
      session={session}
      onSelected={onSelected}
      onSignOut={onSignOut}
    />
  </div>
);

export const FleetAuthShell = ({
  children,
}: {
  readonly children: ReactNode;
}): ReactElement => {
  const { session, isLoading, setSession, signOut } = useFleetSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (isLoading) {
    return (
      <div
        className="min-h-screen bg-[#121212] flex items-center justify-center text-zinc-400 gap-2 text-sm"
        data-testid={FLEET_STATE_TEST_IDS.loading}
      >
        <Loader2 className="w-4 h-4 animate-spin text-[#1DB954]" />
        <span>Verifying your UBI session…</span>
      </div>
    );
  }

  if (session === null) {
    return (
      <div
        className="min-h-screen bg-[#121212] flex items-center justify-center text-zinc-400 text-sm"
        data-testid={FLEET_STATE_TEST_IDS.access("unauthenticated")}
      >
        Signed out · Redirecting to sign in…
      </div>
    );
  }

  const isCityMissing = session.user.homeCityId === null;
  const isLimited = session.mode === "limited";

  if (isCityMissing || isLimited) {
    return (
      <div className="min-h-screen bg-[#121212] text-zinc-100">
        <Sidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          session={session}
          onSignOut={signOut}
        />
        <div className="lg:ml-64">
          <FleetHeader
            onMenuClick={() => setSidebarOpen(true)}
            session={session}
          />
          <main className="p-4 lg:p-6">
            {isCityMissing ? (
              <CitySelectionGate
                session={session}
                onSelected={(next) => setSession(next)}
                onSignOut={signOut}
              />
            ) : (
              <LimitedModeGate
                session={session}
                onVerified={(next) => setSession(next)}
                onSignOut={signOut}
              />
            )}
          </main>
        </div>
      </div>
    );
  }

  return (
    <FleetProvider>
      <div className="min-h-screen bg-[#121212] text-zinc-100">
        <Sidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          session={session}
          onSignOut={signOut}
        />
        <div className="lg:ml-64">
          <FleetHeader
            onMenuClick={() => setSidebarOpen(true)}
            session={session}
          />
          <main className="p-4 lg:p-6">
            <FleetGate>{children}</FleetGate>
          </main>
        </div>
      </div>
    </FleetProvider>
  );
};
