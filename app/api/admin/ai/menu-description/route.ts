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
  const itemName = String(body.itemName ?? "").slice(0, 120).trim();
  const category = String(body.category ?? "").slice(0, 60).trim();

  if (!itemName) {
    return NextResponse.json({ error: "itemName is required" }, { status: 400 });
  }

  const categoryPart = category ? `, a ${category} item` : "";
  const prompt = `Write a short, appetising menu description (1 sentence, under 100 characters) for a menu item called "${itemName}"${categoryPart}. Be specific about taste or preparation. Return only the description text, nothing else.`;

  try {
    const suggestion = await generateText(prompt);
    return NextResponse.json({ suggestion });
  } catch {
    return NextResponse.json({ error: "AI generation failed" }, { status: 500 });
  }
}
