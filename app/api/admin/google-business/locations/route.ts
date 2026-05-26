import { type NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  getValidAccessToken,
  listGbpAccounts,
  listGbpLocations,
  createGbpLocation,
  updateGbpLocation,
} from "@/lib/google-oauth";
import { FieldValue } from "firebase-admin/firestore";

// GET: list accounts and locations for the connected Google account
export async function GET() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const accessToken = await getValidAccessToken(user.restaurantSlug);
    const accounts = await listGbpAccounts(accessToken);
    const result: { accountName: string; displayName: string; locations: unknown[] }[] = [];

    for (const account of accounts) {
      try {
        const locations = await listGbpLocations(accessToken, account.name);
        result.push({ accountName: account.name, displayName: account.accountName, locations });
      } catch {
        result.push({ accountName: account.name, displayName: account.accountName, locations: [] });
      }
    }

    return NextResponse.json({ accounts: result });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("RECONNECT_REQUIRED")) {
      return NextResponse.json(
        { error: "Reconnect required", reconnect: true },
        { status: 401 }
      );
    }
    console.error("[google-business] locations fetch failed");
    return NextResponse.json({ error: "Failed to fetch locations" }, { status: 500 });
  }
}

// POST: save draft OR submit to GBP
export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role === "staff") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null) as {
    action: "save_draft" | "submit";
    details: {
      name: string;
      category: string;
      address: string;
      phone: string;
      website: string;
      description: string;
      accountName?: string;
      locationId?: string;
    };
  } | null;

  if (!body || !body.action || !body.details) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const db = getAdminDb();
  const { action, details } = body;

  if (action === "save_draft") {
    await db.collection("restaurants").doc(user.restaurantSlug).update({
      "googleBusiness.draft": details,
      "googleBusiness.profileStatus": "draft",
    });
    return NextResponse.json({ success: true });
  }

  if (action === "submit") {
    try {
      const accessToken = await getValidAccessToken(user.restaurantSlug);

      const locationPayload: Record<string, unknown> = {
        title: details.name,
        ...(details.description && {
          profile: { description: details.description.slice(0, 750) },
        }),
        ...(details.phone && {
          phoneNumbers: { primaryPhone: details.phone },
        }),
        ...(details.website && { websiteUri: details.website }),
        ...(details.address && {
          storefrontAddress: {
            addressLines: [details.address],
            regionCode: "NG",
          },
        }),
        ...(details.category && {
          categories: {
            primaryCategory: { name: details.category },
          },
        }),
      };

      const accountName = details.accountName;
      if (!accountName) {
        return NextResponse.json({ error: "Google account name is required" }, { status: 400 });
      }

      let location;
      const existingLocationId = details.locationId;

      if (existingLocationId) {
        location = await updateGbpLocation(accessToken, existingLocationId, locationPayload);
      } else {
        location = await createGbpLocation(accessToken, accountName, locationPayload);
      }

      await db.collection("restaurants").doc(user.restaurantSlug).update({
        "googleBusiness.googleLocationId": location.name,
        "googleBusiness.profileStatus": "synced",
        "googleBusiness.lastSyncedAt": FieldValue.serverTimestamp(),
        "googleBusiness.lastSyncError": FieldValue.delete(),
      });

      return NextResponse.json({ success: true, locationName: location.name });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("RECONNECT_REQUIRED")) {
        return NextResponse.json(
          { error: "Reconnect required", reconnect: true },
          { status: 401 }
        );
      }
      const safeMsg = err instanceof Error ? err.message : "Submission failed";

      await db.collection("restaurants").doc(user.restaurantSlug).update({
        "googleBusiness.profileStatus": "sync_failed",
        "googleBusiness.lastSyncError": safeMsg,
      });

      return NextResponse.json({ error: safeMsg }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
