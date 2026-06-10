import { useState, useEffect, useRef } from "react";
import { useGoogleLogin } from "@react-oauth/google";
import { useTranslation } from "react-i18next";
import { API_BASE_URL } from "@/lib/constants";
import { toast } from "@/components/ui/sonner";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

type SsoStep = "pdpa" | null;

// Mirror of App.tsx — the Google SSO button only appears when this is set,
// even though the OAuth provider always mounts (with a placeholder) so that
// the page never crashes when the env var is missing on a fresh deploy.
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";

const GoogleLogo = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

interface DemoAccount {
  username: string;
  password: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  highlight?: boolean;
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
];

// ── Carousel slides for reference accounts ──────────────────────────────────
interface RefSlide {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string; // tailwind bg class for icon bg
  rows: { label: string; user: string; pwd: string; note?: string }[];
  footer?: string;
}

const REF_SLIDES: RefSlide[] = [
  {
    id: "admin",
    title: "Admin",
    icon: ShieldCheck,
    color: "bg-violet-100 text-violet-700",
    rows: [{ label: "Full access", user: "admin", pwd: "admin1234", note: "กระเป๋าของฉัน ฿2,000" }],
  },
  {
    id: "canteen",
    title: "Canteen",
    icon: UtensilsCrossed,
    color: "bg-orange-100 text-orange-700",
    rows: [
      { label: "Thai Kitchen", user: "cashier_canteen_thai", pwd: "cashier / manager" },
      { label: "Drinks & Snacks", user: "cashier_canteen_drinks", pwd: "cashier / manager" },
      { label: "ISB Canteen", user: "cashier_canteen", pwd: "cashier / manager" },
      { label: "Kitchen role", user: "kitchen_canteen_thai", pwd: "kitchen", note: "฿300" },
    ],
    footer: "กระเป๋าของฉัน ฿500 (cashier) / ฿1,500 (manager)",
  },
  {
    id: "store",
    title: "Stores",
    icon: Store,
    color: "bg-blue-100 text-blue-700",
    rows: [
      { label: "Coop Shop", user: "cashier_coop", pwd: "cashier / manager", note: "FIFO + dept" },
      { label: "Sports Shop", user: "cashier_sports", pwd: "cashier / manager", note: "FIFO" },
      { label: "Bookstore", user: "cashier_book", pwd: "cashier / manager", note: "FIFO" },
    ],
    footer: "กระเป๋าของฉัน ฿500 (cashier) / ฿1,500 (manager)",
  },
  {
    id: "parents",
    title: "Parents",
    icon: Users,
    color: "bg-green-100 text-green-700",
    rows: [
      { label: "John Wick", user: "85001", pwd: "parent", note: "ลูก 1 คน" },
      { label: "Brad Pitt", user: "85003", pwd: "parent", note: "ลูก 1 คน" },
      { label: "Kritsada SUWAN", user: "70652", pwd: "parent" },
      { label: "Malee RAKDEE", user: "70699", pwd: "parent" },
    ],
    footer: "กระเป๋าของฉัน ฿1,000",
  },
  {
    id: "staff",
    title: "Staff-Parents",
    icon: GraduationCap,
    color: "bg-teal-100 text-teal-700",
    rows: [
      { label: "Somchai RAKDEE", user: "somchair", pwd: "parent", note: "ลูก 3 คน" },
      { label: "Prasit JAIDEE", user: "prasitj", pwd: "parent", note: "ลูก 2 คน" },
      { label: "Wanida JAIDEE", user: "wanidaj", pwd: "parent" },
      { label: "Pornthip SUWAN", user: "porntips", pwd: "parent", note: "ลูก 2 คน" },
    ],
    footer: "กระเป๋าของฉัน ฿800",
  },
  {
    id: "others",
    title: "Others",
    icon: UserPlus,
    color: "bg-slate-100 text-slate-600",
    rows: [
      { label: "Coralys CEDO", user: "74706@parents.isb.ac.th", pwd: "parent", note: "ยังไม่ผูกลูก" },
      { label: "Jungho HEO", user: "74704@parents.isb.ac.th", pwd: "parent", note: "ยังไม่ผูกลูก" },
    ],
    footer: "Visitor: VI046876, VI045994, VI046022 (ไม่มี login)",
  },
];

// ── Credential Carousel ──────────────────────────────────────────────────────
function CredentialCarousel() {
  const [idx, setIdx] = useState(0);
  const slide = REF_SLIDES[idx];
  const Icon = slide.icon;

  return (
    <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-2">
      {/* Header + nav */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`flex h-5 w-5 items-center justify-center rounded ${slide.color}`}>
            <Icon className="h-3 w-3" />
          </span>
          <span className="font-semibold text-foreground">{slide.title}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setIdx((i) => (i - 1 + REF_SLIDES.length) % REF_SLIDES.length)}
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          {/* Dot indicators */}
          <div className="flex gap-0.5">
            {REF_SLIDES.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIdx(i)}
                className={`h-1.5 rounded-full transition-all ${
                  i === idx ? "w-3 bg-primary" : "w-1.5 bg-muted-foreground/30"
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => setIdx((i) => (i + 1) % REF_SLIDES.length)}
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Rows */}
      <div className="space-y-1">
        {slide.rows.map((row) => (
          <div key={row.user} className="grid grid-cols-[auto_1fr_auto] gap-x-2 items-baseline">
            <span className="text-muted-foreground truncate max-w-[80px]">{row.label}</span>
            <code className="font-mono text-[10px] text-foreground truncate">{row.user}</code>
            <span className="flex items-center gap-1 whitespace-nowrap">
              <code className="font-mono text-[10px] text-muted-foreground">{row.pwd}</code>
              {row.note && (
                <span className="text-[9px] text-muted-foreground/70 hidden sm:inline">· {row.note}</span>
              )}
            </span>
          </div>
        ))}
      </div>

      {slide.footer && (
        <p className="text-[10px] text-muted-foreground/70 border-t pt-1.5 mt-1">{slide.footer}</p>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
const Login = () => {
  const { t } = useTranslation();
  const { login, loginWithGoogle, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [ssoStep, setSsoStep] = useState<SsoStep>(null);
  const [pendingGoogleToken, setPendingGoogleToken] = useState("");
  const [coverBg, setCoverBg] = useState("/login-bg.png");
  const fetchedCover = useRef(false);

  useEffect(() => {
    if (isAuthenticated) navigate("/", { replace: true });
  }, [isAuthenticated, navigate]);

  // Fetch cover image from public settings (no auth needed)
  useEffect(() => {
    if (fetchedCover.current) return;
    fetchedCover.current = true;
    fetch(`${API_BASE_URL}/admin/settings/public`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.school_cover_url) setCoverBg(d.school_cover_url); })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) { setError("Please enter username and password"); return; }
    setLoading(true); setError("");
    const result = await login(username.trim(), password);
    setLoading(false);
    if (result.success) navigate("/", { replace: true });
    else setError(result.error ?? "Login failed");
  };

  const handleQuickLogin = async (acct: DemoAccount) => {
    setUsername(acct.username); setPassword(acct.password); setError("");
    setLoading(true);
    const result = await login(acct.username, acct.password);
    setLoading(false);
    if (result.success) navigate("/", { replace: true });
    else setError(result.error ?? "Login failed");
  };

  const handlePdpaAccept = async () => {
    setSsoLoading(true); setError("");
    const result = await loginWithGoogle(pendingGoogleToken);
    setSsoLoading(false);
    if (result.success) {
      navigate("/", { replace: true });
    } else {
      toast.error(result.error ?? "Google login failed", {
        description: "This Google account is not registered. Contact your school administrator.",
        duration: 6000,
      });
      setSsoStep(null);
      setPendingGoogleToken("");
    }
  };

  const resetSso = () => { setSsoStep(null); setPendingGoogleToken(""); };

  const googleLogin = useGoogleLogin({
    onSuccess: (tokenResponse) => {
      setPendingGoogleToken(tokenResponse.access_token);
      setSsoStep("pdpa");
      setError("");
    },
    onError: () => {
      toast.error("Google sign-in failed. Please try again.");
    },
  });

  return (
    <div className="flex min-h-screen">
      {/* ── Left panel: background illustration ── */}
      <div
        className="hidden lg:block lg:w-1/2 xl:w-3/5 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url('${coverBg}')` }}
        aria-hidden="true"
      />

      {/* ── Right panel: login form ── */}
      <div className="flex w-full lg:w-1/2 xl:w-2/5 items-center justify-center bg-background p-6 overflow-y-auto">
        <div className="w-full max-w-sm space-y-6">
          {/* Logo + title */}
          <div className="flex flex-col items-center gap-3">
            <img src="/isb-logo.svg" alt="ISB" className="h-16 w-16 rounded-xl object-contain" />
            <div className="text-center">
              <h1 className="text-2xl font-bold tracking-tight">Schooney</h1>
              <p className="text-sm text-muted-foreground">ISB Cooperative Payment System</p>
            </div>
          </div>

          {/* Sign-in card */}
          <Card>
            <CardHeader>
              <CardTitle>Sign In</CardTitle>
              <CardDescription>Enter your credentials to access the system</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username" autoFocus autoComplete="username"
                    value={username} onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter username"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <PasswordInput
                    id="password" autoComplete="current-password"
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading || ssoLoading}>
                  <LogIn className="mr-2 h-4 w-4" />
                  {loading ? "Signing in…" : "Sign In"}
                </Button>
              </form>

              {/* Google SSO — only shown when VITE_GOOGLE_CLIENT_ID is
                  configured. The provider in App.tsx mounts unconditionally
                  with a placeholder when the env is missing so the page
                  doesn't crash, but we hide the button here because clicking
                  it would fail against the placeholder. */}
              {GOOGLE_CLIENT_ID && (
                <>
                  <div className="relative my-4">
                    <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-background px-2 text-muted-foreground">or</span>
                    </div>
                  </div>

                  {ssoStep === null && (
                    <Button type="button" variant="outline" className="w-full gap-2"
                      onClick={() => googleLogin()}
                      disabled={loading || ssoLoading}>
                      <GoogleLogo />
                      Sign in with Google
                    </Button>
                  )}
                </>
              )}

              {/* PDPA step */}
              {ssoStep === "pdpa" && (
                <div className="rounded-lg border border-green-200 bg-green-50/50 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-green-900">
                    <ShieldCheck className="h-4 w-4" /> Privacy Policy (PDPA)
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
                    <Button type="button" variant="outline" size="sm" className="flex-1" onClick={resetSso} disabled={ssoLoading}>
                      Decline
                    </Button>
                    <Button type="button" size="sm" className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                      onClick={handlePdpaAccept} disabled={ssoLoading}>
                      <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
                      {ssoLoading ? "Signing in…" : "Accept & Sign In"}
                    </Button>
                  </div>
                </div>
              )}

              {/* ── Quick-login cards ── */}
              <div className="mt-4 rounded-md border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-3 space-y-2.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                  <Sparkles className="h-3.5 w-3.5" />
                  {t("login.demoBanner", "Demo accounts — Personal Wallet + POS spending")}
                </div>
                <div className="grid gap-1.5">
                  {WALLET_DEMO_ACCOUNTS.filter((a) => a.highlight).map((acct) => {
                    const Icon = acct.icon;
                    return (
                      <button key={acct.username} type="button" onClick={() => handleQuickLogin(acct)}
                        disabled={loading || ssoLoading}
                        className="group flex items-start gap-2 rounded-md border border-amber-200 bg-white/60 p-2 text-left transition hover:border-amber-400 hover:bg-amber-100/50 disabled:opacity-50">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-900">
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-semibold text-foreground truncate">{acct.label}</span>
                            {acct.badge && (
                              <Badge variant="secondary" className="h-4 bg-amber-100 px-1.5 text-[9px] font-medium text-amber-900">
                                {acct.badge}
                              </Badge>
                            )}
                          </div>
                          <p className="text-[11px] leading-tight text-muted-foreground line-clamp-2">{acct.description}</p>
                          <p className="mt-0.5 text-[10px] font-mono text-muted-foreground/80">{acct.username} · {acct.password}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="flex items-start gap-1 text-[10px] text-amber-900/80">
                  <ArrowLeftRight className="h-3 w-3 shrink-0 mt-0.5" />
                  {t("login.demoHint", "Click to log in instantly — try top-up, family transfer, and pay at POS from your own wallet")}
                </p>
              </div>

              {/* ── Reference account carousel ── */}
              <div className="mt-3">
                <p className="mb-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  {t("login.otherAccounts", "Other accounts (Reference)")}
                </p>
                <CredentialCarousel />
              </div>
            </CardContent>
          </Card>
        </div>
      </div> {/* right panel */}
    </div>
  );
};

export default Login;
