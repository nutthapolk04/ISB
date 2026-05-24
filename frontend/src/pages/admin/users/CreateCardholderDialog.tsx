import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  GraduationCap,
  Users as UsersIcon,
  UtensilsCrossed,
  Building2,
  UserCircle2,
} from "lucide-react";

type Kind = "student" | "parent" | "staff" | "department" | "other";

interface ShopOption {
  id: string;
  name: string;
  is_active: boolean;
  module: "canteen" | "store";
}

const SHOP_REQUIRED_ROLES = new Set(["cashier", "manager", "kitchen"]);
const NO_SHOP = "__none__";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: () => void;
}

const KINDS: { kind: Kind; label: string; icon: any; desc: string }[] = [
  { kind: "student",    label: "Student",    icon: GraduationCap,    desc: "นักเรียน — Customer + wallet + บัตร" },
  { kind: "parent",     label: "Parent",     icon: UsersIcon,        desc: "ผู้ปกครอง — User + personal wallet" },
  { kind: "staff",      label: "Staff",      icon: UtensilsCrossed,  desc: "พนักงาน — User + personal wallet (cashier/manager/kitchen)" },
  { kind: "department", label: "Department", icon: Building2,        desc: "แผนก — Department + wallet (เครดิตติดลบได้)" },
  { kind: "other",      label: "Other",      icon: UserCircle2,      desc: "Visitor / etc. — Customer (wallet optional)" },
];

export default function CreateCardholderDialog({ open, onOpenChange, onCreated }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<"pick" | "form">("pick");
  const [kind, setKind] = useState<Kind>("student");
  const [submitting, setSubmitting] = useState(false);

  // Common
  const [name, setName] = useState("");
  const [familyCode, setFamilyCode] = useState("");
  const [cardUid, setCardUid] = useState("");
  // Student
  const [customerCode, setCustomerCode] = useState("");
  const [grade, setGrade] = useState("");
  const [schoolType, setSchoolType] = useState("ES Student");
  const [initialBalance, setInitialBalance] = useState("0");
  // Parent / Staff
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [staffRole, setStaffRole] = useState("staff");
  const [shopId, setShopId] = useState("");
  const [shops, setShops] = useState<ShopOption[]>([]);
  const [shopsLoading, setShopsLoading] = useState(false);
  const [shopsError, setShopsError] = useState<string | null>(null);
  // Department
  const [deptCode, setDeptCode] = useState("");
  const [deptName, setDeptName] = useState("");
  const [initialCredit, setInitialCredit] = useState("0");
  // Other
  const [phone, setPhone] = useState("");
  const [withWallet, setWithWallet] = useState(false);

  const reset = () => {
    setStep("pick");
    setKind("student");
    setName(""); setFamilyCode(""); setCardUid("");
    setCustomerCode(""); setGrade("");
    setSchoolType("ES Student"); setInitialBalance("0");
    setUsername(""); setEmail(""); setPassword("");
    setStaffRole("staff"); setShopId("");
    setDeptCode(""); setDeptName(""); setInitialCredit("0");
    setPhone(""); setWithWallet(false);
  };

  const close = () => { onOpenChange(false); reset(); };

  // Fetch ALL shops (including inactive) once the dialog opens and the user is
  // on the staff form — we want the admin to see *something* even if every
  // shop happens to be flagged inactive. The dropdown sorts active first and
  // marks inactive shops so the admin can spot the mismatch and re-activate.
  //
  // NB: shopsLoading is intentionally NOT in the dep array. Including it caused
  // setShopsLoading(true) to retrigger the effect, which then cancelled its
  // own fetch via the cleanup function — leaving the dropdown stuck on
  // "Loading shops…" forever.
  useEffect(() => {
    if (!open || kind !== "staff" || step !== "form" || shops.length > 0) return;
    let cancelled = false;
    setShopsLoading(true);
    setShopsError(null);
    api
      .get<ShopOption[]>("/shops/?active_only=false")
      .then((data) => {
        if (cancelled) return;
        const sorted = [...(data ?? [])].sort((a, b) => {
          if (a.is_active === b.is_active) return a.name.localeCompare(b.name);
          return a.is_active ? -1 : 1;
        });
        setShops(sorted);
      })
      .catch((e) => {
        if (cancelled) return;
        setShopsError(e instanceof ApiError ? e.detail : "Failed to load shops");
      })
      .finally(() => { if (!cancelled) setShopsLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind, step, shops.length]);

  const shopRequired = kind === "staff" && SHOP_REQUIRED_ROLES.has(staffRole);
  const shopMissing = shopRequired && !shopId;

  const submit = async () => {
    if (shopMissing) {
      toast({
        title: t("cardholders.create_.failed"),
        description: `Role "${staffRole}" requires a shop`,
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, any> = { kind };
      if (kind === "student") {
        const trimmed = customerCode.trim();
        const isPrefixed = trimmed.toUpperCase().startsWith("PS-");
        const stripped = isPrefixed ? trimmed.slice(3) : trimmed;
        const finalCustomerCode = isPrefixed ? `PS-${stripped}` : `PS-${trimmed}`;
        Object.assign(body, {
          name,
          customer_code: finalCustomerCode,
          student_code: stripped || null,
          grade: grade || null, school_type: schoolType,
          family_code: familyCode || null, card_uid: cardUid || null,
          initial_balance: parseFloat(initialBalance) || 0,
        });
      } else if (kind === "parent" || kind === "staff") {
        Object.assign(body, {
          name, username, email: email || null, password,
          family_code: familyCode || null, card_uid: cardUid || null,
        });
        if (kind === "staff") {
          body.role = staffRole;
          body.shop_id = shopId || null;
        }
      } else if (kind === "department") {
        Object.assign(body, {
          department_code: deptCode, department_name: deptName,
          initial_credit: parseFloat(initialCredit) || 0,
        });
      } else if (kind === "other") {
        Object.assign(body, {
          name, customer_code: customerCode || null,
          email: email || null, phone: phone || null,
          card_uid: cardUid || null, with_wallet: withWallet,
        });
      }
      await api.post("/admin/cardholders", body);
      toast({
        title: t("cardholders.create_.success"),
        description: t("cardholders.create_.successDesc", { kind }),
      });
      onCreated?.();
      close();
    } catch (e) {
      toast({
        title: t("cardholders.create_.failed"),
        description: e instanceof ApiError ? e.detail : t("shopUsers.errorGeneric"),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); else onOpenChange(true); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("cardholders.create_.title")}</DialogTitle>
          <DialogDescription>
            {step === "pick"
              ? t("cardholders.create_.subtitlePick")
              : t("cardholders.create_.subtitleForm", { kind })}
          </DialogDescription>
        </DialogHeader>

        {step === "pick" && (
          <div className="grid grid-cols-1 gap-2">
            {KINDS.map(({ kind: k, label, icon: Icon, desc }) => (
              <button
                key={k}
                type="button"
                onClick={() => { setKind(k); setStep("form"); }}
                className="flex items-start gap-3 rounded-md border p-3 text-left hover:border-primary hover:bg-primary/5 transition"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{label}</div>
                  <div className="text-xs text-muted-foreground">{desc}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {step === "form" && (
          <div className="space-y-3">
            {kind === "student" && (
              <>
                <Field label="ชื่อ-นามสกุล *"><Input value={name} onChange={e => setName(e.target.value)} /></Field>
                <Field label="Student code (Customer code) *"><Input value={customerCode} onChange={e => setCustomerCode(e.target.value)} placeholder="85001" /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Grade"><Input value={grade} onChange={e => setGrade(e.target.value)} placeholder="04" /></Field>
                  <Field label="School type">
                    <Select value={schoolType} onValueChange={setSchoolType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ES Student">ES Student</SelectItem>
                        <SelectItem value="MS Student">MS Student</SelectItem>
                        <SelectItem value="HS Student">HS Student</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <Field label="Family code"><Input value={familyCode} onChange={e => setFamilyCode(e.target.value)} /></Field>
                <Field label="Card UID"><Input value={cardUid} onChange={e => setCardUid(e.target.value)} placeholder="MIFARE hex" /></Field>
                <Field label="Initial balance (THB)"><Input type="number" value={initialBalance} onChange={e => setInitialBalance(e.target.value)} /></Field>
              </>
            )}

            {(kind === "parent" || kind === "staff") && (
              <>
                <Field label="ชื่อ-นามสกุล *"><Input value={name} onChange={e => setName(e.target.value)} /></Field>
                <Field label="Username *"><Input value={username} onChange={e => setUsername(e.target.value)} /></Field>
                <Field label="Email"><Input value={email} onChange={e => setEmail(e.target.value)} /></Field>
                <Field label="Password *"><Input type="password" value={password} onChange={e => setPassword(e.target.value)} /></Field>
                {kind === "staff" && (
                  <>
                    <Field label="Role *">
                      <Select
                        value={staffRole}
                        onValueChange={(v) => {
                          setStaffRole(v);
                          // Clear any leftover shop selection when switching to
                          // a role that should not be linked to a shop.
                          if (!SHOP_REQUIRED_ROLES.has(v)) setShopId("");
                        }}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cashier">Cashier</SelectItem>
                          <SelectItem value="manager">Manager</SelectItem>
                          <SelectItem value="kitchen">Kitchen</SelectItem>
                          <SelectItem value="staff">Staff (general)</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    {/* Shop dropdown only matters for roles that operate within a
                        single shop (cashier / manager / kitchen). General staff
                        users — teachers and office staff — never bind to a shop,
                        so we hide the picker entirely to keep the form tidy. */}
                    {shopRequired && (
                      <Field label="Shop *">
                        <Select
                          // Always keep value defined (NO_SHOP sentinel when
                          // nothing chosen) so the Select stays controlled and
                          // does not throw the React controlled→uncontrolled
                          // warning on role changes.
                          value={shopId === "" ? NO_SHOP : shopId}
                          onValueChange={(v) => setShopId(v === NO_SHOP ? "" : v)}
                          disabled={shopsLoading}
                        >
                          <SelectTrigger className={shopMissing ? "border-destructive" : ""}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_SHOP} disabled>
                              {shopsLoading
                                ? "Loading shops…"
                                : shopsError
                                ? `Failed to load: ${shopsError}`
                                : shops.length === 0
                                ? "No shops available — pick one below"
                                : "Select a shop"}
                            </SelectItem>
                            {shops.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name} ({s.module}){!s.is_active && " — inactive"}
                              </SelectItem>
                            ))}
                            {shops.length === 0 && !shopsLoading && (
                              <div className="px-2 py-3 text-xs text-muted-foreground text-center space-y-2">
                                <p>
                                  {shopsError
                                    ? `Failed to load: ${shopsError}`
                                    : "No shops returned by the API"}
                                </p>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    setShops([]);
                                    setShopsError(null);
                                  }}
                                  className="text-xs font-semibold text-primary underline"
                                >
                                  Try again
                                </button>
                              </div>
                            )}
                          </SelectContent>
                        </Select>
                        {shopMissing && (
                          <p className="text-xs text-destructive">
                            Role "{staffRole}" must be linked to a shop
                          </p>
                        )}
                        {shopsError && !shopMissing && (
                          <p className="text-xs text-destructive">
                            Could not load shops: {shopsError}
                          </p>
                        )}
                        {!shopsLoading && !shopsError && shops.length === 0 && (
                          <p className="text-xs text-amber-600">
                            ยังไม่มี shop ในระบบ — ไปสร้างที่ Shop Management ก่อน
                          </p>
                        )}
                      </Field>
                    )}
                  </>
                )}
                <Field label="Family code"><Input value={familyCode} onChange={e => setFamilyCode(e.target.value)} /></Field>
                <Field label="Card UID"><Input value={cardUid} onChange={e => setCardUid(e.target.value)} /></Field>
              </>
            )}

            {kind === "department" && (
              <>
                <Field label="Department code *"><Input value={deptCode} onChange={e => setDeptCode(e.target.value)} placeholder="DEPT-XXX" /></Field>
                <Field label="Department name *"><Input value={deptName} onChange={e => setDeptName(e.target.value)} /></Field>
                <Field label="Initial credit (THB)"><Input type="number" value={initialCredit} onChange={e => setInitialCredit(e.target.value)} /></Field>
                <p className="text-xs text-muted-foreground">
                  Department wallet ติดลบได้ — admin ปรับยอดผ่านหน้า "ปรับยอดกระเป๋าแผนก" เป็นรายเดือน
                </p>
              </>
            )}

            {kind === "other" && (
              <>
                <Field label="ชื่อ *"><Input value={name} onChange={e => setName(e.target.value)} /></Field>
                <Field label="Visitor code (Customer code)"><Input value={customerCode} onChange={e => setCustomerCode(e.target.value)} placeholder="auto if blank" /></Field>
                <Field label="Email"><Input value={email} onChange={e => setEmail(e.target.value)} /></Field>
                <Field label="Phone"><Input value={phone} onChange={e => setPhone(e.target.value)} /></Field>
                <Field label="Card UID"><Input value={cardUid} onChange={e => setCardUid(e.target.value)} /></Field>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={withWallet} onCheckedChange={(v) => setWithWallet(!!v)} />
                  <span>สร้าง wallet ให้ด้วย (default: ไม่มี wallet)</span>
                </label>
              </>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === "form" && (
            <Button variant="outline" onClick={() => setStep("pick")}>← {t("cardholders.kindAll")}</Button>
          )}
          <Button variant="ghost" onClick={close}>{t("shopUsers.btnCancel")}</Button>
          {step === "form" && (
            <Button onClick={submit} disabled={submitting || shopMissing}>
              {submitting ? t("cardholders.create_.submitting") : t("cardholders.create_.submit")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className={cn("text-xs font-medium")}>{label}</Label>
      {children}
    </div>
  );
}
