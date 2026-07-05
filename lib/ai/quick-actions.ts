/**
 * Quick Actions
 * =============
 * One-click prompts for the assistant, so owners can get answers without typing.
 * Each action is just a canned question routed through the normal assistant
 * endpoint — same grounding, same guardrails. Pure data (no server imports) so
 * both the API and the client UI can share this catalog.
 */

import type { ToolCategory } from "./types";

export interface QuickAction {
  id: string;
  label: string;
  /** lucide-react icon name (resolved to a component in the client). */
  icon: string;
  /** The question sent to the assistant when clicked. */
  question: string;
  category: ToolCategory;
}

export const QUICK_ACTIONS: QuickAction[] = [
  { id: "revenue_today", label: "Revenue Today", icon: "Wallet", question: "How much revenue did we make today?", category: "sales" },
  { id: "revenue_week", label: "Revenue This Week", icon: "TrendingUp", question: "How much revenue did we make this week, and how does it compare to the previous week?", category: "sales" },
  { id: "top_meals", label: "Top Selling Meals", icon: "Flame", question: "What are our top selling meals this week?", category: "menu" },
  { id: "inventory_health", label: "Inventory Health", icon: "PackageCheck", question: "What is our inventory and item availability health right now?", category: "inventory" },
  { id: "kitchen_perf", label: "Kitchen Performance", icon: "Timer", question: "How is our kitchen performance today — any bottlenecks?", category: "kitchen" },
  { id: "customer_retention", label: "Customer Retention", icon: "Repeat", question: "How is our customer retention this month — how many repeat customers did we have?", category: "customers" },
  { id: "staff_perf", label: "Staff Performance", icon: "Users", question: "How did our staff perform this week?", category: "staff" },
];

export function getQuickAction(id: string): QuickAction | undefined {
  return QUICK_ACTIONS.find((a) => a.id === id);
}
