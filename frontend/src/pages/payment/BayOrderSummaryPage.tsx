import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { readBayIntent, clearBayIntent } from "@/pages/payment/MockBayGateway";

function KrungsriBirdLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Krungsri Bank"
    >
      {/* Left wings — three feather curves sweeping up-left */}
      <path d="M32 28 C28 22,18 18,6 14 C10 20,18 24,26 27Z" fill="#f5a200" />
      <path d="M32 28 C26 18,14 10,2 8 C8 16,18 22,28 26Z" fill="#f5a200" opacity="0.85" />
      <path d="M32 28 C24 14,10 4,0 4 C6 12,16 20,28 25Z" fill="#f5a200" opacity="0.65" />
      {/* Right wings */}
      <path d="M32 28 C36 22,46 18,58 14 C54 20,46 24,38 27Z" fill="#f5a200" />
      <path d="M32 28 C38 18,50 10,62 8 C56 16,46 22,36 26Z" fill="#f5a200" opacity="0.85" />
      <path d="M32 28 C40 14,54 4,64 4 C58 12,48 20,36 25Z" fill="#f5a200" opacity="0.65" />
      {/* Central body */}
      <ellipse cx="32" cy="28" rx="4" ry="5.5" fill="#f5a200" />
      {/* Head */}
      <circle cx="32" cy="21" r="3.5" fill="#f5a200" />
      {/* Tail feathers */}
      <path d="M29 33 C29 38,27 42,26 46" stroke="#f5a200" strokeWidth="2" strokeLinecap="round" />
      <path d="M32 34 C32 39,32 43,32 47" stroke="#f5a200" strokeWidth="2" strokeLinecap="round" />
      <path d="M35 33 C35 38,37 42,38 46" stroke="#f5a200" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const fmtTHB = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(n);

export default function BayOrderSummaryPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const orderRef = params.get("ref");
  const intent = readBayIntent(orderRef);

  useEffect(() => {
    if (!orderRef || !intent) {
      navigate("/", { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!intent) return null;

  const merchantName = intent.merchantName ?? "ISB SCHOOL SHOP";
  const productName  = intent.productName  ?? "Wallet Top-up";
  const total        = intent.amount + intent.fee;

  const handleCancel = () => {
    clearBayIntent(intent.orderRef);
    navigate(intent.returnUrl, { replace: true });
  };

  const handleProceedToCard = () => {
    navigate(`/payment/bay/form?ref=${encodeURIComponent(intent.orderRef)}`);
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* ── Bank header bar ── */}
        <div className="bg-[#1a1200] rounded-t-xl px-5 py-3 flex items-center gap-3">
          <KrungsriBirdLogo className="h-12 w-12 shrink-0" />
          <div>
            <p className="text-white font-bold text-sm leading-tight">Krungsri Bank</p>
            <p className="text-[#f5a200] text-[11px] leading-tight tracking-wide">
              BAY EASYPay · UAT
            </p>
          </div>
        </div>

        {/* Gold stripe */}
        <div className="h-[5px] bg-amber-400 w-full" />

        {/* ── Receipt card body ── */}
        <div className="bg-white border-l-4 border-l-amber-400 px-5 pt-5 pb-3 shadow-md">
          <h2 className="text-lg font-bold text-gray-800 mb-5">Order Summary</h2>

          {/* Merchant Ref */}
          <div className="flex items-start justify-between gap-3 mb-3 text-sm">
            <span className="text-gray-500 whitespace-nowrap shrink-0">Merchant Ref.</span>
            <span className="font-mono font-bold text-gray-800 text-right break-all">
              {intent.orderRef}
            </span>
          </div>

          {/* Merchant name */}
          <p className="text-sm text-gray-600 mb-1">{merchantName}</p>

          {/* Product name */}
          <p className="text-sm font-bold text-gray-800 mb-5">{productName}</p>

          {/* Divider */}
          <hr className="border-dashed border-gray-200 mb-4" />

          {/* Total amount */}
          <div className="text-right mb-2">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Total Amount</p>
            <p className="text-3xl font-extrabold text-gray-900 tabular-nums">
              {fmtTHB(total)}
            </p>
            {intent.fee > 0 && (
              <p className="text-[11px] text-gray-400 tabular-nums mt-0.5">
                incl. {fmtTHB(intent.fee)} processing fee
              </p>
            )}
          </div>
        </div>

        {/* ── Zigzag / scalloped bottom of receipt ──
             Two offset radial gradients create semicircle "bites" from the top edge.
             Fill color #f3f4f6 matches bg-gray-100 so bites appear to cut into the white card.
        */}
        <div
          className="h-5 w-full"
          style={{
            background: `
              radial-gradient(circle at 10px 0px, #f3f4f6 10px, white 10px) 0px 0px / 20px 20px repeat-x,
              radial-gradient(circle at 0px  0px, #f3f4f6 10px, white 10px) 10px 0px / 20px 20px repeat-x
            `,
          }}
        />

        {/* ── Actions ── */}
        <div className="mt-5 flex flex-col items-center gap-3">
          <button
            onClick={handleProceedToCard}
            className="w-full rounded-xl bg-amber-400 hover:bg-amber-500 text-gray-900 font-bold py-3 text-sm transition-colors shadow-sm"
          >
            Pay with Card
          </button>
          <button
            onClick={handleCancel}
            className="text-sm text-amber-600 hover:text-amber-800 hover:underline underline-offset-2 transition-colors"
          >
            Cancel
          </button>
        </div>

      </div>
    </div>
  );
}
