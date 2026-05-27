import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const AI_MODEL = "claude-haiku-4-5-20251001";
export const AI_MAX_TOKENS = 256;

let _client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return null;
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

export async function generateText(prompt: string): Promise<string> {
  const client = getAnthropicClient();
  if (!client) throw new Error("AI not configured");
  const msg = await client.messages.create({
    model: AI_MODEL,
    max_tokens: AI_MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  });
  const block = msg.content[0];
  return block.type === "text" ? block.text.trim() : "";
}
