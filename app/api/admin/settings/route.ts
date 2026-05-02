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

  const {
    name,
    description,
    logo,
    coverImage,
    phone,
    address,
    notificationPhone,
    deliveryFee,
    minimumOrder,
    openingHours,
    whatsappPhone,
    whatsappEnabled,
    alertPreference,
  } = body as {
    name?: string;
    description?: string;
    logo?: string;
    coverImage?: string;
    phone?: string;
    address?: string;
    notificationPhone?: string;
    deliveryFee?: number;
    minimumOrder?: number;
    openingHours?: Record<string, { open: boolean; from: string; to: string }>;
    whatsappPhone?: string;
    whatsappEnabled?: boolean;
    alertPreference?: "whatsapp" | "sms" | "both";
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
      notificationPhone: (notificationPhone ?? "").trim(),
      deliveryFee: typeof deliveryFee === "number" && deliveryFee >= 0 ? deliveryFee : 0,
      minimumOrder: typeof minimumOrder === "number" && minimumOrder >= 0 ? minimumOrder : 0,
      ...(openingHours && typeof openingHours === "object" ? { openingHours } : {}),
      whatsappPhone: (whatsappPhone ?? "").trim(),
      whatsappEnabled: whatsappEnabled === true,
      alertPreference: ["whatsapp", "sms", "both"].includes(alertPreference ?? "")
        ? alertPreference
        : "sms",
    });

  return NextResponse.json({ success: true });
}
