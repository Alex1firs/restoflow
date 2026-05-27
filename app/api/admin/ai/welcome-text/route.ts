import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { isAiConfigured, generateText } from "@/lib/ai-server";

export async function POST(req: NextRequest) {
  if (!isAiConfigured()) {
    return NextResponse.json({ error: "ai_not_configured" }, { status: 503 });
  }

  try {
    await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const restaurantName = String(body.restaurantName ?? "").slice(0, 120).trim();
  const description = String(body.description ?? "").slice(0, 300).trim();

  if (!restaurantName) {
    return NextResponse.json({ error: "restaurantName is required" }, { status: 400 });
  }

  const descPart = description ? ` The restaurant specialises in: ${description}.` : "";
  const prompt = `Write a short storefront welcome message (1–2 sentences, under 100 characters) for a restaurant called "${restaurantName}".${descPart} Use a warm, inviting tone. Do not start with "Welcome to". Return only the message text, nothing else.`;

  try {
    const suggestion = await generateText(prompt);
    return NextResponse.json({ suggestion });
  } catch {
    return NextResponse.json({ error: "AI generation failed" }, { status: 500 });
  }
}
