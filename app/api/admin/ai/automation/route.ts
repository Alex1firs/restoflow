import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  createAutomationFromRecommendation,
  createAutomationFromPurchasingLine,
  executeAutomation,
  rollbackExecution,
  listAutomations,
  listExecutions,
  listAutomationRules,
  setAutomationRule,
  availableHandlerKinds,
  AutomationDisabledError,
  AutomationNotApprovedError,
  AutomationStateError,
} from "@/lib/ai/automation";
import type { ActorRef } from "@/lib/ai/types";

/**
 * GET  /api/admin/ai/automation  → rules, automations, executions, handler kinds.
 * POST /api/admin/ai/automation  → dispatch by `op`:
 *   - set_rule                 { kind, enabled, autoExecute? }
 *   - create_from_recommendation { recId }
 *   - create_from_purchasing   { item }
 *   - execute                  { automationId }
 *   - rollback                 { executionId }
 *
 * Approval-first: creation needs an approved source; execution needs an enabled rule.
 * Owner/manager only. Writes only ai_automation_* + ai_usage.
 */

function actorFor(user: { role: string; uid: string }): ActorRef {
  return { type: user.role === "manager" ? "manager" : "owner", id: user.uid };
}

export async function GET() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const slug = user.restaurantSlug;
  const [rules, automations, executions] = await Promise.all([
    listAutomationRules(slug),
    listAutomations(slug),
    listExecutions(slug),
  ]);
  return NextResponse.json({ rules, automations, executions, handlerKinds: availableHandlerKinds() }, { status: 200 });
}

export async function POST(req: Request) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { allowed } = await checkRateLimit(`ai-automation:${user.uid}`, 20, 60_000);
  if (!allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const slug = user.restaurantSlug;
  const actor = actorFor(user);
  const op = String(body.op ?? "");

  try {
    switch (op) {
      case "set_rule": {
        const rule = await setAutomationRule(
          slug,
          String(body.kind),
          { enabled: body.enabled === true, autoExecute: body.autoExecute === true },
          actor
        );
        return NextResponse.json({ rule }, { status: 200 });
      }
      case "create_from_recommendation": {
        const automation = await createAutomationFromRecommendation(slug, String(body.recId), actor);
        return NextResponse.json({ automation }, { status: 200 });
      }
      case "create_from_purchasing": {
        const automation = await createAutomationFromPurchasingLine(slug, String(body.item), actor);
        return NextResponse.json({ automation }, { status: 200 });
      }
      case "execute": {
        const res = await executeAutomation(slug, String(body.automationId), actor);
        return NextResponse.json(res, { status: 200 });
      }
      case "rollback": {
        const execution = await rollbackExecution(slug, String(body.executionId), actor);
        return NextResponse.json({ execution }, { status: 200 });
      }
      default:
        return NextResponse.json({ error: `Unknown operation "${op}".` }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof AutomationDisabledError || err instanceof AutomationNotApprovedError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof AutomationStateError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[ai-automation] error:", err);
    return NextResponse.json({ error: "Automation request failed. Please try again." }, { status: 500 });
  }
}
