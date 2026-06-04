/**
 * QR awaiting scan — 60:40 split. Items list on the left so the customer
 * can verify the order while their phone reads the QR on the right.
 * Optional countdown when the backend returns an expiry timestamp.
 */
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import type { DisplayItem } from "@/hooks/useDisplayBroadcast";

interface Props {
  items: DisplayItem[];
  total: number;
  qrPayload: string;
  expiresAt: number | null;
}

function useCountdown(expiresAt: number | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (expiresAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);
  if (expiresAt === null) return null;
  const seconds = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function QRScreen({ items, total, qrPayload, expiresAt }: Props) {
  const countdown = useCountdown(expiresAt);
  const expired = countdown === "0:00";

  return (
    <div className="h-screen w-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 flex">
      {/* Left: items (60%) */}
      <section className="basis-[60%] flex flex-col px-10 py-8 border-r border-amber-100">
        <h2 className="text-3xl font-bold text-zinc-900 mb-1">Your Order</h2>
        <p className="text-sm text-zinc-500 mb-6">
          Please verify the items below
        </p>

        <div className="flex-1 overflow-y-auto bg-white rounded-2xl border border-amber-100 shadow-sm">
          <table className="w-full">
            <tbody>
              {items.map((item, idx) => (
                <tr
                  key={`${idx}-${item.name}`}
                  className="border-b border-amber-50 last:border-0"
                >
                  <td className="px-5 py-3 text-base font-medium text-zinc-900">
                    {item.name}
                  </td>
                  <td className="px-3 py-3 text-center text-zinc-600 w-16 tabular-nums">
                    ×{item.qty}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums text-zinc-900 w-28">
                    ฿
                    {item.price.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex items-baseline justify-between bg-amber-500 text-white rounded-xl px-6 py-4">
          <span className="text-xl font-medium">Total</span>
          <span className="text-4xl font-extrabold tabular-nums">
            ฿
            {total.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
      </section>

      {/* Right: QR (40%) */}
      <section className="basis-[40%] flex flex-col items-center justify-center px-10">
        <h1 className="text-4xl font-extrabold text-zinc-900">Scan to Pay</h1>
        <p className="mt-2 text-base text-zinc-500 text-center">
          Open your banking app and scan the QR code below
        </p>

        <div className="mt-8 bg-white rounded-2xl shadow-md p-6 border-2 border-amber-200">
          <QRCodeSVG
            value={qrPayload}
            size={320}
            level="M"
            includeMargin={false}
          />
        </div>

        <div className="mt-6 text-5xl font-extrabold tabular-nums text-zinc-900">
          ฿
          {total.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </div>

        {countdown !== null && (
          <div
            className={
              "mt-4 text-base font-medium " +
              (expired ? "text-red-600" : "text-zinc-500")
            }
          >
            {expired ? "QR code expired" : `Expires in ${countdown}`}
          </div>
        )}
      </section>
    </div>
  );
}
