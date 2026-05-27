import "server-only";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const AI_MODEL = "gemini-flash-latest";

let _genai: GoogleGenerativeAI | null = null;

export function isAiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY?.trim();
}

export async function generateText(prompt: string): Promise<string> {
  if (!process.env.GEMINI_API_KEY?.trim()) throw new Error("AI not configured");
  if (!_genai) _genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = _genai.getGenerativeModel({ model: AI_MODEL });
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}
