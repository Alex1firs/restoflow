"use client";

import { useState } from "react";
import {
  Sparkles, Send, Clock, Database, AlertTriangle, Info,
  Wallet, TrendingUp, Flame, PackageCheck, Timer, Repeat, Users, Mic, MessageSquare,
  type LucideIcon,
} from "lucide-react";
import { QUICK_ACTIONS } from "@/lib/ai/quick-actions";
import VoiceAssistant from "./VoiceAssistant";

const ASSISTANT_NAME = "Your AI Operations Manager";
const ASSISTANT_TAGLINE = "On top of your sales, kitchen, and inventory — ask anything or let it brief you.";

// lucide icon names (from the QUICK_ACTIONS catalog) → components.
const QA_ICONS: Record<string, LucideIcon> = {
  Wallet, TrendingUp, Flame, PackageCheck, Timer, Repeat, Users,
};

type Insight = {
  type: string;
  title: string;
  reason: string;
  suggestedAction: string | null;
  confidenceLevel: string;
};

type AssistantResponse = {
  question: string;
  answer: string;
  mode: "ai" | "deterministic";
  degraded: boolean;
  range: { label: string; from: string; to: string };
  relevantTopics: string[];
  groundedOn: string[];
  insights: Insight[];
};

type Exchange = AssistantResponse & { id: number };

const TOOL_LABELS: Record<string, string> = {
  getRevenueSummary: "Revenue",
  getTodayOrders: "Today's orders",
  getTopSellingItems: "Top sellers",
  getSlowMovingItems: "Slow movers",
  getInventoryOverview: "Availability",
  getCustomerOverview: "Customers",
  getStaffPerformance: "Staff",
  getKitchenPerformance: "Kitchen",
  getBusinessProfile: "Business profile",
  getRestaurantSettings: "Settings",
  getRecentTransactions: "Transactions",
  getMenuAnalytics: "Menu",
  getSalesByHour: "Sales by hour",
};

export default function AssistantClient() {
  const [mode, setMode] = useState<"chat" | "voice">("chat");
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<Exchange[]>([]);
  const [counter, setCounter] = useState(0);

  async function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError("");
    // Conversation memory: send recent turns (chronological, oldest→newest).
    const conversation = history.slice(0, 6).map((h) => ({ question: h.question, answer: h.answer })).reverse();
    try {
      const res = await fetch(`/api/admin/ai/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, history: conversation }),
      });
      if (res.status === 429) {
        setError("You're asking a lot very quickly — give it a moment and try again.");
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Something went wrong. Please try again.");
        return;
      }
      const data = (await res.json()) as AssistantResponse;
      const id = counter + 1;
      setCounter(id);
      setHistory((h) => [{ ...data, id }, ...h]);
      setQuestion("");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 sm:py-10">
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-2xl bg-orange-100 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-orange-600" />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-gray-900 leading-tight">{ASSISTANT_NAME}</h1>
          <p className="text-xs sm:text-sm text-gray-500 font-medium">{ASSISTANT_TAGLINE}</p>
        </div>
      </div>

      {/* Chat / Voice mode toggle */}
      <div className="mt-4 inline-flex items-center gap-1 bg-gray-100 rounded-xl p-1">
        <button
          type="button"
          onClick={() => setMode("chat")}
          className={`inline-flex items-center gap-1.5 text-xs font-black px-3 py-1.5 rounded-lg transition-colors ${mode === "chat" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
        >
          <MessageSquare className="w-3.5 h-3.5" /> Chat
        </button>
        <button
          type="button"
          onClick={() => setMode("voice")}
          className={`inline-flex items-center gap-1.5 text-xs font-black px-3 py-1.5 rounded-lg transition-colors ${mode === "voice" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
        >
          <Mic className="w-3.5 h-3.5" /> Voice
        </button>
      </div>

      {mode === "voice" ? (
        <VoiceAssistant showHeader={false} />
      ) : (
      <>

      {/* Ask box */}
      <div className="mt-6 bg-white border border-gray-200 rounded-2xl p-3 shadow-sm">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(question);
            }
          }}
          rows={2}
          placeholder="Ask about your sales, menu, customers, staff, or kitchen…"
          className="w-full text-sm text-gray-800 placeholder-gray-400 resize-none focus:outline-none px-2 py-1.5"
        />
        <div className="flex items-center justify-between px-2 pt-1">
          <span className="text-[11px] text-gray-400 font-medium">Answers come only from your own data.</span>
          <button
            type="button"
            onClick={() => ask(question)}
            disabled={loading || !question.trim()}
            className="inline-flex items-center gap-1.5 text-sm font-black text-white bg-orange-600 hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 rounded-xl transition-colors"
          >
            {loading ? (
              <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            Ask
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-2 text-sm text-red-600 font-bold">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Quick Actions — one-click suggested questions (replaces the blank state) */}
      {history.length === 0 && !loading && (
        <div className="mt-6">
          <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-2">Quick actions</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {QUICK_ACTIONS.map((qa) => {
              const Icon = QA_ICONS[qa.icon] ?? Sparkles;
              return (
                <button
                  key={qa.id}
                  type="button"
                  onClick={() => ask(qa.question)}
                  className="flex items-center gap-2 text-left text-xs font-bold text-gray-700 bg-white border border-gray-200 hover:border-orange-300 hover:text-orange-700 rounded-xl px-3 py-2.5 transition-colors"
                >
                  <span className="w-7 h-7 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-3.5 h-3.5 text-orange-600" />
                  </span>
                  {qa.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Follow-up hint once a conversation is underway */}
      {history.length > 0 && !loading && (
        <p className="mt-3 text-[11px] text-gray-400 font-medium">
          Ask a follow-up — e.g. “compare with yesterday”, “why?”, or “which items caused it?”
        </p>
      )}

      {/* Answers */}
      <div className="mt-6 space-y-4">
        {history.map((ex) => (
          <div key={ex.id} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
            <p className="text-sm font-black text-gray-900">{ex.question}</p>

            <p className="mt-2 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{ex.answer}</p>

            {/* Meta row */}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-bold">
              <span className="inline-flex items-center gap-1 text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">
                <Clock className="w-3 h-3" /> {ex.range.label}
              </span>
              {ex.mode === "ai" ? (
                <span className="inline-flex items-center gap-1 text-orange-700 bg-orange-100 rounded-full px-2 py-0.5">
                  <Sparkles className="w-3 h-3" /> AI answer
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-gray-600 bg-gray-100 rounded-full px-2 py-0.5">
                  <Info className="w-3 h-3" /> Data summary
                </span>
              )}
              {ex.groundedOn.slice(0, 4).map((t) => (
                <span key={t} className="inline-flex items-center gap-1 text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5">
                  <Database className="w-3 h-3" /> {TOOL_LABELS[t] ?? t}
                </span>
              ))}
            </div>

            {/* Insights */}
            {ex.insights.length > 0 && (
              <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
                <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest">What the data shows</p>
                {ex.insights.slice(0, 4).map((ins, i) => (
                  <div key={i} className="text-xs">
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${dotColor(ins.type)}`} />
                      <span className="font-black text-gray-800">{ins.title}</span>
                      <span className="text-[10px] font-bold text-gray-400">· {ins.confidenceLevel}</span>
                    </div>
                    {ins.suggestedAction && (
                      <p className="text-gray-500 font-medium ml-3.5 mt-0.5">→ {ins.suggestedAction}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      </>
      )}
    </div>
  );
}

function dotColor(type: string): string {
  switch (type) {
    case "warning":
    case "anomaly":
      return "bg-red-400";
    case "opportunity":
      return "bg-blue-400";
    case "highlight":
      return "bg-green-400";
    default:
      return "bg-gray-300";
  }
}
