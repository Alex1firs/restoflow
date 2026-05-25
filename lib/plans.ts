export type Plan = {
  id: string;
  name: string;
  monthlyPrice: number;
  setupFee: number;
  popular?: boolean;
  features: string[];
};

export const PLANS: Plan[] = [
  {
    id: "pro",
    name: "Restaflow Pro",
    monthlyPrice: 19999,
    setupFee: 0,
    popular: true,
    features: [
      "QR ordering & digital menu",
      "Unlimited orders",
      "Live kitchen dashboard",
      "POS & counter orders",
      "Table service & open dine-in tabs",
      "Direct Paystack payments",
      "WhatsApp order notifications",
      "Reports & analytics",
      "Custom restaurant branding",
      "Priority support",
    ],
  },
];

export function getPlan(id: string): Plan {
  const plan = PLANS.find((p) => p.id === id);
  if (!plan) {
    throw new Error(
      `Unknown plan ID "${id}". Valid plans: ${PLANS.map((p) => p.id).join(", ")}.`
    );
  }
  return plan;
}
