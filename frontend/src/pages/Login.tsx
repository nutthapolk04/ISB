import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import {
  LogIn,
  UtensilsCrossed,
  Store,
  GraduationCap,
  Users,
  UserPlus,
  UserX,
  Wallet as WalletIcon,
  Sparkles,
  ArrowLeftRight,
  ShieldCheck,
  MessageSquare,
  ChevronLeft,
} from "lucide-react";

type SsoStep = "email" | "otp" | "pdpa" | null;

const MOCK_OTP = "247831";

const GoogleLogo = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

// Demo accounts highlighted for the wallet feature: each entry pre-fills the
// login form so demo viewers can jump straight into the relevant flow.
interface DemoAccount {
  username: string;
  password: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string; // e.g. "ParentDashboard + กระเป๋าของฉัน"
  highlight?: boolean; // featured for wallet demo
}

const WALLET_DEMO_ACCOUNTS: DemoAccount[] = [
  {
    username: "somchair",
    password: "parent",
    label: "Somchai RAKDEE (ผู้ปกครอง 3 ลูก)",
    description: "กระเป๋าของฉัน + กระเป๋าลูก 3 คน — โอนในครอบครัวทุกทิศทาง",
    icon: Users,
    badge: "Parent · Family Transfer",
    highlight: true,
  },
  {
    username: "85001",
    password: "parent",
    label: "John Wick (ผู้ปกครอง 1 ลูก)",
    description: "กระเป๋าของฉัน + ลูก 1 คน — เติมเงินบัตร PromptPay/Credit",
    icon: Users,
    badge: "Parent · Topup Demo",
    highlight: true,
  },
  {
    username: "cashier_canteen_thai",
    password: "cashier",
    label: "Cashier (Thai Kitchen)",
    description: "POS โรงอาหาร + กระเป๋าของฉัน ฿500 — ชำระเงินตัวเองที่ register",
    icon: UtensilsCrossed,
    badge: "Staff · POS Spending",
    highlight: true,
  },
  {
    username: "manager_canteen",
    password: "manager",
    label: "Manager (Canteen)",
    description: "กระเป๋าของฉัน ฿1,500 — Manager dashboard + เติม/ใช้กระเป๋า",
    icon: WalletIcon,
    badge: "Staff · Own Wallet",
    highlight: true,
  },
  {
    username: "kitchen_canteen_thai",
    password: "kitchen",
    label: "Kitchen (Thai Kitchen)",
    description: "Role ใหม่ — กระเป๋าของฉัน ฿300",
    icon: UtensilsCrossed,
    badge: "Staff · Kitchen Role",
  },
];

const Login = () => {
  const { login, loginWithMockSSO, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  // Google SSO multi-step state
  const [ssoStep, setSsoStep] = useState<SsoStep>(null);
  const [googleEmail, setGoogleEmail] = useState("");
  const [otpValue, setOtpValue] = useState("");
  const [otpError, setOtpError] = useState(false);

  useEffect(() => {
    if (isAuthenticated) navigate("/", { replace: true });
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError("Please enter username and password");
      return;
    }
    setLoading(true);
    setError("");
    const result = await login(username.trim(), password);
    setLoading(false);
    if (result.success) {
      navigate("/", { replace: true });
    } else {
      setError(result.error ?? "Login failed");
    }
  };

  const handleQuickLogin = async (acct: DemoAccount) => {
    setUsername(acct.username);
    setPassword(acct.password);
    setError("");
    setLoading(true);
    const result = await login(acct.username, acct.password);
    setLoading(false);
    if (result.success) {
      navigate("/", { replace: true });
    } else {
      setError(result.error ?? "Login failed");
    }
  };

  const handleGoogleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!googleEmail.trim()) return;
    setOtpValue("");
    setOtpError(false);
    setSsoStep("otp");
  };

  const handleOtpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (otpValue === MOCK_OTP) {
      setSsoStep("pdpa");
    } else {
      setOtpError(true);
    }
  };

  const handlePdpaAccept = async () => {
    setSsoLoading(true);
    setError("");
    const result = await loginWithMockSSO(googleEmail.trim());
    setSsoLoading(false);
    if (result.success) {
      navigate("/", { replace: true });
    } else {
      setError(result.error ?? "SSO login failed");
      setSsoStep(null);
    }
  };

  const resetSso = () => {
    setSsoStep(null);
    setGoogleEmail("");
    setOtpValue("");
    setOtpError(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <img
            src="/isb-logo.svg"
            alt="ISB"
            className="h-16 w-16 rounded-xl object-contain"
          />
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight">Schooney</h1>
            <p className="text-sm text-muted-foreground">
              ISB Cooperative Payment System
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign In</CardTitle>
            <CardDescription>
              Enter your credentials to access the system
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  autoFocus
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading || ssoLoading}>
                <LogIn className="mr-2 h-4 w-4" />
                {loading ? "Signing in…" : "Sign In"}
              </Button>
            </form>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">or</span>
              </div>
            </div>

            {/* Google SSO — multi-step flow */}
            {ssoStep === null && (
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                onClick={() => { setSsoStep("email"); setGoogleEmail(""); setError(""); }}
                disabled={loading || ssoLoading}
              >
                <GoogleLogo />
                Sign in with Google (Mock)
              </Button>
            )}

            {/* Step 1: Email */}
            {ssoStep === "email" && (
              <form onSubmit={handleGoogleEmailSubmit} className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-blue-900">
                    <GoogleLogo />
                    Sign in with Google
                  </div>
                  <button type="button" onClick={resetSso} className="text-muted-foreground hover:text-foreground">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                </div>
                <p className="text-xs text-blue-700/80">Enter your ISB Google email</p>
                <Input
                  type="email"
                  autoFocus
                  placeholder="your@isb.ac.th"
                  value={googleEmail}
                  onChange={(e) => setGoogleEmail(e.target.value)}
                  className="bg-white"
                />
                <Button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={!googleEmail.trim()}
                >
                  Next
                </Button>
              </form>
            )}

            {/* Step 2: OTP */}
            {ssoStep === "otp" && (
              <form onSubmit={handleOtpSubmit} className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-blue-900">
                    <MessageSquare className="h-4 w-4" />
                    2-Step Verification
                  </div>
                  <button type="button" onClick={() => setSsoStep("email")} className="text-muted-foreground hover:text-foreground">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                </div>
                <p className="text-xs text-blue-700/80">
                  Google sent an OTP code to <span className="font-medium">{googleEmail}</span>
                </p>
                <div className="rounded-md bg-blue-100/80 border border-blue-200 px-3 py-2 text-xs text-blue-800">
                  <span className="font-medium">Demo OTP:</span>{" "}
                  <span className="font-mono tracking-widest font-bold">{MOCK_OTP}</span>
                </div>
                <div className="flex justify-center">
                  <InputOTP
                    maxLength={6}
                    pattern={REGEXP_ONLY_DIGITS}
                    value={otpValue}
                    onChange={(v) => { setOtpValue(v); setOtpError(false); }}
                    autoFocus
                  >
                    <InputOTPGroup>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <InputOTPSlot key={i} index={i} />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                {otpError && (
                  <p className="text-xs text-destructive text-center">Invalid OTP code. Please try again.</p>
                )}
                <Button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={otpValue.length < 6}
                >
                  Verify
                </Button>
              </form>
            )}

            {/* Step 3: PDPA Consent */}
            {ssoStep === "pdpa" && (
              <div className="rounded-lg border border-green-200 bg-green-50/50 p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-green-900">
                  <ShieldCheck className="h-4 w-4" />
                  Privacy Policy (PDPA)
                </div>
                <div className="rounded-md bg-white border border-green-100 p-3 max-h-48 overflow-y-auto text-xs text-foreground/80 space-y-2 leading-relaxed">
                  <p className="font-semibold text-foreground">Collection and Use of Personal Data</p>
                  <p>International School Bangkok (ISB) collects your personal data for the following purposes:</p>
                  <ul className="list-disc pl-4 space-y-1">
                    <li>Administration of the payment and e-wallet system (Schooney)</li>
                    <li>Tracking and managing student spending at canteens and the cooperative store</li>
                    <li>Notifying and reporting spending activity to parents</li>
                    <li>Complying with legal requirements and school regulations</li>
                  </ul>
                  <p className="font-semibold text-foreground">Data Collected</p>
                  <p>Full name, email, photo, student ID, transaction history, and device information.</p>
                  <p className="font-semibold text-foreground">Data Disclosure</p>
                  <p>ISB will not disclose your personal data to third parties except as required by law.</p>
                  <p className="font-semibold text-foreground">Data Subject Rights</p>
                  <p>You have the right to access, rectify, erase, and object to the processing of your personal data under the Personal Data Protection Act B.E. 2562 (PDPA).</p>
                  <p>Contact DPO: <span className="font-mono">privacy@isb.ac.th</span></p>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  By clicking "Accept", you acknowledge that you have read and consent to ISB collecting and using your personal data under the policy above.
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={resetSso}
                    disabled={ssoLoading}
                  >
                    Decline
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                    onClick={handlePdpaAccept}
                    disabled={ssoLoading}
                  >
                    <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
                    {ssoLoading ? "Signing in…" : "Accept & Sign In"}
                  </Button>
                </div>
              </div>
            )}

            {/* Featured wallet demo accounts — click to log in directly */}
            <div className="mt-4 rounded-md border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-3 space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                <Sparkles className="h-3.5 w-3.5" />
                เดโม่ฟีเจอร์ใหม่ — กระเป๋าของฉัน + POS spending
              </div>
              <div className="grid gap-1.5">
                {WALLET_DEMO_ACCOUNTS.filter((a) => a.highlight).map((acct) => {
                  const Icon = acct.icon;
                  return (
                    <button
                      key={acct.username}
                      type="button"
                      onClick={() => handleQuickLogin(acct)}
                      disabled={loading || ssoLoading}
                      className="group flex items-start gap-2 rounded-md border border-amber-200 bg-white/60 p-2 text-left transition hover:border-amber-400 hover:bg-amber-100/50 disabled:opacity-50"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-900">
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-semibold text-foreground truncate">
                            {acct.label}
                          </span>
                          {acct.badge && (
                            <Badge
                              variant="secondary"
                              className="h-4 bg-amber-100 px-1.5 text-[9px] font-medium text-amber-900"
                            >
                              {acct.badge}
                            </Badge>
                          )}
                        </div>
                        <p className="text-[11px] leading-tight text-muted-foreground line-clamp-2">
                          {acct.description}
                        </p>
                        <p className="mt-0.5 text-[10px] font-mono text-muted-foreground/80">
                          {acct.username} · {acct.password}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="flex items-start gap-1 text-[10px] text-amber-900/80">
                <ArrowLeftRight className="h-3 w-3 shrink-0 mt-0.5" />
                คลิกเพื่อเข้าระบบทันที — ทดลอง topup, family transfer และจ่ายเงินที่ POS ด้วยกระเป๋าตัวเอง
              </p>
            </div>

            <div className="mt-3 rounded-md bg-muted p-3 text-xs text-muted-foreground space-y-1.5 max-h-72 overflow-y-auto">
              <p className="font-medium text-foreground">บัญชีอื่นๆ (Reference)</p>
              <p><code className="font-mono">admin</code> / <code className="font-mono">admin1234</code> — Full access (กระเป๋าของฉัน ฿2,000)</p>

              <p className="pt-1 font-medium text-foreground flex items-center gap-1.5">
                <UtensilsCrossed className="h-3.5 w-3.5" />
                Canteens (password: <code>cashier</code> / <code>manager</code> · กระเป๋าของฉัน ฿500/฿1,500)
              </p>
              <p><code className="font-mono">cashier_canteen_thai</code> — Thai Kitchen (7 เมนู)</p>
              <p><code className="font-mono">cashier_canteen_drinks</code> — Drinks & Snacks (8 เมนู)</p>
              <p><code className="font-mono">cashier_canteen</code> — ISB Canteen (20 เมนู)</p>
              <p><code className="font-mono">kitchen_canteen_thai</code> — Kitchen role · pwd <code>kitchen</code> · กระเป๋า ฿300</p>

              <p className="pt-1 font-medium text-foreground flex items-center gap-1.5">
                <Store className="h-3.5 w-3.5" />
                Retail shops (password: <code>cashier</code> / <code>manager</code> · กระเป๋าของฉัน ฿500/฿1,500)
              </p>
              <p><code className="font-mono">cashier_coop</code> — Coop Shop (FIFO, เบิก dept ได้)</p>
              <p><code className="font-mono">cashier_sports</code> — Sports Shop (FIFO)</p>
              <p><code className="font-mono">cashier_book</code> — Bookstore (FIFO)</p>
              <p className="italic opacity-80">(แทน <code>cashier_</code> ด้วย <code>manager_</code> สำหรับ manager role)</p>

              <p className="pt-1 font-medium text-foreground flex items-center gap-1.5">
                <GraduationCap className="h-3.5 w-3.5" />
                Staff-Parents — มีลูก (pwd <code>parent</code> · กระเป๋าของฉัน ฿800)
              </p>
              <p><code className="font-mono">somchair</code> — Somchai RAKDEE + ลูก 3 คน</p>
              <p><code className="font-mono">prasitj</code> — Prasit JAIDEE (แต่งกับ Wanida) + ลูก 2 คน</p>
              <p><code className="font-mono">wanidaj</code> — Wanida JAIDEE (แต่งกับ Prasit)</p>
              <p><code className="font-mono">porntips</code> — Pornthip SUWAN (partner Kritsada) + ลูก 2 คน</p>

              <p className="pt-1 font-medium text-foreground flex items-center gap-1.5">
                <GraduationCap className="h-3.5 w-3.5" />
                Staff ทั่วไป (password: <code>parent</code>)
              </p>
              <p><code className="font-mono">jirawatj</code>, <code className="font-mono">phatthab</code>, <code className="font-mono">angkanan</code>, <code className="font-mono">chadb</code></p>
              <p><code className="font-mono">narino</code>, <code className="font-mono">tua</code>, <code className="font-mono">suttinel</code>, <code className="font-mono">thitaphp</code></p>

              <p className="pt-1 font-medium text-foreground flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                Parents (pwd <code>parent</code> · กระเป๋าของฉัน ฿1,000)
              </p>
              <p><code className="font-mono">85001</code> — John Wick + ลูก 1 คน (คู่กับ <code className="font-mono">85002</code> Kate)</p>
              <p><code className="font-mono">85003</code> — Brad Pitt + ลูก 1 คน</p>
              <p><code className="font-mono">70652</code> — Kritsada SUWAN (partner Pornthip staff)</p>
              <p><code className="font-mono">70699</code> — Malee RAKDEE (partner Somchai staff)</p>

              <p className="pt-1 font-medium text-foreground flex items-center gap-1.5">
                <UserPlus className="h-3.5 w-3.5" />
                Others — parent ยังไม่ผูกกับลูก (password: <code>parent</code>)
              </p>
              <p><code className="font-mono">74706@parents.isb.ac.th</code> — Coralys CEDO</p>
              <p><code className="font-mono">74704@parents.isb.ac.th</code> — Jungho HEO</p>

              <p className="pt-1 font-medium text-foreground flex items-center gap-1.5">
                <UserX className="h-3.5 w-3.5" />
                Visitor / Customer (ไม่มี login — ใช้บัตรเท่านั้น)
              </p>
              <p>Visitor: <code className="font-mono">VI046876</code>, <code className="font-mono">VI045994</code>, <code className="font-mono">VI046022</code></p>
              <p>Orphan Student (ไม่มี family_code): <code className="font-mono">24062</code>, <code className="font-mono">24060</code>, <code className="font-mono">24059</code></p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Login;
