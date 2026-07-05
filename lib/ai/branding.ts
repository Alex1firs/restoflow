/**
 * Customer-facing branding for the AI assistant.
 *
 * Internally the feature is the "Copilot"; customers see "Restaurant
 * Intelligence". Centralised here so the name can change in one place without
 * touching the engine, endpoint, or UI.
 */

/** The product name restaurant owners see. */
export const ASSISTANT_NAME = "Restaurant Intelligence";

/** Short call-to-action label (buttons, nav). */
export const ASSISTANT_SHORT = "Intelligence";

/** One-line description for headers / empty states. */
export const ASSISTANT_TAGLINE = "Ask about your restaurant's performance and get answers from your own data.";

/** Example questions surfaced in the UI to guide first-time users. */
export const ASSISTANT_EXAMPLES: string[] = [
  "How much did we make today?",
  "What are our top five selling meals this week?",
  "Why were sales lower yesterday?",
  "Which menu items are underperforming?",
  "How many repeat customers did we have this month?",
  "Show me today's kitchen bottlenecks.",
];
