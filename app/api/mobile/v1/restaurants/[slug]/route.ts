import { getAdminDb } from "@/lib/firebase-admin";
import { withPublic, coordsFrom, notFound } from "@/lib/marketplace/mobile-api";
import { getMarketplaceRestaurant } from "@/lib/marketplace/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  return withPublic(async () => {
    const { slug } = await ctx.params;
    const url = new URL(req.url);

    const detail = await getMarketplaceRestaurant(getAdminDb(), {
      slug, at: coordsFrom(url), nowMs: Date.now(),
    });

    // A restaurant that has not opted in returns 404, identical to one that
    // does not exist — being listed is not something the API confirms or
    // denies for a restaurant that is not in the marketplace.
    if (!detail) return notFound("We couldn't find that restaurant.");
    return detail;
  })(req);
}
