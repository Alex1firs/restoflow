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
  const rawNames = Array.isArray(body.itemNames) ? body.itemNames : [];
  const itemNames: string[] = rawNames
    .slice(0, 20)
    .map((n) => String(n).slice(0, 100).trim())
    .filter(Boolean);

  const contextPart =
    itemNames.length > 0
      ? `Based on these menu items from a restaurant: ${itemNames.join(", ")}.`
      : "For a restaurant menu.";

  const prompt = `${contextPart} Suggest 4–6 short, clear menu category names. Return only a JSON array of strings, for example: ["Rice Meals","Soups","Grills","Drinks"]. No explanation, no markdown, just the JSON array.`;

  try {
    const raw = await generateText(prompt);
    let suggestions: string[] = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        suggestions = parsed.map((s) => String(s).trim()).filter(Boolean).slice(0, 8);
      }
    } catch {
      suggestions = raw
        .replace(/[\[\]"]/g, "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 8);
    }
    return NextResponse.json({ suggestions });
  } catch (e) {
    console.error("[AI] category-suggestions failed:", e);
    return NextResponse.json({ error: "AI generation failed" }, { status: 500 });
  }
}
