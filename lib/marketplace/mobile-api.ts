import "server-only";
import { NextResponse } from "next/server";
import { readFlags } from "./config";
import { authenticateCustomer, type Customer } from "./customer";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

/**
 * Shared plumbing for every `/api/mobile/v1` route.
 *
 * One place that decides what a customer route looks like, so no individual
 * handler can forget the flag check, the rate limit, or — the important one —
 * that identity comes from the token.
 */

export const MOBILE_API_VERSION = "1";

export type Handler<T> = (ctx: { customer: Customer; req: Request }) => Promise<T | NextResponse>;

/**
 * Wrap an authenticated customer route.
 *
 * Every denial is deliberately terse. A customer cannot act on "token
 * signature invalid", and a caller probing the endpoint should learn nothing
 * from the difference between failures.
 */
export function withCustomer<T>(handler: Handler<T>, opts: { rateLimit?: number } = {}) {
  return async (req: Request): Promise<NextResponse> => {
    if (!readFlags().enabled) {
      // With the marketplace off the API does not exist, rather than existing
      // and refusing — a 404 leaks less than a 503.
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const auth = await authenticateCustomer(req);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    // Per-customer AND per-IP. A token is cheap to obtain; an IP is cheap to
    // rotate; neither alone is a limit.
    const perCustomer = await checkRateLimit(`mobile:${auth.customer.id}`, opts.rateLimit ?? 120, 60_000);
    if (!perCustomer.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    const perIp = await checkRateLimit(`mobile_ip:${getClientIp(req as never)}`, 400, 60_000);
    if (!perIp.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    try {
      const result = await handler({ customer: auth.customer, req });
      if (result instanceof NextResponse) return result;
      return NextResponse.json(result, { status: 200 });
    } catch (err) {
      console.error(JSON.stringify({
        scope: "mobile_api", event: "handler_failed",
        customerId: auth.customer.id, path: new URL(req.url).pathname,
        error: err instanceof Error ? err.message : String(err),
      }));
      return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }
  };
}

/** Public routes still respect the flag and the IP limit, but need no token. */
export function withPublic<T>(handler: (ctx: { req: Request }) => Promise<T | NextResponse>) {
  return async (req: Request): Promise<NextResponse> => {
    if (!readFlags().enabled) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const perIp = await checkRateLimit(`mobile_pub:${getClientIp(req as never)}`, 240, 60_000);
    if (!perIp.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    try {
      const result = await handler({ req });
      if (result instanceof NextResponse) return result;
      return NextResponse.json(result, { status: 200 });
    } catch (err) {
      console.error(JSON.stringify({
        scope: "mobile_api", event: "public_handler_failed",
        path: new URL(req.url).pathname,
        error: err instanceof Error ? err.message : String(err),
      }));
      return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }
  };
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Used for "not yours" as well as "not there" — the two must be indistinguishable. */
export function notFound(message = "We couldn't find that.") {
  return NextResponse.json({ error: message }, { status: 404 });
}

/** A definite, meaningful "no" the customer can act on. Never retried by the client. */
export function unprocessable(message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status: 422 });
}

export function coordsFrom(url: URL): { lat: number; lng: number } | null {
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}
