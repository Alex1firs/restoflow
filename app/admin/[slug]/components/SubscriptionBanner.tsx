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
  const { planName, monthlyPrice, status, endDate, graceEndsAt, daysRemaining, graceDaysRemaining } = subscription;
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
              <strong>All operations are paused.</strong> Renew now to restore service.
            </p>
          </div>
          <a
            href="payment"
            className="text-sm font-black text-red-600 underline underline-offset-2 shrink-0 hover:text-red-700"
          >
            Renew — {price}
          </a>
        </div>
      </div>
    );
  }

  if (status === "grace_period") {
    const graceLeft =
      graceDaysRemaining !== null
        ? graceDaysRemaining === 1
          ? "1 day left"
          : `${graceDaysRemaining} days left`
        : graceEndsAt
        ? `until ${fmt(graceEndsAt)}`
        : "";

    return (
      <div className="bg-orange-50 border-b border-orange-300 px-4 py-3">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="bg-orange-600 text-white text-[10px] font-black uppercase px-2 py-1 rounded shrink-0">
              Grace Period
            </span>
            <p className="text-sm font-medium text-orange-900">
              <strong>{planName}</strong> subscription ended.{" "}
              <strong>Grace period — {graceLeft}.</strong> Renew immediately to avoid service interruption.
            </p>
          </div>
          <a
            href="payment"
            className="text-sm font-black text-orange-700 underline underline-offset-2 shrink-0 hover:text-orange-800"
          >
            Renew — {price}
          </a>
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
              Free Trial
            </span>
            <p className="text-sm font-medium text-amber-800">
              <strong>{planName}</strong> — {timeLeft}
            </p>
          </div>
          <a
            href="payment"
            className="text-sm font-black text-amber-600 underline underline-offset-2 shrink-0 hover:text-amber-700"
          >
            Subscribe — {price}
          </a>
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
