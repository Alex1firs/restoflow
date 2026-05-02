import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";

export async function PUT(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { name, description, logo, coverImage, phone, address } = body as {
    name?: string;
    description?: string;
    logo?: string;
    coverImage?: string;
    phone?: string;
    address?: string;
  };

  if (!name?.trim()) {
    return NextResponse.json({ error: "Restaurant name is required" }, { status: 400 });
  }

  await getAdminDb()
    .collection("restaurants")
    .doc(user.restaurantSlug)
    .update({
      name: name.trim(),
      description: (description ?? "").trim(),
      logo: (logo ?? "").trim(),
      coverImage: (coverImage ?? "").trim(),
      phone: (phone ?? "").trim(),
      address: (address ?? "").trim(),
    });

  return NextResponse.json({ success: true });
}
