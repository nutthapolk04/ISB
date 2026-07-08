import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { readBayIntent, clearBayIntent } from "@/pages/payment/MockBayGateway";
import { api } from "@/lib/api";

// Krungsri garuda — two fan-wings rising from a rounded base, on dark square
function KrungsriBirdLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg"
      className={className} aria-label="Krungsri">
      {/* Left fan wing — three feather layers */}
      <path d="M30 38 C26 30,14 22,4 18 C8 26,18 32,26 36Z" fill="#f5a200"/>
      <path d="M30 38 C22 26,10 16,2 12 C6 22,16 30,24 35Z" fill="#f5a200" opacity="0.80"/>
      <path d="M30 38 C20 22, 8 10, 0 8  C4 18,14 28,22 34Z" fill="#f5a200" opacity="0.55"/>
      {/* Right fan wing */}
      <path d="M30 38 C34 30,46 22,56 18 C52 26,42 32,34 36Z" fill="#f5a200"/>
      <path d="M30 38 C38 26,50 16,58 12 C54 22,44 30,36 35Z" fill="#f5a200" opacity="0.80"/>
      <path d="M30 38 C40 22,52 10,60 8  C56 18,46 28,38 34Z" fill="#f5a200" opacity="0.55"/>
      {/* Body */}
      <ellipse cx="30" cy="38" rx="5" ry="6" fill="#f5a200"/>
      {/* Head */}
      <circle cx="30" cy="30" r="4" fill="#f5a200"/>
      {/* Tail */}
      <path d="M27 44 C26 50,25 54,24 58" stroke="#f5a200" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M30 45 C30 51,30 55,30 59" stroke="#f5a200" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M33 44 C34 50,35 54,36 58" stroke="#f5a200" strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  );
}

// THB with ISO code prefix, matching the reference page style
const fmtTHB = (n: number) =>
  `THB ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;

export default function BayOrderSummaryPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const orderRef = params.get("ref");
  const intent = readBayIntent(orderRef);

  if (!intent) return <Navigate to="/" replace />;

  const merchantName = intent.merchantName ?? "ISB SCHOOL SHOP";
  const productName  = intent.productName  ?? "Wallet Top-up";
  const total        = intent.amount + intent.fee;

  const handleCancel = () => {
    clearBayIntent(intent.orderRef);
    api.post(`/wallets/topup/${intent.orderRef}/cancel`, {}).catch(() => {});
    navigate(intent.returnUrl, { replace: true });
  };

  const handleProceedToCard = () => {
    navigate(`/payment/bay/form?ref=${encodeURIComponent(intent.orderRef)}`);
  };

  return (
    /* Warm brownish page bg — matches real Krungsri gateway */
    <div className="min-h-screen" style={{ backgroundColor: "#b8864e" }}>
      {/* Constrain to mobile-payment width, centered on desktop */}
      <div className="mx-auto w-full" style={{ maxWidth: "420px" }}>

        {/* ── Logo box — square dark, top-left ── */}
        <div className="px-4 pt-5 pb-3">
          <div
            className="w-20 h-20 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: "#2d1600" }}
          >
            <KrungsriBirdLogo className="h-12 w-12" />
          </div>
        </div>

        {/* ── Thick amber/gold horizontal line — full container width ── */}
        <div className="h-[4px] bg-amber-400" />

        {/* ── White receipt card — full container width ── */}
        <div className="bg-white">

          {/* Section: heading */}
          <div className="px-5 pt-5 pb-4">
            <h2 className="text-xl font-bold text-gray-900">Order Summary</h2>
          </div>

          <hr className="border-gray-200 mx-5" />

          {/* Section: merchant ref */}
          <div className="px-5 py-4 flex items-start justify-between gap-4">
            <span className="text-sm text-gray-500 shrink-0">Merchant Ref.</span>
            <span className="text-sm font-bold text-gray-900 text-right font-mono break-all">
              {intent.orderRef}
            </span>
          </div>

          <hr className="border-gray-200 mx-5" />

          {/* Section: merchant name + product */}
          <div className="px-5 py-4">
            <p className="text-sm text-gray-600 mb-1">{merchantName}</p>
            <p className="text-sm font-bold text-gray-900">{productName}</p>
          </div>

          <hr className="border-gray-200 mx-5" />

          {/* Section: total amount */}
          <div className="px-5 py-5 text-right">
            <p className="text-xs text-gray-400 uppercase tracking-widest mb-1">Total Amount</p>
            <p className="text-4xl font-extrabold text-gray-900 tabular-nums tracking-tight">
              {fmtTHB(total)}
            </p>
            {intent.fee > 0 && (
              <p className="text-xs text-gray-400 mt-1 tabular-nums">
                incl. {fmtTHB(intent.fee)} processing fee
              </p>
            )}
          </div>
        </div>

        {/* ── Zigzag / scalloped receipt bottom — full container width ──
             Fill color matches page background so bites "cut into" the white card. */}
        <div
          className="h-5"
          style={{
            background: `
              radial-gradient(circle at 10px 0px, #b8864e 10px, white 10px) 0px 0px / 20px 20px repeat-x,
              radial-gradient(circle at 0px  0px, #b8864e 10px, white 10px) 10px 0px / 20px 20px repeat-x
            `,
          }}
        />

        {/* ── Actions ── */}
        <div className="px-5 mt-5 pb-8 flex flex-col items-center gap-3">
          <button
            onClick={handleProceedToCard}
            className="w-full rounded-xl font-bold py-3.5 text-sm transition-colors"
            style={{ backgroundColor: "#f5a200", color: "#1a1200" }}
          >
            Pay with Card
          </button>
          <button
            onClick={handleCancel}
            className="text-sm hover:underline underline-offset-2 transition-colors"
            style={{ color: "#f5a200" }}
          >
            Cancel
          </button>
        </div>

      </div>
    </div>
  );
}
