/**
 * Admin console session & cookie primitives (CC-B05).
 *
 * Uses Web Crypto (`crypto.subtle`) so the exact same HMAC-SHA256 cookie seal
 * and verification runs in Next.js Edge Middleware (`src/middleware.ts`), Node
 * Route Handlers (`src/app/api/**`), and Vitest tests.
 *
 * Security invariants:
 *  - Access and refresh tokens live ONLY inside the `HttpOnly`, `SameSite=Strict`
 *    session cookie (`ubi_admin_session`), never in `localStorage` or JS-visible
 *    responses.
 *  - Only operator roles (`ADMIN_CONSOLE_ROLES`) may hold an admin session;
 *    end-user roles (`rider`, `driver`, `merchant`, `restaurant`, `fleet_manager`)
 *    are refused even with a valid OTP.
 *  - Sessions refresh proactively before access-token expiry (`REFRESH_BUFFER_MS`)
 *    using `/v1/auth/refresh` and clear + revoke on sign-out.
 */

export const ADMIN_SESSION_COOKIE = "ubi_admin_session";
export const ADMIN_DEVICE_COOKIE = "ubi_admin_device_id";

/** Refresh 2 minutes before the 15-minute access token expires. */
export const REFRESH_BUFFER_MS = 2 * 60 * 1000;

/** 7 days, matching user-service rotatable session lifetime. */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** 1 year so a trusted browser keeps its enrolled device identity across logouts. */
export const DEVICE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

const DEV_FALLBACK_SECRET =
  "ubi-admin-dev-session-secret-not-for-production-32b";

export const ADMIN_CONSOLE_ROLES = [
  "admin",
  "super_admin",
  "ops_admin",
  "finance_ops",
  "ops",
  "config_admin",
  "travel_ops",
  "support_lead",
  "support_agent",
  "safety_responder",
  "reviewer",
  "growth_admin",
  "growth_editor",
  "ai_ops",
] as const;

export type AdminConsoleRole = (typeof ADMIN_CONSOLE_ROLES)[number];

const ADMIN_ROLE_SET: ReadonlySet<string> = new Set(ADMIN_CONSOLE_ROLES);

const ROLE_LABELS: Readonly<Record<string, string>> = {
  super_admin: "Super Admin",
  admin: "Admin",
  ops_admin: "Operations Admin",
  finance_ops: "Finance Ops",
  ops: "Operations",
  config_admin: "Config Admin",
  travel_ops: "Travel Ops",
  support_lead: "Support Lead",
  support_agent: "Support Agent",
  safety_responder: "Safety Responder",
  reviewer: "Identity Reviewer",
  growth_admin: "Growth Admin",
  growth_editor: "Growth Editor",
  ai_ops: "AI Ops",
};

export function isAdminConsoleRole(role: string | null | undefined): boolean {
  if (typeof role !== "string" || role.trim().length === 0) {
    return false;
  }
  return ADMIN_ROLE_SET.has(role.trim().toLowerCase());
}

export function formatAdminRole(role: string): string {
  const key = role.trim().toLowerCase();
  return ROLE_LABELS[key] ?? role;
}

export interface AdminUserSummary {
  id: string;
  phone: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  homeCityId: string | null;
}

export interface AdminStepUpState {
  required: boolean;
  challengeId: string | null;
  methods: string[];
  unavailable?: Record<string, string>;
}

export interface AdminSessionData {
  user: AdminUserSummary;
  accessToken: string;
  refreshToken: string;
  deviceId: string;
  mode: "full" | "limited";
  /** Epoch milliseconds when `accessToken` expires. */
  expiresAt: number;
  stepUp: AdminStepUpState | null;
}

/** Client-safe view returned to React components (never carries raw tokens). */
export interface PublicAdminSession {
  user: AdminUserSummary;
  mode: "full" | "limited";
  expiresAt: number;
  stepUp: AdminStepUpState | null;
}

export function toPublicSession(session: AdminSessionData): PublicAdminSession {
  return {
    user: session.user,
    mode: session.mode,
    expiresAt: session.expiresAt,
    stepUp: session.stepUp,
  };
}

/**
 * Validates a post-login `next` redirect target so `/login?next=...` can never
 * become an open redirect (`https://evil.test`, `//evil.test`, `/\evil.test`) or
 * a redirect loop (`/login`, `/api/*`).
 */
export function sanitizeNextPath(raw: string | null | undefined): string {
  if (typeof raw !== "string") {
    return "/dashboard";
  }
  const trimmed = raw.trim();
  if (
    trimmed.length === 0 ||
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/\\") ||
    /[\r\n\0]/.test(trimmed)
  ) {
    return "/dashboard";
  }

  const pathOnly = trimmed.split("?")[0]?.split("#")[0] ?? "";
  if (
    pathOnly === "/" ||
    pathOnly === "/login" ||
    pathOnly.startsWith("/login/") ||
    pathOnly === "/api" ||
    pathOnly.startsWith("/api/")
  ) {
    return "/dashboard";
  }
  return trimmed;
}

export function resolveSessionSecret(explicitSecret?: string): string {
  const configured = explicitSecret ?? process.env.ADMIN_SESSION_SECRET;
  if (configured !== undefined && configured.length >= 32) {
    return configured;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ADMIN_SESSION_SECRET (min 32 characters) is required in production",
    );
  }
  return DEV_FALLBACK_SECRET;
}

export function resolveGatewayBaseUrl(): string {
  const raw =
    process.env.ADMIN_GATEWAY_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:4000";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

export function shouldUseSecureCookie(requestUrl?: string): boolean {
  if (process.env.NODE_ENV === "production") {
    return true;
  }
  return typeof requestUrl === "string" && requestUrl.startsWith("https://");
}

export interface CookieOptionsShape {
  httpOnly: true;
  secure: boolean;
  sameSite: "strict";
  path: "/";
  maxAge: number;
}

export function sessionCookieAttributes(
  secure: boolean,
  maxAgeSeconds = SESSION_COOKIE_MAX_AGE_SECONDS,
): CookieOptionsShape {
  return {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export function clearSessionCookieAttributes(
  secure: boolean,
): CookieOptionsShape {
  return sessionCookieAttributes(secure, 0);
}

export function deviceCookieAttributes(secure: boolean): CookieOptionsShape {
  return sessionCookieAttributes(secure, DEVICE_COOKIE_MAX_AGE_SECONDS);
}

export function generateAdminDeviceId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `adm_web_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `adm_web_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(encoded: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    return null;
  }
  const padLen = (4 - (encoded.length % 4)) % 4;
  const padded =
    encoded.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLen);
  try {
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const keyBytes = new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return key;
}

function isValidSessionShape(raw: unknown): raw is AdminSessionData {
  if (raw === null || typeof raw !== "object") {
    return false;
  }
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj.accessToken !== "string" ||
    obj.accessToken.length === 0 ||
    typeof obj.refreshToken !== "string" ||
    obj.refreshToken.length === 0 ||
    typeof obj.deviceId !== "string" ||
    obj.deviceId.length < 8 ||
    (obj.mode !== "full" && obj.mode !== "limited") ||
    typeof obj.expiresAt !== "number" ||
    !Number.isFinite(obj.expiresAt)
  ) {
    return false;
  }
  if (obj.user === null || typeof obj.user !== "object") {
    return false;
  }
  const user = obj.user as Record<string, unknown>;
  return (
    typeof user.id === "string" &&
    user.id.length > 0 &&
    typeof user.role === "string" &&
    isAdminConsoleRole(user.role)
  );
}

/**
 * Signs `session` into `<payloadB64Url>.<hmacSha256B64Url>` for storage in the
 * `HttpOnly` cookie.
 */
export async function sealSessionCookie(
  session: AdminSessionData,
  explicitSecret?: string,
): Promise<string> {
  const secret = resolveSessionSecret(explicitSecret);
  const payloadBytes = new TextEncoder().encode(JSON.stringify(session));
  const payloadPart = bytesToBase64Url(payloadBytes);
  const key = await importHmacKey(secret);
  const sigBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadPart),
  );
  const sigPart = bytesToBase64Url(new Uint8Array(sigBuffer));
  return `${payloadPart}.${sigPart}`;
}

/**
 * Verifies the HMAC-SHA256 seal and validates the session payload + admin role.
 * Returns `null` on missing, malformed, tampered, or non-admin cookies.
 */
export async function unsealSessionCookie(
  cookieValue: string | null | undefined,
  explicitSecret?: string,
): Promise<AdminSessionData | null> {
  if (typeof cookieValue !== "string" || cookieValue.length === 0) {
    return null;
  }
  const dotIndex = cookieValue.indexOf(".");
  if (dotIndex <= 0 || dotIndex !== cookieValue.lastIndexOf(".")) {
    return null;
  }
  const payloadPart = cookieValue.slice(0, dotIndex);
  const sigPart = cookieValue.slice(dotIndex + 1);
  const presentedSig = base64UrlToBytes(sigPart);
  if (presentedSig === null) {
    return null;
  }

  let secret: string;
  try {
    secret = resolveSessionSecret(explicitSecret);
  } catch {
    return null;
  }

  const key = await importHmacKey(secret);
  const expectedSigBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadPart),
  );
  if (!constantTimeEqual(presentedSig, new Uint8Array(expectedSigBuffer))) {
    return null;
  }

  const payloadBytes = base64UrlToBytes(payloadPart);
  if (payloadBytes === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(payloadBytes),
    ) as unknown;
    return isValidSessionShape(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function sessionNeedsRefresh(
  session: AdminSessionData,
  nowMs: number = Date.now(),
): boolean {
  return nowMs >= session.expiresAt - REFRESH_BUFFER_MS;
}

export type FetchLike = typeof fetch;

interface RefreshEnvelope {
  user?: {
    id?: string;
    phone?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    role?: string;
    homeCityId?: string | null;
  };
  tokens?: {
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
    mode?: "full" | "limited";
  };
}

function unwrapEnvelope<T>(raw: unknown): T {
  if (raw !== null && typeof raw === "object") {
    const obj = raw as { success?: unknown; data?: unknown };
    if (obj.success === true && obj.data !== undefined) {
      return obj.data as T;
    }
  }
  return raw as T;
}

export async function revokeUpstreamSession(
  tokens: { accessToken?: string; refreshToken?: string },
  options?: { gatewayUrl?: string; fetchImpl?: FetchLike },
): Promise<void> {
  const gatewayUrl = options?.gatewayUrl ?? resolveGatewayBaseUrl();
  const fetchImpl = options?.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (tokens.accessToken) {
    headers.Authorization = `Bearer ${tokens.accessToken}`;
  }
  try {
    await fetchImpl(`${gatewayUrl}/v1/auth/logout`, {
      method: "POST",
      headers,
      body: JSON.stringify(
        tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {},
      ),
    });
  } catch {
    // Best-effort upstream revocation; local cookie is always cleared regardless.
  }
}

/**
 * Rotates the session via `POST /v1/auth/refresh`. Re-checks the returned role
 * so a revoked operator privilege takes effect immediately on rotation.
 */
export async function refreshAdminSession(
  current: AdminSessionData,
  options?: {
    gatewayUrl?: string;
    fetchImpl?: FetchLike;
    nowMs?: number;
  },
): Promise<AdminSessionData | null> {
  const gatewayUrl = options?.gatewayUrl ?? resolveGatewayBaseUrl();
  const fetchImpl = options?.fetchImpl ?? fetch;
  const nowMs = options?.nowMs ?? Date.now();

  let res: Response;
  try {
    res = await fetchImpl(`${gatewayUrl}/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refreshToken: current.refreshToken,
        deviceId: current.deviceId,
      }),
    });
  } catch {
    return null;
  }

  if (!res.ok) {
    return null;
  }

  let rawBody: unknown;
  try {
    rawBody = await res.json();
  } catch {
    return null;
  }

  const data = unwrapEnvelope<RefreshEnvelope>(rawBody);
  const nextRole = data.user?.role ?? current.user.role;
  const nextAccess = data.tokens?.accessToken;
  const nextRefresh = data.tokens?.refreshToken;
  const expiresInSec = data.tokens?.expiresIn ?? 900;
  const nextMode = data.tokens?.mode ?? current.mode;

  if (!nextAccess || !nextRefresh) {
    return null;
  }

  if (!isAdminConsoleRole(nextRole)) {
    await revokeUpstreamSession(
      { accessToken: nextAccess, refreshToken: nextRefresh },
      { gatewayUrl, fetchImpl },
    );
    return null;
  }

  return {
    user: {
      id: data.user?.id ?? current.user.id,
      phone: data.user?.phone ?? current.user.phone,
      email: data.user?.email ?? current.user.email,
      firstName: data.user?.firstName ?? current.user.firstName,
      lastName: data.user?.lastName ?? current.user.lastName,
      role: nextRole.toLowerCase(),
      homeCityId:
        data.user?.homeCityId === undefined
          ? current.user.homeCityId
          : data.user.homeCityId,
    },
    accessToken: nextAccess,
    refreshToken: nextRefresh,
    deviceId: current.deviceId,
    mode: nextMode,
    expiresAt: nowMs + expiresInSec * 1000,
    stepUp: nextMode === "full" ? null : current.stepUp,
  };
}

export async function ensureFreshAdminSession(
  current: AdminSessionData,
  options?: {
    gatewayUrl?: string;
    fetchImpl?: FetchLike;
    nowMs?: number;
  },
): Promise<{ session: AdminSessionData; refreshed: boolean } | null> {
  const nowMs = options?.nowMs ?? Date.now();
  if (!sessionNeedsRefresh(current, nowMs)) {
    return { session: current, refreshed: false };
  }
  const rotated = await refreshAdminSession(current, options);
  if (rotated === null) {
    // If the existing access token has not actually expired yet, allow using it
    // until hard expiry rather than dropping a live session on a transient hiccup.
    if (nowMs < current.expiresAt) {
      return { session: current, refreshed: false };
    }
    return null;
  }
  return { session: rotated, refreshed: true };
}
