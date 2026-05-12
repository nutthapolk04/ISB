import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LogIn,
  Mail,
  UtensilsCrossed,
  Store,
  GraduationCap,
  Users,
  UserPlus,
  UserX,
  Wallet as WalletIcon,
  Sparkles,
  ArrowLeftRight,
  CreditCard,
} from "lucide-react";

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

  const handleMockSSO = async () => {
    const email = window.prompt(
      "Enter your ISB email (mock SSO — auto-creates a parent account)",
      "parent@isbd.th",
    );
    if (!email) return;
    setSsoLoading(true);
    setError("");
    const result = await loginWithMockSSO(email.trim());
    setSsoLoading(false);
    if (result.success) {
      navigate("/", { replace: true });
    } else {
      setError(result.error ?? "SSO login failed");
    }
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

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleMockSSO}
              disabled={loading || ssoLoading}
            >
              <Mail className="mr-2 h-4 w-4" />
              {ssoLoading ? "Redirecting…" : "Login with ISB Microsoft (Mock)"}
            </Button>

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
