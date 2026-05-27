import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAnthropicClient, generateText } from "@/lib/ai-server";

export async function POST(req: NextRequest) {
  if (!getAnthropicClient()) {
    return NextResponse.json({ error: "ai_not_configured" }, { status: 503 });
  }

  try {
    await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const restaurantName = String(body.restaurantName ?? "").slice(0, 120).trim();
  const existingDescription = String(body.existingDescription ?? "").slice(0, 500).trim();
  const action = body.action === "improve" ? "improve" : "generate";

  if (!restaurantName) {
    return NextResponse.json({ error: "restaurantName is required" }, { status: 400 });
  }

  const prompt =
    action === "improve" && existingDescription
      ? `Improve this restaurant description for a restaurant called "${restaurantName}": "${existingDescription}". Make it more specific, appealing, and concise — ideally 1–2 sentences, under 120 characters. Return only the improved description text, nothing else.`
      : `Write a short restaurant description (1–2 sentences, under 120 characters) for a restaurant called "${restaurantName}". Be direct and appetising. Return only the description text, nothing else.`;

  try {
    const suggestion = await generateText(prompt);
    return NextResponse.json({ suggestion });
  } catch {
    return NextResponse.json({ error: "AI generation failed" }, { status: 500 });
  }
}
