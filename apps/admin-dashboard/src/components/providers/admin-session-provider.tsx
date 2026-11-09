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

import { DeviceStepUpCard } from "@/components/auth/DeviceStepUpCard";
import { AdminHeader, Sidebar } from "@/components/layout/navigation";
import { REFRESH_BUFFER_MS, type PublicAdminSession } from "@/lib/session";

export interface AdminSessionContextValue {
  readonly session: PublicAdminSession | null;
  readonly isLoading: boolean;
  readonly setSession: (next: PublicAdminSession | null) => void;
  readonly refreshSession: () => Promise<PublicAdminSession | null>;
  readonly signOut: () => Promise<void>;
}

const DEFAULT_CONTEXT: AdminSessionContextValue = {
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

const AdminSessionContext =
  createContext<AdminSessionContextValue>(DEFAULT_CONTEXT);

export function useAdminSession(): AdminSessionContextValue {
  return useContext(AdminSessionContext);
}

interface SessionEnvelope {
  success?: boolean;
  data?: { session?: PublicAdminSession };
}

function redirectToLoginWithCurrentPath(): void {
  if (typeof globalThis.location === "undefined") {
    return;
  }
  const currentPath = `${globalThis.location.pathname}${globalThis.location.search}`;
  const encoded = encodeURIComponent(currentPath || "/dashboard");
  globalThis.location.assign(`/login?next=${encoded}`);
}

export const AdminSessionProvider = ({
  children,
  initialSession = null,
}: {
  readonly children: ReactNode;
  readonly initialSession?: PublicAdminSession | null;
}): ReactElement => {
  const [session, setSession] = useState<PublicAdminSession | null>(
    initialSession,
  );
  const [isLoading, setIsLoading] = useState<boolean>(initialSession === null);

  const refreshSession =
    useCallback(async (): Promise<PublicAdminSession | null> => {
      try {
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "same-origin",
        });
        if (!res.ok) {
          setSession(null);
          redirectToLoginWithCurrentPath();
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
          setSession(null);
          setIsLoading(false);
          redirectToLoginWithCurrentPath();
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

  // Proactive refresh timer before access-token expiry while the console stays open.
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

  const value = useMemo<AdminSessionContextValue>(
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
    <AdminSessionContext.Provider value={value}>
      {children}
    </AdminSessionContext.Provider>
  );
};

/**
 * Rendered across every `(admin)` route when `session.mode === "limited"`.
 *
 * Replaces `{children}` completely so an unverified device sees a clear
 * "Verify this device" state and ZERO admin action buttons (CC-B05 #4).
 */
export const LimitedModeGate = ({
  session,
  onVerified,
  onSignOut,
}: {
  readonly session: PublicAdminSession;
  readonly onVerified: (nextSession: PublicAdminSession) => void;
  readonly onSignOut: () => Promise<void> | void;
}): ReactElement => {
  return (
    <div
      className="max-w-xl mx-auto py-10"
      data-testid="admin.limited-mode-gate"
    >
      <DeviceStepUpCard
        session={session}
        onVerified={onVerified}
        onSignOut={onSignOut}
      />
    </div>
  );
};

export const AdminShell = ({
  children,
}: {
  readonly children: ReactNode;
}): ReactElement => {
  const { session, isLoading, setSession, signOut } = useAdminSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (isLoading) {
    return (
      <div
        className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400 gap-2 text-sm"
        data-testid="admin.session-loading"
      >
        <Loader2 className="w-5 h-5 animate-spin text-green-500" />
        <span>Verifying operator session…</span>
      </div>
    );
  }

  if (session === null) {
    return (
      <div
        className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400 text-sm"
        data-testid="admin.session-unauthenticated"
      >
        Redirecting to sign in…
      </div>
    );
  }

  const isLimited = session.mode === "limited";

  return (
    <div className="min-h-screen bg-gray-950">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        session={session}
        onSignOut={signOut}
      />

      <div className="lg:ml-72">
        <AdminHeader
          onMenuClick={() => setSidebarOpen(true)}
          session={session}
        />
        <main className="p-4 lg:p-6">
          {isLimited ? (
            <LimitedModeGate
              session={session}
              onVerified={(next) => setSession(next)}
              onSignOut={signOut}
            />
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
};
