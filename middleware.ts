import { NextRequest, NextResponse } from "next/server";

// Required env vars (set in Vercel dashboard / .env.local):
// VERCEL_API_TOKEN  — Vercel personal or team access token
// VERCEL_PROJECT_ID — Vercel project ID (Vercel dashboard → project → Settings → General)

const MAIN_DOMAIN = "restoflow-nine.vercel.app";

export function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  // Strip www. prefix for comparison
  const domain = host.replace(/^www\./, "");

  // Skip: localhost or any port-suffixed local host
  if (domain.startsWith("localhost") || domain.includes("localhost:")) {
    return NextResponse.next();
  }

  // Skip: the main app domain
  if (domain === MAIN_DOMAIN) {
    return NextResponse.next();
  }

  // Must look like a real hostname (contains at least one dot)
  if (!domain.includes(".")) {
    return NextResponse.next();
  }

  // Rewrite to /r-domain, preserving the path
  const url = request.nextUrl.clone();
  const originalPath = url.pathname;
  url.pathname = "/r-domain";
  url.searchParams.set("domain", domain);
  url.searchParams.set("path", originalPath);

  return NextResponse.rewrite(url);
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static  (static files)
     * - _next/image   (image optimisation)
     * - favicon.ico
     * - /api/*        (API routes)
     * - /admin/*      (admin pages)
     * - /super-admin/* (super-admin pages)
     * - /r/*          (existing public restaurant pages)
     * - /auth/*       (auth pages)
     * - public file extensions
     */
    "/((?!_next/static|_next/image|favicon\\.ico|api/|admin/|super-admin/|r/|auth/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)",
  ],
};
