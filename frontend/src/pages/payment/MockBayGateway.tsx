/**
 * Mock BAY (Krungsri) EASYPay SPN — full-page redirect flow.
 *
 * Mirrors the real BAY EASYPay pattern documented in
 * `~/Downloads/bay_merchant_guide.md`:
 *
 *   WalletDetail → init topup intent → navigate /payment/bay/form?ref=...
 *      → user "pays" on mock hosted page
 *      → success → navigate /payment/bay/success?ref=...
 *      → success page confirms intent → returns to /parent/wallet/own
 *
 * Everything still runs inside the ISB domain so we can swap each step
 * out for the real PYMT Gateway calls without changing the UX shape.
 *
 * Pending intent metadata travels in sessionStorage keyed by `ref` so
 * the URL stays short and bookmark-safe.
 */
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CreditCard, Lock, Shield, ShieldCheck, Loader2, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

// ── Shared types + storage helpers ──────────────────────────────────────

export interface BayPendingIntent {
  /** The wallet topup ref_code returned by /wallets/{id}/topup — also our orderRef. */
  orderRef: string;
  walletId: number;
  amount: number;
  fee: number;
  /** Where the customer came from; we land them back there after success. */
  returnUrl: string;
}

const SS_KEY_PREFIX = "bay_intent_";

export function storeBayIntent(intent: BayPendingIntent) {
  sessionStorage.setItem(SS_KEY_PREFIX + intent.orderRef, JSON.stringify(intent));
}

function readBayIntent(orderRef: string | null): BayPendingIntent | null {
  if (!orderRef) return null;
  const raw = sessionStorage.getItem(SS_KEY_PREFIX + orderRef);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BayPendingIntent;
  } catch {
    return null;
  }
}

function clearBayIntent(orderRef: string) {
  sessionStorage.removeItem(SS_KEY_PREFIX + orderRef);
}

const fmtTHB = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(n);

// ── 1. BAY-style hosted form ────────────────────────────────────────────

function formatCardNumber(v: string) {
  return v.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
}
function formatExpiry(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? d.slice(0, 2) + "/" + d.slice(2) : d;
}

export function MockBayPaymentForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const orderRef = params.get("ref");
  const intent = readBayIntent(orderRef);

  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [nameOnCard, setNameOnCard] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // If someone lands here without a valid pending intent, push them out.
  useEffect(() => {
    if (!orderRef || !intent) {
      navigate("/", { replace: true });
    }
  }, [orderRef, intent, navigate]);

  if (!intent) return null;

  const total = intent.amount + intent.fee;

  const cardValid =
    cardNumber.replace(/\s/g, "").length === 16 &&
    expiry.length === 5 &&
    cvv.length >= 3 &&
    nameOnCard.trim().length >= 2;

  const handlePay = () => {
    if (!cardValid) return;
    setSubmitting(true);
    // Simulate the network/3DS round-trip. The real PYMT flow takes the
    // user to BAY's page, which then POSTs a datafeed back; here we just
    // pretend that succeeded and bounce to the success page which will
    // call /parent-confirm.
    setTimeout(() => {
      navigate(`/payment/bay/success?ref=${encodeURIComponent(orderRef!)}`);
    }, 1200);
  };

  const handleCancel = () => {
    navigate(`/payment/bay/cancel?ref=${encodeURIComponent(orderRef!)}`);
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-2xl overflow-hidden">
        {/* Bank header — looks like a real hosted page */}
        <div className="bg-[#1a1a2e] px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f5c518]">
              <span className="text-[#1a1a2e] font-black text-base leading-none">K</span>
            </div>
            <div>
              <p className="text-white font-bold text-sm leading-tight">Krungsri Bank</p>
              <p className="text-[#f5c518] text-[10px] leading-tight">Secure Payment Gateway · UAT</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[#a0aec0] text-xs">
            <Lock className="h-3 w-3" />
            <span>SSL Secured</span>
          </div>
        </div>

        {/* Amount summary */}
        <div className="bg-[#f5c518]/10 border-b border-[#f5c518]/30 px-5 py-3 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">ISB Co-op Wallet Top-up</span>
          <div className="text-right">
            <p className="font-bold text-base tabular-nums">{fmtTHB(total)}</p>
            {intent.fee > 0 && (
              <p className="text-[10px] text-muted-foreground tabular-nums">
                incl. {fmtTHB(intent.fee)} fee
              </p>
            )}
          </div>
        </div>

        {/* Form body */}
        <div className="px-5 py-5 space-y-4">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Card Details</p>

          {/* Card visual */}
          <div className="rounded-lg bg-gradient-to-br from-slate-900 to-slate-800 p-4 text-white">
            <div className="flex items-center justify-between">
              <div className="h-6 w-9 rounded bg-[#f5c518]" />
              <CreditCard className="h-4 w-4 opacity-70" />
            </div>
            <p className="font-mono tracking-wider mt-3 text-lg">
              {cardNumber || "0000 0000 0000 0000"}
            </p>
            <div className="flex justify-between text-xs mt-2 opacity-80">
              <span>{nameOnCard.toUpperCase() || "FULL NAME"}</span>
              <span>{expiry || "MM/YY"}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cn">Card Number</Label>
            <Input
              id="cn"
              value={cardNumber}
              onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
              placeholder="0000 0000 0000 0000"
              className="font-mono"
              autoComplete="cc-number"
              inputMode="numeric"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ex">Expiry Date</Label>
              <Input
                id="ex"
                value={expiry}
                onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                placeholder="MM/YY"
                className="font-mono"
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cv">CVV</Label>
              <Input
                id="cv"
                type="password"
                value={cvv}
                onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="•••"
                className="font-mono"
                inputMode="numeric"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nm">Name on Card</Label>
            <Input
              id="nm"
              value={nameOnCard}
              onChange={(e) => setNameOnCard(e.target.value)}
              placeholder="FULL NAME"
              className="uppercase"
              autoComplete="cc-name"
            />
          </div>

          <p className="flex items-center gap-1.5 text-xs text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5" />
            3D Secure · Your card data is encrypted and never stored.
          </p>

          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button variant="outline" onClick={handleCancel} disabled={submitting}>
              Cancel
            </Button>
            <Button
              onClick={handlePay}
              disabled={!cardValid || submitting}
              className="bg-[#f5c518] text-[#1a1a2e] hover:bg-[#e6b913] font-semibold"
            >
              {submitting ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Processing…</>
              ) : (
                <><CreditCard className="h-3.5 w-3.5 mr-1.5" />Pay {fmtTHB(total)}</>
              )}
            </Button>
          </div>
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t flex items-center justify-between text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Shield className="h-3 w-3" />
            <span>256-bit SSL encryption</span>
          </div>
          <div className="flex gap-1.5 font-semibold">
            <span className="px-1.5 py-0.5 border rounded">VISA</span>
            <span className="px-1.5 py-0.5 border rounded">MC</span>
            <span className="px-1.5 py-0.5 border rounded">JCB</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 2. Success landing — confirms the intent via existing API ───────────

export function MockBayPaymentSuccess() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const orderRef = params.get("ref");
  const intent = readBayIntent(orderRef);
  const [state, setState] = useState<"working" | "done" | "error">("working");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!orderRef || !intent) {
      navigate("/", { replace: true });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await api.post(`/wallets/topup/${intent.orderRef}/parent-confirm`, {});
        if (cancelled) return;
        clearBayIntent(intent.orderRef);
        setState("done");
        toast({
          title: "Top up successful",
          description: `Wallet credited ${fmtTHB(intent.amount)}`,
        });
        setTimeout(() => navigate(intent.returnUrl, { replace: true }), 1500);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.detail : "Could not confirm payment");
        setState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [orderRef, intent, navigate]);

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-xl overflow-hidden p-8 text-center space-y-4">
        {state === "working" && (
          <>
            <Loader2 className="h-10 w-10 mx-auto animate-spin text-amber-500" />
            <h2 className="text-xl font-semibold">Processing payment…</h2>
            <p className="text-sm text-muted-foreground">
              Confirming with the bank. Please don't close this window.
            </p>
          </>
        )}
        {state === "done" && (
          <>
            <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-500" />
            <h2 className="text-xl font-semibold">Payment successful</h2>
            <p className="text-sm text-muted-foreground">
              Redirecting you back to your wallet…
            </p>
          </>
        )}
        {state === "error" && (
          <>
            <AlertCircle className="h-12 w-12 mx-auto text-amber-500" />
            <h2 className="text-xl font-semibold">Confirmation failed</h2>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button onClick={() => navigate(intent?.returnUrl ?? "/", { replace: true })}>
              Back to wallet
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ── 3. Cancel landing ───────────────────────────────────────────────────

export function MockBayPaymentCancel() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const orderRef = params.get("ref");
  const intent = readBayIntent(orderRef);

  useEffect(() => {
    if (orderRef) clearBayIntent(orderRef);
  }, [orderRef]);

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-xl overflow-hidden p-8 text-center space-y-4">
        <XCircle className="h-12 w-12 mx-auto text-slate-400" />
        <h2 className="text-xl font-semibold">Payment cancelled</h2>
        <p className="text-sm text-muted-foreground">
          No charge was made. You can try again any time.
        </p>
        <Button onClick={() => navigate(intent?.returnUrl ?? "/", { replace: true })}>
          Back to wallet
        </Button>
      </div>
    </div>
  );
}
