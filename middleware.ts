import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// All hostnames that belong to Restaflow itself (not restaurant custom domains)
const MAIN_HOSTS = [
  "restoflow-nine.vercel.app",
  "restaflow.com",
  "www.restaflow.com",
  "localhost",
];

function isMainHost(host: string): boolean {
  const bare = host.replace(/^www\./, "").split(":")[0];
  // Match exact names and any *.vercel.app preview URLs (deployment preview URLs)
  return (
    MAIN_HOSTS.includes(bare) ||
    MAIN_HOSTS.includes(host) ||
    bare.endsWith(".vercel.app")
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = request.headers.get("host") ?? "";

  // ── Custom restaurant domain rewrite ────────────────────────────────────
  // Restaurant owners can point their own domain (e.g. grills.com) at this app.
  // Rewrite those requests to /r-domain so the storefront renders correctly.
  if (!isMainHost(host) && host.includes(".")) {
    const bare = host.replace(/^www\./, "").split(":")[0];
    const url = request.nextUrl.clone();
    url.pathname = "/r-domain";
    url.searchParams.set("domain", bare);
    return NextResponse.rewrite(url);
  }

  // ── Admin session gate ───────────────────────────────────────────────────
  // Only protect /admin/* — public pages (/, /pricing, /r/*, etc.) are open.
  if (!pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  // The login page itself is always accessible
  if (pathname === "/admin/login") {
    return NextResponse.next();
  }

  const session = request.cookies.get("__session")?.value;
  if (!session) {
    const loginUrl = new URL("/admin/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on all routes except Next.js internals, static files, and api routes
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest\\.json|sw\\.js|offline\\.html|api/).*)",
  ],
};
