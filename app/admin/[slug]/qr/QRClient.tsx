"use client";

import { useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";

type Props = {
  slug: string;
  restaurantName: string;
  appUrl: string;
};

export default function QRClient({ slug, restaurantName, appUrl }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const publicUrl = `${appUrl}/r/${slug}`;

  function handleDownload() {
    const canvas = canvasRef.current?.querySelector("canvas");
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}-qr-code.png`;
    a.click();
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-black text-gray-900">QR Code</h1>
        <p className="text-gray-500 font-medium mt-1">
          Print this and place it on your tables. Customers scan to order.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-8 flex flex-col items-center gap-6">
        {/* QR Code */}
        <div ref={canvasRef} className="p-4 bg-white rounded-xl border-2 border-gray-100">
          <QRCodeCanvas
            value={publicUrl}
            size={220}
            bgColor="#ffffff"
            fgColor="#111111"
            level="H"
            marginSize={2}
          />
        </div>

        <div className="text-center">
          <p className="font-black text-gray-900 text-lg">{restaurantName}</p>
          <p className="text-sm text-gray-400 mt-1">Scan to browse menu &amp; order</p>
        </div>

        {/* Public URL */}
        <div className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-sm text-gray-500 font-mono truncate">{publicUrl}</span>
          <button
            onClick={handleCopy}
            className="text-xs font-bold text-orange-600 hover:text-orange-700 shrink-0 transition"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>

        {/* Actions */}
        <div className="flex gap-3 w-full">
          <button
            onClick={handleDownload}
            className="flex-1 bg-gray-900 hover:bg-black text-white font-black text-sm py-3 rounded-xl transition"
          >
            Download PNG
          </button>
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 border border-gray-200 hover:border-gray-400 text-gray-700 font-black text-sm py-3 rounded-xl transition text-center"
          >
            Preview Store →
          </a>
        </div>
      </div>

      {/* Instructions */}
      <div className="mt-6 bg-white border border-gray-200 rounded-2xl p-6">
        <h2 className="text-sm font-black text-gray-900 uppercase tracking-tight mb-4">How to use</h2>
        <ol className="space-y-3">
          {[
            "Download the QR code image above",
            "Print it at A5 or A4 size — use a cardstock or laminate for tables",
            "Place one QR code on each table",
            "Customers scan it with their phone camera — no app needed",
            "They browse your menu and place an order directly",
          ].map((step, i) => (
            <li key={step} className="flex items-start gap-3 text-sm text-gray-600">
              <span className="w-5 h-5 rounded-full bg-orange-100 text-orange-600 text-xs font-black flex items-center justify-center shrink-0 mt-0.5">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
