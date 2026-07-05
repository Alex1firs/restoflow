import "server-only";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";
import { estimateTokens, TokenBudget } from "./guardrails";

/**
 * AI Provider Abstraction
 * =======================
 * One interface, two backends:
 *
 *   - Gemini (gemini-2.5-flash)     — fast/cheap. Default for short generation.
 *   - Anthropic (claude)            — reasoning. For complex analysis/synthesis.
 *
 * Business logic never talks to a vendor SDK directly — it asks for a provider
 * by *capability* ("fast" | "reasoning") via `selectProvider`, so a third
 * backend can be added later without touching any caller.
 *
 * IMPORTANT (Sprint 1A): This module is infrastructure only. Nothing in this
 * sprint calls `generate()` from a production route. Every call is metered
 * against a TokenBudget and every provider is safe when unconfigured
 * (`isConfigured()` returns false rather than throwing at import time).
 */

export type ProviderName = "gemini" | "anthropic";
export type Capability = "fast" | "reasoning";

export interface GenerateOptions {
  /** System / role instruction. */
  system?: string;
  maxTokens?: number;
  temperature?: number;
  /** Optional budget guard — reserve/consume is enforced when provided. */
  budget?: TokenBudget;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Estimated cost in USD, using the provider's per-token pricing. */
  estimatedCostUsd: number;
}

export interface GenerateResult {
  text: string;
  provider: ProviderName;
  model: string;
  usage: TokenUsage;
}

export interface AiProvider {
  readonly name: ProviderName;
  readonly model: string;
  readonly capabilities: Capability[];
  isConfigured(): boolean;
  generate(prompt: string, opts?: GenerateOptions): Promise<GenerateResult>;
}

/**
 * Per-1M-token USD pricing — ESTIMATES for budgeting only. Update when vendor
 * pricing changes; these values only affect the in-memory cost ceiling, never
 * billing.
 */
const PRICING: Record<ProviderName, { inPerM: number; outPerM: number }> = {
  gemini: { inPerM: 0.3, outPerM: 2.5 },
  anthropic: { inPerM: 3.0, outPerM: 15.0 },
};

function costUsd(provider: ProviderName, inputTokens: number, outputTokens: number): number {
  const p = PRICING[provider];
  return (inputTokens / 1_000_000) * p.inPerM + (outputTokens / 1_000_000) * p.outPerM;
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

export class GeminiProvider implements AiProvider {
  readonly name = "gemini" as const;
  readonly model = "gemini-2.5-flash";
  readonly capabilities: Capability[] = ["fast"];
  private client: GoogleGenerativeAI | null = null;

  isConfigured(): boolean {
    return !!process.env.GEMINI_API_KEY?.trim();
  }

  async generate(prompt: string, opts: GenerateOptions = {}): Promise<GenerateResult> {
    if (!this.isConfigured()) throw new Error("Gemini not configured (GEMINI_API_KEY missing)");

    const fullPrompt = opts.system ? `${opts.system}\n\n${prompt}` : prompt;
    const estIn = estimateTokens(fullPrompt);
    const estOut = opts.maxTokens ?? 1024;
    opts.budget?.reserve(estIn + estOut, costUsd("gemini", estIn, estOut));

    if (!this.client) this.client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = this.client.getGenerativeModel({
      model: this.model,
      generationConfig: {
        temperature: opts.temperature ?? 0.4,
        maxOutputTokens: opts.maxTokens ?? 1024,
      },
    });

    const result = await model.generateContent(fullPrompt);
    const text = result.response.text().trim();

    const usageMeta = result.response.usageMetadata;
    const inputTokens = usageMeta?.promptTokenCount ?? estIn;
    const outputTokens = usageMeta?.candidatesTokenCount ?? estimateTokens(text);
    const cost = costUsd("gemini", inputTokens, outputTokens);
    opts.budget?.consume(inputTokens + outputTokens, cost);

    return {
      text,
      provider: this.name,
      model: this.model,
      usage: { inputTokens, outputTokens, estimatedCostUsd: cost },
    };
  }
}

// ---------------------------------------------------------------------------
// Anthropic (Claude)
// ---------------------------------------------------------------------------

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic" as const;
  readonly model = "claude-sonnet-5";
  readonly capabilities: Capability[] = ["reasoning", "fast"];
  private client: Anthropic | null = null;

  isConfigured(): boolean {
    return !!process.env.ANTHROPIC_API_KEY?.trim();
  }

  async generate(prompt: string, opts: GenerateOptions = {}): Promise<GenerateResult> {
    if (!this.isConfigured()) throw new Error("Anthropic not configured (ANTHROPIC_API_KEY missing)");

    const estIn = estimateTokens((opts.system ?? "") + prompt);
    const estOut = opts.maxTokens ?? 1024;
    opts.budget?.reserve(estIn + estOut, costUsd("anthropic", estIn, estOut));

    if (!this.client) this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.4,
      system: opts.system,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    const inputTokens = message.usage?.input_tokens ?? estIn;
    const outputTokens = message.usage?.output_tokens ?? estimateTokens(text);
    const cost = costUsd("anthropic", inputTokens, outputTokens);
    opts.budget?.consume(inputTokens + outputTokens, cost);

    return {
      text,
      provider: this.name,
      model: this.model,
      usage: { inputTokens, outputTokens, estimatedCostUsd: cost },
    };
  }
}

// ---------------------------------------------------------------------------
// Registry & selection
// ---------------------------------------------------------------------------

const gemini = new GeminiProvider();
const anthropic = new AnthropicProvider();

export const providers: Record<ProviderName, AiProvider> = { gemini, anthropic };

/** True if at least one provider is configured — mirrors the existing `isAiConfigured()`. */
export function isAnyProviderConfigured(): boolean {
  return gemini.isConfigured() || anthropic.isConfigured();
}

/**
 * Pick a provider by capability, falling back gracefully to whatever is
 * configured. Reasoning tasks prefer Anthropic; fast tasks prefer Gemini.
 * Returns null if nothing is configured (callers must handle the 503 case,
 * exactly like the existing AiTextHelper pattern).
 */
export function selectProvider(capability: Capability = "fast"): AiProvider | null {
  if (capability === "reasoning") {
    if (anthropic.isConfigured()) return anthropic;
    if (gemini.isConfigured()) return gemini; // degrade rather than fail
    return null;
  }
  // fast
  if (gemini.isConfigured()) return gemini;
  if (anthropic.isConfigured()) return anthropic;
  return null;
}

/** Explicitly get a named provider (e.g. for A/B evaluation). */
export function getProvider(name: ProviderName): AiProvider {
  return providers[name];
}
