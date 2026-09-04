import { getAdminDb } from "@/lib/firebase-admin";
import { withCustomer } from "@/lib/marketplace/mobile-api";
import { isFavourited, removeFavourite } from "@/lib/marketplace/favourites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Is this restaurant currently favourited by the caller? */
export function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  return withCustomer(async ({ customer }) => {
    const { slug } = await ctx.params;
    return { favourited: await isFavourited(getAdminDb(), customer.id, slug) };
  })(req);
}

/** Explicit remove. Deleting a favourite that is not there is a no-op, not an error. */
export function DELETE(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  return withCustomer(async ({ customer }) => {
    const { slug } = await ctx.params;
    await removeFavourite(getAdminDb(), customer.id, slug);
    return { favourited: false };
  })(req);
}
