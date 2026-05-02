import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Lightweight cookie-presence check. Runs on every request matching /admin/*.
 * The cryptographic verification of the session cookie happens inside each
 * admin server component via getAuthenticatedUser() — middleware just gates
 * the route quickly without a network call.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Login page is always public
  if (pathname === "/admin/login") {
    return NextResponse.next();
  }

  // All other /admin/* routes require a session cookie
  const session = request.cookies.get("__session")?.value;
  if (!session) {
    const loginUrl = new URL("/admin/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
