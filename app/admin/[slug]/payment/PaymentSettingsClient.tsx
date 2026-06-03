"use client";

import { useState, useEffect } from "react";

type Bank = { name: string; code: string };

type CurrentSettings = {
  bankName: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  subaccountCode: string;
};

export default function PaymentSettingsClient({ current }: { current: CurrentSettings }) {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [banksLoading, setBanksLoading] = useState(true);

  const [bankCode, setBankCode] = useState(current.bankCode);
  const [bankName, setBankName] = useState(current.bankName);
  const [accountNumber, setAccountNumber] = useState(current.accountNumber);
  const [accountName, setAccountName] = useState(current.accountName);

  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [subaccountCode, setSubaccountCode] = useState(current.subaccountCode);

  useEffect(() => {
    fetch("/api/admin/payment-settings/banks")
      .then((r) => r.json())
      .then(({ banks: list }) => setBanks(list ?? []))
      .finally(() => setBanksLoading(false));
  }, []);

  async function resolveAccount() {
    if (!accountNumber.trim() || !bankCode) return;
    setResolving(true);
    setResolveError("");
    setAccountName("");

    const res = await fetch(
      `/api/admin/payment-settings/resolve?accountNumber=${encodeURIComponent(accountNumber.trim())}&bankCode=${encodeURIComponent(bankCode)}`
    );
    const data = await res.json();

    if (!res.ok) {
      setResolveError(data.error ?? "Could not verify account.");
    } else {
      setAccountName(data.accountName);
    }
    setResolving(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!bankCode || !bankName || !accountNumber.trim() || !accountName.trim()) {
      setSaveError("Please fill in all fields and verify your account number.");
      return;
    }

    setSaving(true);
    setSaveError("");
    setSaveSuccess(false);

    const res = await fetch("/api/admin/payment-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bankName, bankCode, accountNumber: accountNumber.trim(), accountName: accountName.trim() }),
    });

    const data = await res.json();
    if (!res.ok) {
      setSaveError(data.error ?? "Failed to save payment settings.");
    } else {
      setSubaccountCode(data.subaccountCode);
      setSaveSuccess(true);
    }
    setSaving(false);
  }

  return (
    <div className="space-y-6">
      <div className="mb-8">
        <h1 className="text-2xl font-black text-gray-900">Payment Settings</h1>
        <p className="text-gray-500 font-medium mt-1">
          Connect your bank account to receive online payments directly from customers.
        </p>
      </div>

      {/* Contextual help */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-start gap-3 mb-6">
        <svg className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-xs text-blue-700 font-medium leading-relaxed">
          Add your bank/payment details so online payments can be settled correctly to your account. Customers can still pay on delivery without this, but online payment unlocks more orders.
        </p>
      </div>

      {/* Status */}
      {subaccountCode ? (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-5 mb-8 flex items-start gap-4">
          <div className="w-9 h-9 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <p className="font-bold text-green-800 text-sm">Online payments active</p>
            <p className="text-green-600 text-xs mt-0.5">
              Customers can pay online. Funds go directly to your bank account.
            </p>
            <p className="font-mono text-xs text-green-700 mt-1.5 bg-green-100 px-2 py-1 rounded inline-block">
              {subaccountCode}
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-8 flex items-start gap-4">
          <div className="w-9 h-9 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="font-bold text-amber-800 text-sm">Online payments not set up</p>
            <p className="text-amber-600 text-xs mt-0.5">
              Add your bank details below to start accepting online payments. Customers can still pay on delivery.
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSave} className="bg-white border border-gray-200 rounded-2xl p-6 space-y-5">
        <h2 className="text-sm font-black text-gray-900 uppercase tracking-tight">Bank Details</h2>

        {/* Bank selector */}
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
            Bank Name
          </label>
          {banksLoading ? (
            <div className="h-11 bg-gray-100 rounded-xl animate-pulse" />
          ) : (
            <select
              value={bankCode}
              onChange={(e) => {
                const selected = banks.find((b) => b.code === e.target.value);
                setBankCode(e.target.value);
                setBankName(selected?.name ?? "");
                setAccountName("");
                setResolveError("");
              }}
              required
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:border-orange-500 transition bg-white"
            >
              <option value="">Select your bank</option>
              {banks.map((b) => (
                <option key={b.code} value={b.code}>{b.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Account Number + Resolve */}
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
            Account Number
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={10}
              value={accountNumber}
              onChange={(e) => {
                setAccountNumber(e.target.value.replace(/\D/g, ""));
                setAccountName("");
                setResolveError("");
              }}
              placeholder="0123456789"
              required
              className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:border-orange-500 transition"
            />
            <button
              type="button"
              onClick={resolveAccount}
              disabled={resolving || accountNumber.length !== 10 || !bankCode}
              className="px-4 py-3 bg-gray-900 hover:bg-black disabled:opacity-40 text-white text-xs font-black rounded-xl transition whitespace-nowrap"
            >
              {resolving ? "Verifying…" : "Verify"}
            </button>
          </div>
          {resolveError && (
            <p className="text-xs text-red-500 mt-1.5 font-medium">{resolveError}</p>
          )}
        </div>

        {/* Account Name */}
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
            Account Name
          </label>
          <input
            type="text"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            placeholder="Auto-filled after verification"
            required
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:border-orange-500 transition"
          />
          {accountName && !resolveError && (
            <p className="text-xs text-green-600 mt-1.5 font-medium flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              Account verified
            </p>
          )}
        </div>

        {saveError && (
          <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-xl px-4 py-3 font-medium">
            {saveError}
          </p>
        )}
        {saveSuccess && (
          <p className="text-sm text-green-600 bg-green-50 border border-green-200 rounded-xl px-4 py-3 font-medium">
            Payment account saved. Customers can now pay online!
          </p>
        )}

        <div className="pt-1">
          <button
            type="submit"
            disabled={saving}
            className="bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-black text-sm px-8 py-3 rounded-xl transition"
          >
            {saving ? "Saving…" : subaccountCode ? "Update Payment Account" : "Activate Online Payments"}
          </button>
        </div>

        <p className="text-xs text-gray-400 pt-1">
          Powered by Paystack. The platform takes no commission — 100% goes to your account minus Paystack&apos;s standard transaction fees.
        </p>
      </form>
    </div>
  );
}
