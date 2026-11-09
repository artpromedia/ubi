import { NextResponse, type NextRequest } from "next/server";

import {
  ADMIN_SESSION_COOKIE,
  clearSessionCookieAttributes,
  ensureFreshAdminSession,
  sanitizeNextPath,
  sealSessionCookie,
  sessionCookieAttributes,
  shouldUseSecureCookie,
  unsealSessionCookie,
  type FetchLike,
} from "@/lib/session";

export interface MiddlewareDeps {
  gatewayUrl?: string;
  fetchImpl?: FetchLike;
  nowMs?: () => number;
  sessionSecret?: string;
}

function isStaticOrInternalPath(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt"
  );
}

function buildLoginRedirect(
  req: NextRequest,
  clearCookie: boolean,
): NextResponse {
  const loginUrl = req.nextUrl.clone();
  const targetPath = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  if (
    req.nextUrl.pathname !== "/" &&
    req.nextUrl.pathname !== "/login" &&
    !req.nextUrl.pathname.startsWith("/login/")
  ) {
    loginUrl.searchParams.set("next", targetPath);
  }

  const response = NextResponse.redirect(loginUrl, 307);
  if (clearCookie) {
    response.cookies.set(
      ADMIN_SESSION_COOKIE,
      "",
      clearSessionCookieAttributes(shouldUseSecureCookie(req.url)),
    );
  }
  return response;
}

export async function evaluateAdminMiddleware(
  req: NextRequest,
  deps?: MiddlewareDeps,
): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  if (isStaticOrInternalPath(pathname)) {
    return NextResponse.next();
  }

  const isLoginRoute = pathname === "/login" || pathname.startsWith("/login/");
  const rawCookie = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const unsealed = await unsealSessionCookie(rawCookie, deps?.sessionSecret);

  if (unsealed === null) {
    if (isLoginRoute) {
      const response = NextResponse.next();
      if (rawCookie) {
        response.cookies.set(
          ADMIN_SESSION_COOKIE,
          "",
          clearSessionCookieAttributes(shouldUseSecureCookie(req.url)),
        );
      }
      return response;
    }
    return buildLoginRedirect(req, Boolean(rawCookie));
  }

  const fresh = await ensureFreshAdminSession(unsealed, {
    gatewayUrl: deps?.gatewayUrl,
    fetchImpl: deps?.fetchImpl,
    nowMs: deps?.nowMs?.(),
  });

  if (fresh === null) {
    if (isLoginRoute) {
      const response = NextResponse.next();
      response.cookies.set(
        ADMIN_SESSION_COOKIE,
        "",
        clearSessionCookieAttributes(shouldUseSecureCookie(req.url)),
      );
      return response;
    }
    return buildLoginRedirect(req, true);
  }

  // Full-mode operators visiting /login (or /) are sent to their validated destination.
  // Limited-mode operators may stay on /login to finish device step-up or visit an
  // (admin) route where LimitedModeGate renders the verification screen with no actions.
  if ((isLoginRoute && fresh.session.mode === "full") || pathname === "/") {
    const dest = sanitizeNextPath(req.nextUrl.searchParams.get("next"));
    const redirectUrl = req.nextUrl.clone();
    const [destPath, destQuery] = dest.split("?");
    redirectUrl.pathname = destPath ?? "/dashboard";
    redirectUrl.search = destQuery ? `?${destQuery}` : "";
    const response = NextResponse.redirect(redirectUrl, 307);
    if (fresh.refreshed) {
      const sealed = await sealSessionCookie(
        fresh.session,
        deps?.sessionSecret,
      );
      response.cookies.set(
        ADMIN_SESSION_COOKIE,
        sealed,
        sessionCookieAttributes(shouldUseSecureCookie(req.url)),
      );
    }
    return response;
  }

  const response = NextResponse.next();
  if (fresh.refreshed) {
    const sealed = await sealSessionCookie(fresh.session, deps?.sessionSecret);
    response.cookies.set(
      ADMIN_SESSION_COOKIE,
      sealed,
      sessionCookieAttributes(shouldUseSecureCookie(req.url)),
    );
  }
  return response;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const response = await evaluateAdminMiddleware(req);
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
