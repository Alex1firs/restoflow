import type { SubscriptionInfo } from "@/lib/subscription";

type Props = {
  subscription: SubscriptionInfo;
};

function fmt(date: Date) {
  return date.toLocaleDateString("en-NG", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function SubscriptionBanner({ subscription }: Props) {
  const { planName, monthlyPrice, status, endDate, daysRemaining } = subscription;
  const price = `₦${monthlyPrice.toLocaleString()}/mo`;

  if (status === "expired") {
    return (
      <div className="bg-red-50 border-b border-red-200 px-4 py-3">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="bg-red-600 text-white text-[10px] font-black uppercase px-2 py-1 rounded shrink-0">
              Subscription Expired
            </span>
            <p className="text-sm font-medium text-red-800">
              Your <strong>{planName}</strong> subscription expired
              {endDate ? ` on ${fmt(endDate)}` : ""}.{" "}
              <strong>Customers cannot place orders.</strong> Renew to restore service.
            </p>
          </div>
          <span className="text-sm font-black text-red-600 shrink-0">{price}</span>
        </div>
      </div>
    );
  }

  if (status === "trialing") {
    const timeLeft =
      daysRemaining !== null
        ? daysRemaining === 1
          ? "1 day remaining"
          : `${daysRemaining} days remaining`
        : endDate
        ? `ends ${fmt(endDate)}`
        : "";

    return (
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="bg-amber-500 text-white text-[10px] font-black uppercase px-2 py-1 rounded shrink-0">
              Trial
            </span>
            <p className="text-sm font-medium text-amber-800">
              <strong>{planName}</strong> plan — {timeLeft}
            </p>
          </div>
          <span className="text-sm font-black text-amber-600 shrink-0">{price}</span>
        </div>
      </div>
    );
  }

  // Active — subtle info strip
  return (
    <div className="bg-white border-b border-gray-100 px-4 py-2">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="bg-green-100 text-green-700 text-[10px] font-black uppercase px-2 py-1 rounded">
            Active
          </span>
          <p className="text-xs font-medium text-gray-500">
            <strong className="text-gray-700">{planName}</strong>
            {endDate ? ` · Renews ${fmt(endDate)}` : ""}
          </p>
        </div>
        <span className="text-xs font-medium text-gray-400">{price}</span>
      </div>
    </div>
  );
}
