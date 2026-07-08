/**
 * Mock Krungsri Payment Gateway Dialog
 * Simulates KPG (Krungsri Payment Gateway) for prototype purposes.
 * Not connected to a real payment processor.
 */
import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shield, Lock, CheckCircle2, Loader2, CreditCard, AlertCircle } from "lucide-react";
import { formatCurrency as formatTHB } from "@/lib/format";

interface Props {
  open: boolean;
  amount: number;
  fee: number;
  onSuccess: () => void;
  onCancel: () => void;
}

type Step = "card" | "otp" | "processing" | "success";

const MOCK_OTP = "123456";

function formatCardNumber(v: string) {
  return v.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
}

function formatExpiry(v: string) {
  const digits = v.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? digits.slice(0, 2) + "/" + digits.slice(2) : digits;
}


export function KrungsriGatewayDialog({ open, amount, fee, onSuccess, onCancel }: Props) {
  const [step, setStep] = useState<Step>("card");
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [nameOnCard, setNameOnCard] = useState("");
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState(false);
  const [countdown, setCountdown] = useState(60);

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep("card");
      setCardNumber("");
      setExpiry("");
      setCvv("");
      setNameOnCard("");
      setOtp("");
      setOtpError(false);
      setCountdown(60);
    }
  }, [open]);

  // OTP countdown
  useEffect(() => {
    if (step !== "otp") return;
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [step, countdown]);

  const cardValid =
    cardNumber.replace(/\s/g, "").length === 16 &&
    expiry.length === 5 &&
    cvv.length >= 3 &&
    nameOnCard.trim().length >= 2;

  const handlePayNow = () => {
    setStep("otp");
    setCountdown(60);
  };

  const handleConfirmOtp = () => {
    if (otp !== MOCK_OTP) {
      setOtpError(true);
      setOtp("");
      return;
    }
    setOtpError(false);
    setStep("processing");
    setTimeout(() => {
      setStep("success");
      setTimeout(() => onSuccess(), 1500);
    }, 2000);
  };

  const total = amount + fee;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && step !== "processing" && step !== "success") onCancel(); }}>
      <DialogContent className="p-0 overflow-hidden max-w-sm sm:max-w-md border-0 shadow-2xl [&>button]:hidden">

        {/* Header — Krungsri branding */}
        <div className="bg-[#1a1a2e] px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Krungsri logo mark */}
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f5c518]">
              <span className="text-[#1a1a2e] font-black text-base leading-none">K</span>
            </div>
            <div>
              <p className="text-white font-bold text-sm leading-tight">Krungsri Bank</p>
              <p className="text-[#f5c518] text-[10px] leading-tight">Secure Payment Gateway</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[#a0aec0] text-xs">
            <Lock className="h-3 w-3" />
            <span>SSL Secured</span>
          </div>
        </div>

        {/* Amount bar */}
        <div className="bg-[#f5c518]/10 border-b border-[#f5c518]/30 px-5 py-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">ISB Co-op Wallet Top-up</span>
            <div className="text-right">
              <p className="font-bold text-base tabular-nums">{formatTHB(total)}</p>
              {fee > 0 && (
                <p className="text-[10px] text-muted-foreground tabular-nums">
                  incl. {formatTHB(fee)} fee
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="px-5 pb-5 pt-4">
          {/* ── STEP: Card form ── */}
          {step === "card" && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Card Details
              </p>

              {/* Card preview */}
              <div className="relative h-20 rounded-xl bg-gradient-to-br from-[#1a1a2e] to-[#2d2d4a] px-4 py-3 mb-1 overflow-hidden">
                <div className="absolute top-2 right-3 opacity-30 text-white text-4xl font-bold">◆◆</div>
                <div className="flex flex-col justify-between h-full">
                  <div className="flex items-center gap-1.5">
                    <div className="w-7 h-5 rounded bg-[#f5c518]/80" />
                    <span className="text-white/60 text-[10px]">Visa / Mastercard</span>
                  </div>
                  <p className="text-white font-mono text-sm tracking-widest">
                    {cardNumber || "•••• •••• •••• ••••"}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Card Number</Label>
                <Input
                  value={cardNumber}
                  onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                  placeholder="0000 0000 0000 0000"
                  className="font-mono tracking-widest h-10 text-sm"
                  maxLength={19}
                  inputMode="numeric"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Expiry Date</Label>
                  <Input
                    value={expiry}
                    onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                    placeholder="MM/YY"
                    className="font-mono h-10 text-sm"
                    maxLength={5}
                    inputMode="numeric"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">CVV</Label>
                  <Input
                    value={cvv}
                    onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    placeholder="•••"
                    type="password"
                    className="font-mono h-10 text-sm"
                    maxLength={4}
                    inputMode="numeric"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Name on Card</Label>
                <Input
                  value={nameOnCard}
                  onChange={(e) => setNameOnCard(e.target.value.toUpperCase())}
                  placeholder="FULL NAME"
                  className="font-mono uppercase h-10 text-sm"
                />
              </div>

              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground pt-1">
                <Shield className="h-3 w-3 text-green-500 shrink-0" />
                <span>3D Secure • Your card data is encrypted and never stored.</span>
              </div>

              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1 h-10" onClick={onCancel}>
                  Cancel
                </Button>
                <Button
                  className="flex-1 h-10 bg-[#f5c518] hover:bg-[#e0b415] text-[#1a1a2e] font-bold"
                  disabled={!cardValid}
                  onClick={handlePayNow}
                >
                  <CreditCard className="h-4 w-4 mr-1.5" />
                  Pay {formatTHB(total)}
                </Button>
              </div>
            </div>
          )}

          {/* ── STEP: OTP / 3D Secure ── */}
          {step === "otp" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-lg bg-blue-50 border border-blue-200 p-3">
                <Shield className="h-8 w-8 text-blue-600 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-blue-900">Verified by Krungsri</p>
                  <p className="text-xs text-blue-700">3D Secure authentication</p>
                </div>
              </div>

              <div className="text-center space-y-1">
                <p className="text-sm text-muted-foreground">OTP sent to</p>
                <p className="font-semibold">••••••6789</p>
                <p className="text-xs text-muted-foreground">
                  Expires in{" "}
                  <span className={countdown <= 10 ? "text-destructive font-semibold" : ""}>
                    {countdown}s
                  </span>
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">One-Time Password (OTP)</Label>
                <Input
                  value={otp}
                  onChange={(e) => {
                    setOtpError(false);
                    setOtp(e.target.value.replace(/\D/g, "").slice(0, 6));
                  }}
                  placeholder="Enter 6-digit OTP"
                  className={`font-mono text-center text-xl tracking-[0.5em] h-12 ${otpError ? "border-destructive" : ""}`}
                  maxLength={6}
                  inputMode="numeric"
                />
                {otpError && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> Incorrect OTP. Try again. (hint: {MOCK_OTP})
                  </p>
                )}
              </div>

              <p className="text-[10px] text-center text-muted-foreground">
                Didn't receive?{" "}
                <button
                  className="text-[#1a3a8a] underline disabled:opacity-50"
                  disabled={countdown > 0}
                  onClick={() => setCountdown(60)}
                >
                  Resend OTP
                </button>
              </p>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 h-10" onClick={() => setStep("card")}>
                  Back
                </Button>
                <Button
                  className="flex-1 h-10 bg-[#f5c518] hover:bg-[#e0b415] text-[#1a1a2e] font-bold"
                  disabled={otp.length !== 6 || countdown <= 0}
                  onClick={handleConfirmOtp}
                >
                  Confirm
                </Button>
              </div>
            </div>
          )}

          {/* ── STEP: Processing ── */}
          {step === "processing" && (
            <div className="py-8 flex flex-col items-center gap-4 text-center">
              <Loader2 className="h-12 w-12 animate-spin text-[#f5c518]" />
              <div>
                <p className="font-semibold">Processing Payment</p>
                <p className="text-sm text-muted-foreground">Please do not close this window…</p>
              </div>
            </div>
          )}

          {/* ── STEP: Success ── */}
          {step === "success" && (
            <div className="py-8 flex flex-col items-center gap-4 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                <CheckCircle2 className="h-9 w-9 text-green-600" />
              </div>
              <div>
                <p className="font-bold text-lg text-green-700">Payment Successful</p>
                <p className="text-sm text-muted-foreground">{formatTHB(total)} charged</p>
                <p className="text-xs text-muted-foreground mt-1">Returning to wallet…</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-muted/40 border-t px-5 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Lock className="h-3 w-3" />
            <span>256-bit SSL encryption</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-muted-foreground font-medium border rounded px-1 py-0.5">VISA</span>
            <span className="text-[9px] text-muted-foreground font-medium border rounded px-1 py-0.5">MC</span>
            <span className="text-[9px] text-muted-foreground font-medium border rounded px-1 py-0.5">JCB</span>
          </div>
        </div>

      </DialogContent>
    </Dialog>
  );
}
