import { notFound } from "next/navigation";
import { guestView } from "@/lib/connect/guest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Connect guest page: pay, then track, on one link.
 *
 * ── Who this is for ──────────────────────────────────────────────────────────
 * Somebody who ordered from a restaurant on WhatsApp and has never heard of
 * RestoFlow. They have no account and should not need one to pay a delivery fee
 * or to see where their food is. The token in the URL is the whole credential,
 * which is why the projection behind it returns so little.
 *
 * ── Branding ─────────────────────────────────────────────────────────────────
 * The restaurant is who they trust, so the restaurant is the headline.
 * RestoFlow is named plainly underneath, because a payment page that does not
 * say who is taking the money is a payment page nobody should use. Dispatcher
 * appears nowhere: it is infrastructure, and the customer has no relationship
 * with it.
 */
export default async function ConnectGuestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { id } = await params;
  const { t } = await searchParams;

  // No token, wrong token and no such delivery are one answer, so the id space
  // cannot be probed.
  const view = await guestView(id, (t ?? "").trim());
  if (!view) return notFound();

  const naira = (minor: number) =>
    "₦" + (minor / 100).toLocaleString("en-NG", { maximumFractionDigits: 0 });

  return (
    <main style={{
      minHeight: "100vh", background: "#f6f7f9", display: "flex", justifyContent: "center",
      padding: "24px 16px", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      color: "#111827",
    }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <section style={{
          background: "#fff", borderRadius: 16, padding: 24,
          boxShadow: "0 1px 3px rgba(0,0,0,.08)",
        }}>
          <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
            {view.restaurant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={view.restaurant.logoUrl} alt="" width={44} height={44}
                style={{ borderRadius: 10, objectFit: "cover" }} />
            ) : null}
            <div>
              <div style={{ fontSize: 17, fontWeight: 650, lineHeight: 1.25 }}>
                {view.paid ? "Delivery for" : "Pay delivery for"}
              </div>
              <div style={{ fontSize: 17, fontWeight: 650, lineHeight: 1.25 }}>
                {view.restaurant.name}
              </div>
            </div>
          </header>

          <dl style={{ margin: 0, fontSize: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid #eef0f3" }}>
              <dt style={{ color: "#6b7280" }}>Delivering to</dt>
              <dd style={{ margin: 0, textAlign: "right", maxWidth: "60%" }}>{view.destination}</dd>
            </div>
            {view.amountMinor != null && (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid #eef0f3" }}>
                <dt style={{ color: "#6b7280" }}>Delivery fee</dt>
                <dd style={{ margin: 0, fontWeight: 650 }}>{naira(view.amountMinor)}</dd>
              </div>
            )}
          </dl>

          {!view.paid && view.checkoutUrl && (
            <a href={view.checkoutUrl} style={{
              display: "block", marginTop: 20, padding: "14px 16px", borderRadius: 12,
              background: "#111827", color: "#fff", textAlign: "center", fontWeight: 650,
              textDecoration: "none",
            }}>
              Pay {view.amountMinor != null ? naira(view.amountMinor) : ""}
            </a>
          )}

          {view.paid && !view.tracking && (
            <p style={{ marginTop: 20, padding: 14, background: "#ecfdf5", borderRadius: 12, fontSize: 14 }}>
              Payment received. We&apos;re finding you a courier.
            </p>
          )}

          {view.tracking && (
            <div style={{ marginTop: 20, padding: 16, background: "#f3f4f6", borderRadius: 12 }}>
              <div style={{ fontWeight: 650, fontSize: 15 }}>{view.tracking.headline}</div>
              {view.tracking.detail && (
                <div style={{ color: "#4b5563", fontSize: 14, marginTop: 4 }}>{view.tracking.detail}</div>
              )}
              {view.tracking.etaMins != null && (
                <div style={{ color: "#4b5563", fontSize: 14, marginTop: 8 }}>
                  Arriving in about {view.tracking.etaMins} minutes
                </div>
              )}
              {view.tracking.receivingCode && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #e5e7eb" }}>
                  <div style={{ color: "#6b7280", fontSize: 12, textTransform: "uppercase", letterSpacing: ".04em" }}>
                    Give this code to your courier
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: ".12em", marginTop: 4 }}>
                    {view.tracking.receivingCode}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        <p style={{ textAlign: "center", color: "#6b7280", fontSize: 12, marginTop: 16 }}>
          Delivery powered by RestoFlow
        </p>
      </div>
    </main>
  );
}
