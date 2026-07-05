import "server-only";
import { selectProvider, type AiProvider } from "./provider";
import type { IntelligenceContext } from "./tools/_shared";

/**
 * Shared narration helper used by every AI feature that turns grounded data into
 * plain language (the Assistant, Explain, and — later — the Daily Brief).
 *
 * Centralises: provider selection, budget enforcement, error handling, and the
 * graceful deterministic fallback. Business logic never touches a vendor SDK; it
 * hands over a system prompt + user prompt + a deterministic fallback and gets
 * back a normalised result.
 */

export interface NarrationResult {
  text: string;
  mode: "ai" | "deterministic";
  /** True when the LLM was unavailable/errored and the fallback was used. */
  degraded: boolean;
  provider: string | null;
  usage: { tokensUsed: number; costUsd: number } | null;
}

export interface NarrateArgs {
  system: string;
  userPrompt: string;
  /** Produces a deterministic answer from trusted data when no LLM is available. */
  deterministic: () => string;
  /**
   * Provider override. `undefined` → selectProvider("reasoning"). `null` →
   * force the deterministic path (used to simulate "no LLM configured").
   */
  provider?: AiProvider | null;
  maxTokens?: number;
  temperature?: number;
}

export async function narrate(ctx: IntelligenceContext, args: NarrateArgs): Promise<NarrationResult> {
  const provider = args.provider !== undefined ? args.provider : selectProvider("reasoning");

  if (!provider) {
    return { text: args.deterministic(), mode: "deterministic", degraded: true, provider: null, usage: null };
  }

  try {
    const result = await provider.generate(args.userPrompt, {
      system: args.system,
      temperature: args.temperature ?? 0.2,
      maxTokens: args.maxTokens ?? 700,
      budget: ctx.budget,
    });
    const text = result.text || args.deterministic();
    return {
      text,
      mode: "ai",
      degraded: false,
      provider: result.provider,
      usage: { tokensUsed: result.usage.inputTokens + result.usage.outputTokens, costUsd: result.usage.estimatedCostUsd },
    };
  } catch (err) {
    ctx.audit.record("narration.provider_error", { error: err instanceof Error ? err.message : String(err) });
    return { text: args.deterministic(), mode: "deterministic", degraded: true, provider: null, usage: null };
  }
}
