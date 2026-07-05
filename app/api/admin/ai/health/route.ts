import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { providers, isAnyProviderConfigured } from "@/lib/ai/provider";
import { TOOLS, TOOL_REGISTRY, createIntelligenceContext, getBusinessProfile } from "@/lib/ai/tools";
import { TokenBudget } from "@/lib/ai/guardrails";
import { writeUsageRecord } from "@/lib/ai/usage";

/**
 * GET /api/admin/ai/health
 *
 * Authenticated AI readiness probe. Verifies, WITHOUT calling any LLM:
 *   1. providers      — is Gemini / Anthropic configured (isConfigured only)
 *   2. toolRegistry   — every tool has a descriptor and vice-versa
 *   3. tenantContext  — a tenant-scoped read succeeds (proves auth + isolation + Firestore)
 *   4. tokenBudget    — the budget guard reserves/consumes correctly
 *
 * Records one usage document to `ai_usage`. Never touches core collections.
 * Returns 200 for ok/degraded, 503 when a hard component is broken.
 */
export async function GET() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Diagnostics are a managerial surface — staff cannot probe AI internals.
  if (user.role === "staff") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ctx = createIntelligenceContext(user.restaurantSlug, { feature: "health", role: user.role });

  // 1. Providers (configuration only — no generate() call)
  const providersCheck = {
    gemini: { configured: providers.gemini.isConfigured(), model: providers.gemini.model },
    anthropic: { configured: providers.anthropic.isConfigured(), model: providers.anthropic.model },
    anyConfigured: isAnyProviderConfigured(),
  };

  // 2. Tool registry integrity — descriptors and implementations must line up
  const toolNames = Object.keys(TOOLS);
  const registryNames = Object.keys(TOOL_REGISTRY);
  const missingDescriptors = toolNames.filter((n) => !(n in TOOL_REGISTRY));
  const orphanDescriptors = registryNames.filter((n) => !(n in TOOLS));
  const toolRegistryCheck = {
    tools: toolNames.length,
    descriptors: registryNames.length,
    missingDescriptors,
    orphanDescriptors,
    valid: missingDescriptors.length === 0 && orphanDescriptors.length === 0,
  };

  // 3. Tenant context — a real tenant-scoped read (proves the whole read path)
  let tenantContextCheck: { ok: boolean; restaurantFound: boolean; error?: string };
  try {
    const profile = await getBusinessProfile(ctx);
    tenantContextCheck = { ok: true, restaurantFound: !!profile.data.name };
  } catch (err) {
    tenantContextCheck = { ok: false, restaurantFound: false, error: err instanceof Error ? err.message : String(err) };
  }

  // 4. Token budget guard
  let tokenBudgetCheck: { ok: boolean; error?: string };
  try {
    const b = new TokenBudget({ maxTokensPerRequest: 1000, maxCostPerRequestUsd: 1 });
    b.reserve(100, 0.01);
    b.consume(100, 0.01);
    let threw = false;
    try {
      b.reserve(100_000, 0);
    } catch {
      threw = true;
    }
    tokenBudgetCheck = { ok: b.usage.tokens === 100 && threw };
  } catch (err) {
    tokenBudgetCheck = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Overall status: hard components (registry, tenant, budget) must pass;
  // a missing provider key is a soft "degraded", not an error.
  const hardOk = toolRegistryCheck.valid && tenantContextCheck.ok && tokenBudgetCheck.ok;
  const status: "ok" | "degraded" | "error" = !hardOk
    ? "error"
    : providersCheck.anyConfigured
      ? "ok"
      : "degraded";

  // Persist the probe to ai_usage (the only write; never a core collection).
  await writeUsageRecord(ctx, {
    status: status === "error" ? "error" : "ok",
    note: `health: providers=${providersCheck.anyConfigured} registry=${toolRegistryCheck.valid} tenant=${tenantContextCheck.ok} budget=${tokenBudgetCheck.ok}`,
  });

  const body = {
    status,
    restaurantSlug: user.restaurantSlug,
    checkedAt: ctx.now().toISOString(),
    checks: {
      providers: providersCheck,
      toolRegistry: toolRegistryCheck,
      tenantContext: tenantContextCheck,
      tokenBudget: tokenBudgetCheck,
    },
  };

  return NextResponse.json(body, { status: status === "error" ? 503 : 200 });
}
