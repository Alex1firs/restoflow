import "server-only";

/**
 * Tool Layer — public surface.
 *
 * Every AI capability consumes trusted, typed tools from here. The AI must never
 * query Firestore directly. Each tool:
 *   - is tenant-scoped (via IntelligenceContext / TenantReader)
 *   - is server-only and read-only
 *   - returns a structured `ToolResult<T>`
 *   - is independently testable and reusable across all AI features
 */

export { getRevenueSummary } from "./getRevenueSummary";
export { getTodayOrders } from "./getTodayOrders";
export { getTopSellingItems } from "./getTopSellingItems";
export { getSlowMovingItems } from "./getSlowMovingItems";
export { getInventoryOverview } from "./getInventoryOverview";
export { getCustomerOverview } from "./getCustomerOverview";
export { getStaffPerformance } from "./getStaffPerformance";
export { getKitchenPerformance } from "./getKitchenPerformance";
export { getBusinessProfile } from "./getBusinessProfile";
export { getRestaurantSettings } from "./getRestaurantSettings";
export { getRecentTransactions } from "./getRecentTransactions";
export { getMenuAnalytics } from "./getMenuAnalytics";
export { getSalesByHour } from "./getSalesByHour";

export {
  IntelligenceContext,
  createIntelligenceContext,
  resolveRange,
  isRevenueOrder,
  normalizeOrder,
  type IntelligenceContextOptions,
} from "./_shared";

import { getRevenueSummary } from "./getRevenueSummary";
import { getTodayOrders } from "./getTodayOrders";
import { getTopSellingItems } from "./getTopSellingItems";
import { getSlowMovingItems } from "./getSlowMovingItems";
import { getInventoryOverview } from "./getInventoryOverview";
import { getCustomerOverview } from "./getCustomerOverview";
import { getStaffPerformance } from "./getStaffPerformance";
import { getKitchenPerformance } from "./getKitchenPerformance";
import { getBusinessProfile } from "./getBusinessProfile";
import { getRestaurantSettings } from "./getRestaurantSettings";
import { getRecentTransactions } from "./getRecentTransactions";
import { getMenuAnalytics } from "./getMenuAnalytics";
import { getSalesByHour } from "./getSalesByHour";

/**
 * Machine-readable registry describing each tool: id, description, category,
 * permissions, the collections it reads, and an estimated per-invocation cost.
 * Future phases (Copilot tool-calling, permission checks, budgeting) can reason
 * about a tool from this metadata without importing it.
 *
 * `ToolDescriptor` is defined in `../types`.
 */
export type { ToolDescriptor } from "../types";
import type { ToolDescriptor, UserRole } from "../types";

// Common permission sets. Advisory — the *calling route* enforces authorization.
const OPERATIONAL: UserRole[] = ["owner", "manager", "staff"]; // front-of-house data
const MANAGERIAL: UserRole[] = ["owner", "manager"]; // financial / sensitive data

export const TOOL_REGISTRY: Record<string, ToolDescriptor> = {
  getRevenueSummary: { id: "getRevenueSummary", name: "getRevenueSummary", description: "Revenue & order totals for a window, with trend vs the previous period.", category: "sales", acceptsRange: true, permissions: MANAGERIAL, readsCollections: ["orders"], estimatedCost: { tokens: 500, usd: 0.0013, tier: "low" } },
  getTodayOrders: { id: "getTodayOrders", name: "getTodayOrders", description: "Live snapshot of today's orders by status, active count, and revenue so far.", category: "orders", acceptsRange: false, permissions: OPERATIONAL, readsCollections: ["orders"], estimatedCost: { tokens: 400, usd: 0.001, tier: "low" } },
  getTopSellingItems: { id: "getTopSellingItems", name: "getTopSellingItems", description: "Best-selling items by quantity for a window.", category: "menu", acceptsRange: true, permissions: OPERATIONAL, readsCollections: ["orders"], estimatedCost: { tokens: 400, usd: 0.001, tier: "low" } },
  getSlowMovingItems: { id: "getSlowMovingItems", name: "getSlowMovingItems", description: "Menu items with little or no sales in a window (incl. never-sold).", category: "menu", acceptsRange: true, permissions: OPERATIONAL, readsCollections: ["orders", "menu_items"], estimatedCost: { tokens: 500, usd: 0.0013, tier: "low" } },
  getInventoryOverview: { id: "getInventoryOverview", name: "getInventoryOverview", description: "Item availability health (no quantitative stock model exists).", category: "inventory", acceptsRange: false, permissions: OPERATIONAL, readsCollections: ["menu_items", "prepared_items"], estimatedCost: { tokens: 500, usd: 0.0013, tier: "low" } },
  getCustomerOverview: { id: "getCustomerOverview", name: "getCustomerOverview", description: "Distinct/new/returning customers, repeat rate, top customers (masked), loyalty.", category: "customers", acceptsRange: true, permissions: MANAGERIAL, readsCollections: ["orders", "restaurants/{slug}/loyalty_customers"], estimatedCost: { tokens: 700, usd: 0.0018, tier: "medium" } },
  getStaffPerformance: { id: "getStaffPerformance", name: "getStaffPerformance", description: "Per-staff order throughput and revenue for a window.", category: "staff", acceptsRange: true, permissions: MANAGERIAL, readsCollections: ["orders", "users"], estimatedCost: { tokens: 500, usd: 0.0013, tier: "low" } },
  getKitchenPerformance: { id: "getKitchenPerformance", name: "getKitchenPerformance", description: "Average prep/ready times from order timestamps.", category: "kitchen", acceptsRange: true, permissions: OPERATIONAL, readsCollections: ["orders"], estimatedCost: { tokens: 300, usd: 0.0008, tier: "low" } },
  getBusinessProfile: { id: "getBusinessProfile", name: "getBusinessProfile", description: "Restaurant identity, open/closed state, channels, subscription, loyalty.", category: "business", acceptsRange: false, permissions: OPERATIONAL, readsCollections: ["restaurants"], estimatedCost: { tokens: 300, usd: 0.0008, tier: "low" } },
  getRestaurantSettings: { id: "getRestaurantSettings", name: "getRestaurantSettings", description: "Operational settings (fees, minimums, channels, payments) — sensitive keys excluded.", category: "settings", acceptsRange: false, permissions: MANAGERIAL, readsCollections: ["restaurants"], estimatedCost: { tokens: 400, usd: 0.001, tier: "low" } },
  getRecentTransactions: { id: "getRecentTransactions", name: "getRecentTransactions", description: "Most recent order transactions with masked customer refs.", category: "sales", acceptsRange: true, permissions: MANAGERIAL, readsCollections: ["orders"], estimatedCost: { tokens: 800, usd: 0.002, tier: "medium" } },
  getMenuAnalytics: { id: "getMenuAnalytics", name: "getMenuAnalytics", description: "Menu structure: item/category counts, price distribution, availability.", category: "menu", acceptsRange: false, permissions: OPERATIONAL, readsCollections: ["menu_items"], estimatedCost: { tokens: 400, usd: 0.001, tier: "low" } },
  getSalesByHour: { id: "getSalesByHour", name: "getSalesByHour", description: "Sales distribution across 24 hours (Africa/Lagos); peak hours.", category: "sales", acceptsRange: true, permissions: MANAGERIAL, readsCollections: ["orders"], estimatedCost: { tokens: 500, usd: 0.0013, tier: "low" } },
};

/** All tools keyed by name, for programmatic invocation. */
export const TOOLS = {
  getRevenueSummary,
  getTodayOrders,
  getTopSellingItems,
  getSlowMovingItems,
  getInventoryOverview,
  getCustomerOverview,
  getStaffPerformance,
  getKitchenPerformance,
  getBusinessProfile,
  getRestaurantSettings,
  getRecentTransactions,
  getMenuAnalytics,
  getSalesByHour,
} as const;

export type ToolName = keyof typeof TOOLS;
