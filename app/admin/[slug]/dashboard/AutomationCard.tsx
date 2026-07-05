"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Play, Undo2, CheckCircle2, XCircle, Clock, ShieldCheck } from "lucide-react";

/**
 * AI Automation control center — approval-first.
 *
 * Owners turn on automation *capabilities* (nothing runs until they do). Accepted
 * recommendations can be turned into automations, which are then run manually (or,
 * once enabled, by the system). Every run is recorded in the audit trail. Runs and
 * rollbacks call the automation API; the AI engines are never re-invoked here.
 */

type Actor = { type: string; id: string };
type Rule = { kind: string; enabled: boolean; autoExecute: boolean };
type HandlerKind = { kind: string; reversible: boolean; mutatesCore: boolean };
type Automation = {
  id: string;
  handlerKind: string;
  title: string;
  status: string;
  lastExecutionId: string | null;
  source: { type: string; id: string };
};
type Execution = {
  id: string;
  automationId: string;
  status: string;
  finishedAt: string;
  actor: Actor;
  attempt: number;
  rollback: { rolledBackAt: string } | null;
  rollbackToken: string | null;
};
type Rec = { id: string; title: string; status: string; type: string };

const PRETTY: Record<string, string> = {
  notify: "Notifications",
  purchase_order_draft: "Restock order drafts",
};
const prettyKind = (k: string) => PRETTY[k] ?? k.replace(/_/g, " ");

export default function AutomationCard({ role }: { role?: string }) {
  const canManage = role === "owner" || role === "manager";
  const [rules, setRules] = useState<Rule[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [handlerKinds, setHandlerKinds] = useState<HandlerKind[]>([]);
  const [acceptedRecs, setAcceptedRecs] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [autoRes, recRes] = await Promise.all([
      fetch(`/api/admin/ai/automation`),
      fetch(`/api/admin/ai/recommendations`),
    ]);
    if (autoRes.ok) {
      const b = (await autoRes.json()) as { rules: Rule[]; automations: Automation[]; executions: Execution[]; handlerKinds: HandlerKind[] };
      setRules(b.rules);
      setAutomations(b.automations);
      setExecutions(b.executions);
      setHandlerKinds(b.handlerKinds);
    }
    if (recRes.ok) {
      const r = (await recRes.json()) as { recommendations: Rec[] };
      setAcceptedRecs(r.recommendations.filter((x) => x.status === "accepted"));
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await load();
      } catch {
        /* leave empty */
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [load]);

  const ruleFor = (kind: string) => rules.find((r) => r.kind === kind);
  const execFor = (id: string | null) => (id ? executions.find((e) => e.id === id) : undefined);
  const reversible = (kind: string) => handlerKinds.find((h) => h.kind === kind)?.reversible;

  async function post(body: Record<string, unknown>, key: string): Promise<boolean> {
    setBusy(key);
    setError("");
    try {
      const res = await fetch(`/api/admin/ai/automation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? "Something went wrong.");
        return false;
      }
      await load();
      return true;
    } catch {
      setError("Network error.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const automatedSourceIds = new Set(automations.map((a) => a.source.id));

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="space-y-2 animate-pulse">
          <div className="h-3 bg-gray-100 rounded w-1/2" />
          <div className="h-3 bg-gray-100 rounded w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center">
          <Bot className="w-4 h-4 text-indigo-600" />
        </span>
        <h2 className="text-sm font-black text-gray-900 leading-tight">Automation</h2>
      </div>
      <p className="text-[11px] text-gray-400 mb-3 flex items-center gap-1">
        <ShieldCheck className="w-3 h-3" /> Approval-first — nothing runs until you enable it.
      </p>

      {/* Capabilities */}
      <div className="space-y-2 mb-4">
        {handlerKinds.map((h) => {
          const enabled = ruleFor(h.kind)?.enabled ?? false;
          return (
            <div key={h.kind} className="flex items-center justify-between gap-2">
              <span className="text-sm text-gray-700 capitalize">{prettyKind(h.kind)}</span>
              {canManage ? (
                <button
                  type="button"
                  disabled={busy === `rule:${h.kind}`}
                  onClick={() => post({ op: "set_rule", kind: h.kind, enabled: !enabled }, `rule:${h.kind}`)}
                  className={`relative w-10 h-5 rounded-full transition-colors disabled:opacity-40 ${enabled ? "bg-indigo-600" : "bg-gray-200"}`}
                  aria-pressed={enabled}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`} />
                </button>
              ) : (
                <span className={`text-[11px] font-black ${enabled ? "text-indigo-600" : "text-gray-400"}`}>{enabled ? "On" : "Off"}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Ready to automate — accepted recommendations not yet automated */}
      {canManage && acceptedRecs.filter((r) => !automatedSourceIds.has(r.id)).length > 0 && (
        <div className="mb-4">
          <p className="text-[11px] font-black text-gray-500 uppercase tracking-wide mb-1.5">Ready to automate</p>
          <ul className="space-y-1.5">
            {acceptedRecs.filter((r) => !automatedSourceIds.has(r.id)).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-600 truncate">{r.title}</span>
                <button
                  type="button"
                  disabled={busy === `create:${r.id}`}
                  onClick={() => post({ op: "create_from_recommendation", recId: r.id }, `create:${r.id}`)}
                  className="text-[11px] font-black text-indigo-600 hover:text-indigo-700 disabled:opacity-40 whitespace-nowrap"
                >
                  + Automate
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Automations */}
      {automations.length === 0 ? (
        <p className="text-sm text-gray-500">No automations yet. Accept a recommendation, then automate it here.</p>
      ) : (
        <ul className="space-y-2">
          {automations.map((a) => {
            const enabled = ruleFor(a.handlerKind)?.enabled ?? false;
            const lastExec = execFor(a.lastExecutionId);
            const canRun = (a.status === "approved" || a.status === "failed") && enabled;
            const canUndo = a.status === "succeeded" && reversible(a.handlerKind) && lastExec && !lastExec.rollback && lastExec.rollbackToken;
            return (
              <li key={a.id} className="rounded-xl border border-gray-100 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-gray-900 truncate">{a.title}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1">
                      <StatusChip status={a.status} /> {prettyKind(a.handlerKind)}
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {canRun && (
                        <button
                          type="button"
                          disabled={busy === `exec:${a.id}`}
                          onClick={() => post({ op: "execute", automationId: a.id }, `exec:${a.id}`)}
                          className="inline-flex items-center gap-1 text-[11px] font-black text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 px-2.5 py-1 rounded-lg"
                        >
                          <Play className="w-3 h-3" /> Run
                        </button>
                      )}
                      {canUndo && (
                        <button
                          type="button"
                          disabled={busy === `undo:${a.id}`}
                          onClick={() => post({ op: "rollback", executionId: lastExec!.id }, `undo:${a.id}`)}
                          className="inline-flex items-center gap-1 text-[11px] font-black text-gray-500 hover:text-gray-700 disabled:opacity-40"
                        >
                          <Undo2 className="w-3 h-3" /> Undo
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {!enabled && (a.status === "approved" || a.status === "failed") && (
                  <p className="text-[11px] text-amber-600 mt-1">Enable “{prettyKind(a.handlerKind)}” above to run this.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="text-xs text-red-500 font-bold mt-3">{error}</p>}
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { icon: typeof CheckCircle2; cls: string; label: string }> = {
    succeeded: { icon: CheckCircle2, cls: "text-green-600", label: "Succeeded" },
    failed: { icon: XCircle, cls: "text-red-500", label: "Failed" },
    rolled_back: { icon: Undo2, cls: "text-gray-500", label: "Rolled back" },
    approved: { icon: Clock, cls: "text-indigo-500", label: "Ready" },
  };
  const s = map[status] ?? map.approved;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-0.5 font-black ${s.cls}`}>
      <Icon className="w-3 h-3" /> {s.label}
    </span>
  );
}
