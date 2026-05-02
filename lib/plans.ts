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
    id: "starter",
    name: "Starter",
    monthlyPrice: 15000,
    setupFee: 50000,
    features: [
      "Online menu with QR ordering",
      "Up to 200 orders/month",
      "Order management dashboard",
      "Customer online payments",
      "Email support",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    monthlyPrice: 25000,
    setupFee: 75000,
    popular: true,
    features: [
      "Everything in Starter",
      "Unlimited orders",
      "Priority support",
      "Custom restaurant branding",
      "Order analytics",
    ],
  },
  {
    id: "premium",
    name: "Premium",
    monthlyPrice: 40000,
    setupFee: 100000,
    features: [
      "Everything in Growth",
      "Multiple locations",
      "Advanced analytics dashboard",
      "Dedicated account manager",
      "Custom integrations",
    ],
  },
];

export function getPlan(id: string): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}
