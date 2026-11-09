import { NextResponse, type NextRequest } from "next/server";

import {
  ADMIN_DEVICE_COOKIE,
  ADMIN_SESSION_COOKIE,
  clearSessionCookieAttributes,
  deviceCookieAttributes,
  ensureFreshAdminSession,
  formatAdminRole,
  generateAdminDeviceId,
  isAdminConsoleRole,
  refreshAdminSession,
  resolveGatewayBaseUrl,
  revokeUpstreamSession,
  sealSessionCookie,
  sessionCookieAttributes,
  shouldUseSecureCookie,
  toPublicSession,
  unsealSessionCookie,
  type AdminSessionData,
  type AdminStepUpState,
  type FetchLike,
} from "./session";

export interface SessionHandlerDeps {
  gatewayUrl?: string;
  fetchImpl?: FetchLike;
  nowMs?: () => number;
  sessionSecret?: string;
}

interface UpstreamErrorBody {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  error?: {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
}

function unwrapData<T>(raw: unknown): T {
  if (raw !== null && typeof raw === "object") {
    const obj = raw as { success?: unknown; data?: unknown };
    if (obj.success === true && obj.data !== undefined) {
      return obj.data as T;
    }
  }
  return raw as T;
}

function forwardedHeaders(req: NextRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    headers["x-forwarded-for"] = xff;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    headers["x-real-ip"] = realIp;
  }
  const ua = req.headers.get("user-agent");
  if (ua) {
    headers["user-agent"] = ua;
  }
  return headers;
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    },
    { status },
  );
}

async function relayUpstreamFailure(res: Response): Promise<NextResponse> {
  let code = "upstream_error";
  let message = res.statusText || "Request failed";
  let details: Record<string, unknown> | undefined;

  try {
    const raw = (await res.json()) as UpstreamErrorBody;
    const errObj =
      raw.error !== null && typeof raw.error === "object" ? raw.error : raw;
    if (typeof errObj.code === "string") {
      code = errObj.code;
    }
    if (typeof errObj.message === "string") {
      message = errObj.message;
    }
    if (errObj.details !== null && typeof errObj.details === "object") {
      details = errObj.details as Record<string, unknown>;
    }
  } catch {
    // Non-JSON upstream error
  }

  return errorResponse(res.status, code, message, details);
}

function clearSessionOn(res: NextResponse, reqUrl: string): NextResponse {
  const secure = shouldUseSecureCookie(reqUrl);
  res.cookies.set(
    ADMIN_SESSION_COOKIE,
    "",
    clearSessionCookieAttributes(secure),
  );
  return res;
}

async function attachSessionOn(
  res: NextResponse,
  reqUrl: string,
  session: AdminSessionData,
  sessionSecret?: string,
): Promise<NextResponse> {
  const secure = shouldUseSecureCookie(reqUrl);
  const sealed = await sealSessionCookie(session, sessionSecret);
  res.cookies.set(
    ADMIN_SESSION_COOKIE,
    sealed,
    sessionCookieAttributes(secure),
  );
  return res;
}

const E164_RE = /^\+[1-9]\d{7,14}$/;
const OTP_CODE_RE = /^\d{6}$/;

export async function handleOtpPost(
  req: NextRequest,
  deps?: SessionHandlerDeps,
): Promise<NextResponse> {
  let body: { phone?: unknown };
  try {
    body = (await req.json()) as { phone?: unknown };
  } catch {
    return errorResponse(422, "validation_failed", "Request body must be JSON");
  }

  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (!E164_RE.test(phone)) {
    return errorResponse(
      422,
      "validation_failed",
      "Enter a valid phone number in international format (e.g. +2348012345678).",
    );
  }

  const gatewayUrl = deps?.gatewayUrl ?? resolveGatewayBaseUrl();
  const fetchImpl = deps?.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${gatewayUrl}/v1/auth/otp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...forwardedHeaders(req),
      },
      body: JSON.stringify({ phone, purpose: "login" }),
    });
  } catch {
    return errorResponse(
      503,
      "service_unavailable",
      "Cannot reach the UBI authentication gateway right now.",
    );
  }

  if (!res.ok) {
    return relayUpstreamFailure(res);
  }

  const data = unwrapData<{
    expiresInSeconds?: number;
    resendAfterSeconds?: number;
  }>(await res.json());

  return NextResponse.json({
    success: true,
    data: {
      expiresInSeconds: data.expiresInSeconds ?? 300,
      resendAfterSeconds: data.resendAfterSeconds ?? 60,
    },
  });
}

interface VerifyUpstreamPayload {
  user: {
    id: string;
    phone: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    homeCityId?: string | null;
  };
  stepUp?: {
    required?: boolean;
    challengeId?: string | null;
    methods?: string[];
    unavailable?: Record<string, string>;
  };
  tokens?: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    mode: "full" | "limited";
  };
  token?: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    mode: "full" | "limited";
  };
}

export async function handleVerifyPost(
  req: NextRequest,
  deps?: SessionHandlerDeps,
): Promise<NextResponse> {
  let body: { phone?: unknown; code?: unknown };
  try {
    body = (await req.json()) as { phone?: unknown; code?: unknown };
  } catch {
    return errorResponse(422, "validation_failed", "Request body must be JSON");
  }

  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";

  if (!E164_RE.test(phone)) {
    return errorResponse(
      422,
      "validation_failed",
      "Enter a valid phone number in international format.",
    );
  }
  if (!OTP_CODE_RE.test(code)) {
    return errorResponse(
      422,
      "validation_failed",
      "Enter the 6-digit verification code.",
    );
  }

  const existingDeviceCookie = req.cookies.get(ADMIN_DEVICE_COOKIE)?.value;
  const deviceId =
    existingDeviceCookie &&
    existingDeviceCookie.length >= 8 &&
    existingDeviceCookie.length <= 128
      ? existingDeviceCookie
      : generateAdminDeviceId();

  const gatewayUrl = deps?.gatewayUrl ?? resolveGatewayBaseUrl();
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const nowMs = deps?.nowMs?.() ?? Date.now();

  let res: Response;
  try {
    res = await fetchImpl(`${gatewayUrl}/v1/auth/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...forwardedHeaders(req),
      },
      body: JSON.stringify({
        phone,
        code,
        deviceId,
        platform: "web",
        model: "UBI Admin Console",
      }),
    });
  } catch {
    return errorResponse(
      503,
      "service_unavailable",
      "Cannot reach the UBI authentication gateway right now.",
    );
  }

  if (!res.ok) {
    return relayUpstreamFailure(res);
  }

  const verified = unwrapData<VerifyUpstreamPayload>(await res.json());
  const tokenBundle = verified.tokens ?? verified.token;
  if (!tokenBundle?.accessToken || !tokenBundle.refreshToken) {
    return errorResponse(
      502,
      "upstream_error",
      "Authentication service returned an incomplete session.",
    );
  }

  const rawRole = verified.user.role;
  if (!isAdminConsoleRole(rawRole)) {
    // Immediately revoke the upstream session so a non-admin login attempt
    // leaves neither a cookie nor an active server session behind.
    await revokeUpstreamSession(
      {
        accessToken: tokenBundle.accessToken,
        refreshToken: tokenBundle.refreshToken,
      },
      { gatewayUrl, fetchImpl },
    );
    const refused = errorResponse(
      403,
      "forbidden",
      `This account (${formatAdminRole(rawRole.toLowerCase())}) does not have operator access to the UBI Admin Console. Sign in with an authorised admin or operations account.`,
      { role: rawRole.toLowerCase() },
    );
    return clearSessionOn(refused, req.url);
  }

  const stepUp: AdminStepUpState | null =
    tokenBundle.mode === "limited" || verified.stepUp?.required === true
      ? {
          required: true,
          challengeId: verified.stepUp?.challengeId ?? null,
          methods: verified.stepUp?.methods ?? [
            "old_device_approve",
            "selfie_nin",
          ],
          ...(verified.stepUp?.unavailable === undefined
            ? {}
            : { unavailable: verified.stepUp.unavailable }),
        }
      : null;

  const session: AdminSessionData = {
    user: {
      id: verified.user.id,
      phone: verified.user.phone,
      email: verified.user.email,
      firstName: verified.user.firstName,
      lastName: verified.user.lastName,
      role: rawRole.toLowerCase(),
      homeCityId: verified.user.homeCityId ?? null,
    },
    accessToken: tokenBundle.accessToken,
    refreshToken: tokenBundle.refreshToken,
    deviceId,
    mode: tokenBundle.mode,
    expiresAt: nowMs + tokenBundle.expiresIn * 1000,
    stepUp,
  };

  const response = NextResponse.json({
    success: true,
    data: { session: toPublicSession(session) },
  });
  await attachSessionOn(response, req.url, session, deps?.sessionSecret);
  response.cookies.set(
    ADMIN_DEVICE_COOKIE,
    deviceId,
    deviceCookieAttributes(shouldUseSecureCookie(req.url)),
  );
  return response;
}

export async function handleSessionGet(
  req: NextRequest,
  deps?: SessionHandlerDeps,
): Promise<NextResponse> {
  const cookieVal = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const current = await unsealSessionCookie(cookieVal, deps?.sessionSecret);
  if (current === null) {
    const unauth = errorResponse(401, "unauthorized", "Not signed in");
    return cookieVal ? clearSessionOn(unauth, req.url) : unauth;
  }

  const fresh = await ensureFreshAdminSession(current, {
    gatewayUrl: deps?.gatewayUrl,
    fetchImpl: deps?.fetchImpl,
    nowMs: deps?.nowMs?.(),
  });
  if (fresh === null) {
    return clearSessionOn(
      errorResponse(401, "unauthorized", "Your operator session has expired."),
      req.url,
    );
  }

  const response = NextResponse.json({
    success: true,
    data: { session: toPublicSession(fresh.session) },
  });
  if (fresh.refreshed) {
    await attachSessionOn(
      response,
      req.url,
      fresh.session,
      deps?.sessionSecret,
    );
  }
  return response;
}

export async function handleRefreshPost(
  req: NextRequest,
  deps?: SessionHandlerDeps,
): Promise<NextResponse> {
  const cookieVal = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const current = await unsealSessionCookie(cookieVal, deps?.sessionSecret);
  if (current === null) {
    return clearSessionOn(
      errorResponse(401, "unauthorized", "Not signed in"),
      req.url,
    );
  }

  const rotated = await refreshAdminSession(current, {
    gatewayUrl: deps?.gatewayUrl,
    fetchImpl: deps?.fetchImpl,
    nowMs: deps?.nowMs?.(),
  });
  if (rotated === null) {
    return clearSessionOn(
      errorResponse(401, "unauthorized", "Your operator session has ended."),
      req.url,
    );
  }

  const response = NextResponse.json({
    success: true,
    data: { session: toPublicSession(rotated) },
  });
  await attachSessionOn(response, req.url, rotated, deps?.sessionSecret);
  return response;
}

export async function handleLogoutPost(
  req: NextRequest,
  deps?: SessionHandlerDeps,
): Promise<NextResponse> {
  const cookieVal = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const current = await unsealSessionCookie(cookieVal, deps?.sessionSecret);

  if (current !== null) {
    await revokeUpstreamSession(
      {
        accessToken: current.accessToken,
        refreshToken: current.refreshToken,
      },
      {
        gatewayUrl: deps?.gatewayUrl,
        fetchImpl: deps?.fetchImpl,
      },
    );
  }

  const response = NextResponse.json({
    success: true,
    data: { signedOut: true },
  });
  return clearSessionOn(response, req.url);
}

interface StepUpSelfieUpstream {
  status: "passed" | "failed";
  challengeId: string;
  score: number | null;
  reason: string | null;
  appealPath: string | null;
  appealMessage: string | null;
  token: {
    accessToken: string;
    expiresIn: number;
    mode: "full" | "limited";
  } | null;
}

export async function handleSelfieStepUpPost(
  req: NextRequest,
  deps?: SessionHandlerDeps,
): Promise<NextResponse> {
  const cookieVal = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const current = await unsealSessionCookie(cookieVal, deps?.sessionSecret);
  if (current === null) {
    return clearSessionOn(
      errorResponse(401, "unauthorized", "Not signed in"),
      req.url,
    );
  }

  let body: { challengeId?: unknown; nin?: unknown; imageBase64?: unknown };
  try {
    body = (await req.json()) as {
      challengeId?: unknown;
      nin?: unknown;
      imageBase64?: unknown;
    };
  } catch {
    return errorResponse(422, "validation_failed", "Request body must be JSON");
  }

  const challengeId =
    typeof body.challengeId === "string" && body.challengeId.trim().length > 0
      ? body.challengeId.trim()
      : (current.stepUp?.challengeId ?? "");
  const nin = typeof body.nin === "string" ? body.nin.trim() : "";
  const imageBase64 =
    typeof body.imageBase64 === "string" ? body.imageBase64.trim() : "";

  if (!challengeId) {
    return errorResponse(
      422,
      "validation_failed",
      "No active device verification challenge found. Sign out and sign in again.",
    );
  }
  if (!/^\d{11}$/.test(nin)) {
    return errorResponse(
      422,
      "validation_failed",
      "Enter a valid 11-digit National Identity Number (NIN).",
    );
  }
  if (imageBase64.length < 64) {
    return errorResponse(
      422,
      "validation_failed",
      "Capture or select a clear selfie image to verify this device.",
    );
  }

  const gatewayUrl = deps?.gatewayUrl ?? resolveGatewayBaseUrl();
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const nowMs = deps?.nowMs?.() ?? Date.now();

  const fresh = await ensureFreshAdminSession(current, {
    gatewayUrl,
    fetchImpl,
    nowMs,
  });
  if (fresh === null) {
    return clearSessionOn(
      errorResponse(401, "unauthorized", "Your operator session has expired."),
      req.url,
    );
  }

  let res: Response;
  try {
    res = await fetchImpl(`${gatewayUrl}/v1/auth/step-up/selfie`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${fresh.session.accessToken}`,
        ...forwardedHeaders(req),
      },
      body: JSON.stringify({ challengeId, nin, imageBase64 }),
    });
  } catch {
    return errorResponse(
      503,
      "service_unavailable",
      "Cannot reach the UBI verification service right now.",
    );
  }

  if (!res.ok) {
    return relayUpstreamFailure(res);
  }

  const outcome = unwrapData<StepUpSelfieUpstream>(await res.json());
  let nextSession = fresh.session;
  let shouldSeal = fresh.refreshed;

  if (outcome.status === "passed" && outcome.token !== null) {
    nextSession = {
      ...fresh.session,
      accessToken: outcome.token.accessToken,
      mode: outcome.token.mode,
      expiresAt: nowMs + outcome.token.expiresIn * 1000,
      stepUp: null,
    };
    shouldSeal = true;
  }

  const response = NextResponse.json({
    success: true,
    data: {
      status: outcome.status,
      score: outcome.score,
      reason: outcome.reason,
      appealMessage: outcome.appealMessage,
      session: toPublicSession(nextSession),
    },
  });
  if (shouldSeal) {
    await attachSessionOn(response, req.url, nextSession, deps?.sessionSecret);
  }
  return response;
}

export async function handleApproveStepUpPost(
  req: NextRequest,
  deps?: SessionHandlerDeps,
): Promise<NextResponse> {
  const cookieVal = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const current = await unsealSessionCookie(cookieVal, deps?.sessionSecret);
  if (current === null) {
    return clearSessionOn(
      errorResponse(401, "unauthorized", "Not signed in"),
      req.url,
    );
  }
  if (current.mode !== "full") {
    return errorResponse(
      403,
      "limited_mode",
      "Only an already-verified device can approve another device.",
    );
  }

  let body: { challengeId?: unknown };
  try {
    body = (await req.json()) as { challengeId?: unknown };
  } catch {
    return errorResponse(422, "validation_failed", "Request body must be JSON");
  }

  const challengeId =
    typeof body.challengeId === "string" ? body.challengeId.trim() : "";
  if (!challengeId) {
    return errorResponse(
      422,
      "validation_failed",
      "Challenge ID is required to approve a device.",
    );
  }

  const gatewayUrl = deps?.gatewayUrl ?? resolveGatewayBaseUrl();
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const fresh = await ensureFreshAdminSession(current, {
    gatewayUrl,
    fetchImpl,
    nowMs: deps?.nowMs?.(),
  });
  if (fresh === null) {
    return clearSessionOn(
      errorResponse(401, "unauthorized", "Your operator session has expired."),
      req.url,
    );
  }

  let res: Response;
  try {
    res = await fetchImpl(`${gatewayUrl}/v1/auth/step-up/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${fresh.session.accessToken}`,
        ...forwardedHeaders(req),
      },
      body: JSON.stringify({ challengeId }),
    });
  } catch {
    return errorResponse(
      503,
      "service_unavailable",
      "Cannot reach the UBI verification service right now.",
    );
  }

  if (!res.ok) {
    return relayUpstreamFailure(res);
  }

  const data = unwrapData<{ status: string; challengeId: string }>(
    await res.json(),
  );
  const response = NextResponse.json({ success: true, data });
  if (fresh.refreshed) {
    await attachSessionOn(
      response,
      req.url,
      fresh.session,
      deps?.sessionSecret,
    );
  }
  return response;
}

export async function handleGatewayProxy(
  req: NextRequest,
  pathSegments: readonly string[],
  deps?: SessionHandlerDeps,
): Promise<NextResponse> {
  if (
    pathSegments.length === 0 ||
    pathSegments[0] !== "v1" ||
    pathSegments.some((seg) => seg === ".." || seg === "." || seg.length === 0)
  ) {
    return errorResponse(404, "not_found", "Unknown gateway route");
  }

  const cookieVal = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const current = await unsealSessionCookie(cookieVal, deps?.sessionSecret);
  if (current === null) {
    return clearSessionOn(
      errorResponse(401, "unauthorized", "Not signed in"),
      req.url,
    );
  }

  const gatewayUrl = deps?.gatewayUrl ?? resolveGatewayBaseUrl();
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const fresh = await ensureFreshAdminSession(current, {
    gatewayUrl,
    fetchImpl,
    nowMs: deps?.nowMs?.(),
  });
  if (fresh === null) {
    return clearSessionOn(
      errorResponse(401, "unauthorized", "Your operator session has expired."),
      req.url,
    );
  }

  const rawPathname = req.nextUrl.pathname;
  const upstreamPath = rawPathname.startsWith("/api/gateway/v1")
    ? rawPathname.slice("/api/gateway".length)
    : `/${pathSegments.map((segment) => encodeURIComponent(segment)).join("/")}`;
  const search = req.nextUrl.search;
  const upstreamUrl = `${gatewayUrl}${upstreamPath}${search}`;

  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const rawBody = hasBody ? await req.text() : undefined;

  const buildUpstreamHeaders = (
    accessToken: string,
  ): Record<string, string> => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      ...forwardedHeaders(req),
    };
    const contentType = req.headers.get("content-type");
    if (contentType) {
      headers["content-type"] = contentType;
    }
    const accept = req.headers.get("accept");
    if (accept) {
      headers.accept = accept;
    }
    const idem = req.headers.get("idempotency-key");
    if (idem) {
      headers["idempotency-key"] = idem;
    }
    return headers;
  };

  let activeSession = fresh.session;
  let didRefresh = fresh.refreshed;

  let upstreamRes: Response;
  try {
    upstreamRes = await fetchImpl(upstreamUrl, {
      method,
      headers: buildUpstreamHeaders(activeSession.accessToken),
      ...(rawBody !== undefined && rawBody.length > 0 ? { body: rawBody } : {}),
    });
  } catch {
    return errorResponse(
      503,
      "service_unavailable",
      "Cannot reach the UBI API gateway right now.",
    );
  }

  // If the gateway rejected the access token with 401 and we have not rotated
  // yet, rotate once and retry when safe (idempotent read or keyed write).
  const safeToRetry =
    method === "GET" ||
    method === "HEAD" ||
    Boolean(req.headers.get("idempotency-key"));
  if (upstreamRes.status === 401 && !didRefresh && safeToRetry) {
    const rotated = await refreshAdminSession(activeSession, {
      gatewayUrl,
      fetchImpl,
      nowMs: deps?.nowMs?.(),
    });
    if (rotated === null) {
      return clearSessionOn(
        errorResponse(401, "unauthorized", "Your operator session has ended."),
        req.url,
      );
    }
    activeSession = rotated;
    didRefresh = true;
    upstreamRes = await fetchImpl(upstreamUrl, {
      method,
      headers: buildUpstreamHeaders(activeSession.accessToken),
      ...(rawBody !== undefined && rawBody.length > 0 ? { body: rawBody } : {}),
    });
  }

  const responseText = await upstreamRes.text();
  const outHeaders = new Headers();
  const upstreamContentType = upstreamRes.headers.get("content-type");
  if (upstreamContentType) {
    outHeaders.set("content-type", upstreamContentType);
  }

  const response = new NextResponse(
    upstreamRes.status === 204 ? null : responseText,
    {
      status: upstreamRes.status,
      headers: outHeaders,
    },
  );
  if (didRefresh) {
    await attachSessionOn(
      response,
      req.url,
      activeSession,
      deps?.sessionSecret,
    );
  }
  return response;
}
