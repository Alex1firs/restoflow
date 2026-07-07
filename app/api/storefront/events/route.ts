import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { validateIngestPayload } from "@/lib/analytics/events";
import { analyticsEnabled, recordClientEvents } from "@/lib/analytics/rollup";

// Public storefront funnel-analytics ingestion. Called fire-and-forget from the
// browser (navigator.sendBeacon). It ALWAYS returns 204 quickly and never
// surfaces an error to the client — so a failure here can never block or retry
// against the customer journey. Fully inert unless STOREFRONT_ANALYTICS_ENABLED.
//
// The client IP is used only transiently as a rate-limit key; it is never stored.

const NO_CONTENT = () => new NextResponse(null, { status: 204 });

export async function POST(req: NextRequest) {
  // Disabled → succeed silently so the client neither errors nor retries.
  if (!analyticsEnabled()) return NO_CONTENT();

  const { allowed } = await checkRateLimit(`sf_events:${getClientIp(req)}`, 120, 60_000);
  if (!allowed) return NO_CONTENT();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NO_CONTENT();
  }

  const result = validateIngestPayload(body);
  if (!result.ok) return NO_CONTENT();

  // Awaited so the write completes before the serverless function freezes, but
  // recordClientEvents swallows all errors internally — never throws.
  await recordClientEvents(result.data.slug, result.data.events);
  return NO_CONTENT();
}
