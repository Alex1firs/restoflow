import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const MAIN_DOMAINS = [
  "restoflow-nine.vercel.app",
  "localhost",
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = request.headers.get("host") ?? "";
  const bareHost = host.replace(/^www\./, "").split(":")[0];

  // Custom domain handling — runs before admin session check
  const isMainDomain = MAIN_DOMAINS.some((d) => bareHost === d || bareHost.endsWith(`.${d}`));
  const looksLikeCustomDomain = bareHost.includes(".") && !isMainDomain;

  if (looksLikeCustomDomain) {
    const url = request.nextUrl.clone();
    url.pathname = "/r-domain";
    url.searchParams.set("domain", bareHost);
    return NextResponse.rewrite(url);
  }

  // Admin session gate
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
    "/admin/:path*",
    "/((?!_next/static|_next/image|favicon.ico|api/).*)",
  ],
};
