import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import type { HeroSettings } from "@/lib/hero-settings";

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
    coverVideo,
    phone,
    address,
    telegramChatId,
    notificationPhone,
    deliveryFee,
    minimumOrder,
    deliveryEnabled,
    pickupEnabled,
    openingHours,
    telegramEnabled,
    alertPreference,
    primaryColor,
    accentColor,
    promoBanner,
    rating,
    ordersToday,
    deliveryTime,
    hidePrices,
    dineInEnabled,
    heroSettings,
    cancellationManagerPinEnabled,
    cancellationOwnerApprovalEnabled,
    deliveryZones,
    whatsappNumber,
    showContactSupport,
    payOnDeliveryEnabled,
    whatsappCheckoutEnabled,
    whatsappAdminPin,
  } = body as {
    name?: string;
    description?: string;
    logo?: string;
    coverImage?: string;
    coverVideo?: string;
    phone?: string;
    address?: string;
    telegramChatId?: string;
    notificationPhone?: string;
    deliveryFee?: number;
    minimumOrder?: number;
    deliveryEnabled?: boolean;
    pickupEnabled?: boolean;
    openingHours?: Record<string, { open: boolean; from: string; to: string }>;
    telegramEnabled?: boolean;
    alertPreference?: "telegram" | "sms" | "both";
    primaryColor?: string;
    accentColor?: string;
    promoBanner?: string;
    rating?: number | string;
    ordersToday?: number | string;
    deliveryTime?: string;
    hidePrices?: boolean;
    dineInEnabled?: boolean;
    heroSettings?: HeroSettings;
    cancellationManagerPinEnabled?: boolean;
    cancellationOwnerApprovalEnabled?: boolean;
    deliveryZones?: { id: string; name: string; fee: number }[];
    whatsappNumber?: string;
    showContactSupport?: boolean;
    payOnDeliveryEnabled?: boolean;
    whatsappCheckoutEnabled?: boolean;
    whatsappAdminPin?: string;
  };

  if (!name?.trim()) {
    return NextResponse.json({ error: "Restaurant name is required" }, { status: 400 });
  }

  if (whatsappCheckoutEnabled && (!whatsappAdminPin || !/^\d{4}$/.test(whatsappAdminPin))) {
    return NextResponse.json({ error: "A 4-digit PIN is required when WhatsApp Checkout is enabled." }, { status: 400 });
  }

  await getAdminDb()
    .collection("restaurants")
    .doc(user.restaurantSlug)
    .update({
      name: name.trim(),
      description: (description ?? "").trim(),
      logo: (logo ?? "").trim(),
      coverImage: (coverImage ?? "").trim(),
      coverVideo: (coverVideo ?? "").trim(),
      phone: (phone ?? "").trim(),
      address: (address ?? "").trim(),
      telegramChatId: (telegramChatId ?? "").trim(),
      notificationPhone: (notificationPhone ?? "").trim(),
      deliveryFee: typeof deliveryFee === "number" && deliveryFee >= 0 ? deliveryFee : 0,
      minimumOrder: typeof minimumOrder === "number" && minimumOrder >= 0 ? minimumOrder : 0,
      deliveryEnabled: deliveryEnabled !== false,
      pickupEnabled: pickupEnabled !== false,
      ...(openingHours && typeof openingHours === "object" ? { openingHours } : {}),
      telegramEnabled: telegramEnabled === true,
      alertPreference: ["telegram", "sms", "both"].includes(alertPreference ?? "")
        ? alertPreference
        : "sms",
      primaryColor: (primaryColor ?? "").trim(),
      accentColor: (accentColor ?? "").trim(),
      promoBanner: (promoBanner ?? "").trim(),
      rating: typeof rating === "number" ? rating : null,
      ordersToday: typeof ordersToday === "number" ? ordersToday : null,
      deliveryTime: (deliveryTime ?? "").trim(),
      hidePrices: hidePrices === true,
      dineInEnabled: dineInEnabled === true,
      cancellationManagerPinEnabled: cancellationManagerPinEnabled !== false,
      cancellationOwnerApprovalEnabled: cancellationOwnerApprovalEnabled !== false,
      whatsappNumber: (whatsappNumber ?? "").trim(),
      showContactSupport: showContactSupport !== false,
      payOnDeliveryEnabled: payOnDeliveryEnabled !== false,
      whatsappCheckoutEnabled: !!whatsappCheckoutEnabled,
      whatsappAdminPin: whatsappAdminPin || "",
      ...(deliveryZones && Array.isArray(deliveryZones) ? { deliveryZones } : {}),
      ...(heroSettings && typeof heroSettings === "object" ? { heroSettings } : {}),
    });

  return NextResponse.json({ success: true });
}
