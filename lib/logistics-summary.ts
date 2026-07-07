// Pure, display-layer "logistics & trust" summary for the storefront.
//
// Answers the customer's practical pre-checkout questions (open? deliver? pick
// up? where? what payments? any fee? which areas? is my cart safe?) using ONLY
// the restaurant's real settings. It NEVER invents a fee, time, area, or payment
// method — when a value is unknown it returns honest fallback copy. No backend,
// no I/O; it just shapes existing props into labels a small banner can render.

export type DeliveryZoneLite = { id: string; name: string; fee: number };

export type LogisticsInput = {
  isOpen: boolean;
  preorderEnabled: boolean;
  nextOpenLabel: string | null;      // from the existing nextOpenTime helper
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  dineInEnabled: boolean;
  deliveryFee: number;               // flat fee; 0 means "unset / not a flat fee"
  deliveryZones: DeliveryZoneLite[]; // if present, fee is per-zone (dynamic)
  pickupAddress: string | null;
  onlinePaymentEnabled: boolean;
  whatsappCheckoutEnabled: boolean;
  payOnDeliveryEnabled: boolean;     // default true when the flag is unset
  hidePrices: boolean;               // catalog mode → pay in person only
  serviceAreas: string[];            // SEO free-text areas, fallback for zones
};

export type LogisticsSummary = {
  status: { open: boolean; label: string; opensLabel: string | null; preorder: boolean };
  delivery: { available: boolean; feeKnown: boolean; feeLabel: string; areas: string[] };
  pickup: { available: boolean; location: string | null };
  dineIn: boolean;
  payments: string[];       // readable, only methods actually enabled
  fulfillmentLabel: string; // e.g. "Delivery · Pickup"
};

// Honest fallback when a delivery fee isn't a knowable flat number.
export const DYNAMIC_FEE_COPY = "Delivery fee calculated at checkout";

export function buildLogisticsSummary(
  i: LogisticsInput,
  formatMoney: (n: number) => string,
): LogisticsSummary {
  // ── Open / closed (reuses the closed-store next-open label) ──
  const open = !!i.isOpen;
  const opensLabel = !open && i.nextOpenLabel ? i.nextOpenLabel : null;
  const status = {
    open,
    label: open ? "Open now" : "Closed now",
    opensLabel,
    preorder: !open && !!i.preorderEnabled,
  };

  // ── Delivery ──
  const deliveryAvailable = !!i.deliveryEnabled;
  const zones = Array.isArray(i.deliveryZones) ? i.deliveryZones : [];
  const zoneAreas = zones
    .map((z) => (z && typeof z.name === "string" ? z.name.trim() : ""))
    .filter((n) => n.length > 0);
  const areas = zoneAreas.length ? zoneAreas : i.serviceAreas.filter((a) => a && a.trim().length > 0);

  let feeKnown = false;
  let feeLabel = DYNAMIC_FEE_COPY;
  if (deliveryAvailable) {
    if (zones.length > 0) {
      // per-zone pricing → dynamic, resolved at checkout
      feeKnown = false;
      feeLabel = DYNAMIC_FEE_COPY;
    } else if (i.deliveryFee > 0) {
      feeKnown = true;
      feeLabel = formatMoney(i.deliveryFee);
    } else {
      // 0 / unset → do NOT claim "free" (could be misleading); stay honest
      feeKnown = false;
      feeLabel = DYNAMIC_FEE_COPY;
    }
  }

  // ── Pickup (never advertise when disabled; only show a known location) ──
  const pickupAvailable = !!i.pickupEnabled;
  const loc = (i.pickupAddress ?? "").trim();
  const pickup = { available: pickupAvailable, location: pickupAvailable && loc ? loc : null };

  // ── Payments — superset of methods actually enabled (fulfillment-independent) ──
  const cashOffered =
    !!i.pickupEnabled || !!i.dineInEnabled || (!!i.deliveryEnabled && i.payOnDeliveryEnabled !== false);
  const payments: string[] = [];
  if (i.hidePrices) {
    if (cashOffered) payments.push("Cash");
  } else {
    if (i.onlinePaymentEnabled) payments.push("Pay online");
    if (cashOffered) payments.push("Cash");
    if (i.whatsappCheckoutEnabled) payments.push("WhatsApp order");
  }

  // ── Fulfillment label ──
  const modes: string[] = [];
  if (i.deliveryEnabled) modes.push("Delivery");
  if (i.pickupEnabled) modes.push("Pickup");
  if (i.dineInEnabled) modes.push("Dine-in");
  const fulfillmentLabel = modes.length ? modes.join(" · ") : "Ordering unavailable";

  return {
    status,
    delivery: { available: deliveryAvailable, feeKnown, feeLabel, areas },
    pickup,
    dineIn: !!i.dineInEnabled,
    payments,
    fulfillmentLabel,
  };
}
