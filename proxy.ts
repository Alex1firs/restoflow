import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// All hostnames that belong to Restaflow itself (not restaurant custom domains)
const MAIN_HOSTS = [
  "restoflow.org",
  "www.restoflow.org",
  "restoflow-nine.vercel.app",
  "restaflow.com",
  "www.restaflow.com",
  "localhost",
];

const BASE_DOMAINS = [
  "restoflow.org",
  "restaflow.com",
  "localhost",
  "restoflow-nine.vercel.app",
];

function isMainHost(host: string): boolean {
  const bare = host.replace(/^www\./, "").split(":")[0];
  // Match exact names and any *.vercel.app preview/deployment URLs
  return (
    MAIN_HOSTS.includes(bare) ||
    MAIN_HOSTS.includes(host) ||
    bare.endsWith(".vercel.app")
  );
}

export function getRestoFlowSubdomain(host: string): string | null {
  const bare = host.replace(/^www\./, "").split(":")[0].toLowerCase();
  for (const base of BASE_DOMAINS) {
    if (bare === base) return null;
    if (bare.endsWith("." + base)) {
      const subdomain = bare.slice(0, -(base.length + 1));
      if (subdomain && subdomain !== "www") {
        return subdomain;
      }
    }
  }
  return null;
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = request.headers.get("host") ?? "";

  // ── RestoFlow subdomain rewrite ─────────────────────────────────────────
  // Handle requests on restaurant subdomains (e.g. grills-capitol.restoflow.org)
  const subdomain = getRestoFlowSubdomain(host);
  if (subdomain) {
    // 1. If trying to access system/platform pages on a subdomain, redirect to the main domain
    const systemPaths = [
      "/pricing",
      "/terms",
      "/privacy-policy",
      "/refund-policy",
      "/get-started",
    ];
    if (pathname.startsWith("/admin") || pathname.startsWith("/super-admin") || systemPaths.includes(pathname)) {
      const mainUrl = new URL(pathname, "https://restoflow.org");
      request.nextUrl.searchParams.forEach((value, key) => {
        mainUrl.searchParams.set(key, value);
      });
      return NextResponse.redirect(mainUrl);
    }

    // 2. Otherwise, transparently rewrite to the storefront slug path (preserving full subpath)
    const url = request.nextUrl.clone();
    url.pathname = `/r/${subdomain}${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url);
  }

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
    // Run on all routes except Next.js internals, static assets, and api routes
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest\\.json|sw\\.js|offline\\.html|api/).*)",
  ],
};

