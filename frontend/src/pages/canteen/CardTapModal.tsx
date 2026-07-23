import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, XCircle } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { resolveAvatarUrl, getFallbackAvatar } from "@/lib/avatarFallback";
import type {
  StudentLookupResult,
  UserPayerLookup,
} from "./RfidPaymentModal";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentMember: StudentLookupResult | null;
  onSelect: (member: StudentLookupResult) => void;
  /** A member resolved from a physical card tap captured by the page-level
   *  RFID listener while this modal is open. Routed through the same
   *  replace-confirmation gate as a manually typed + selected lookup. */
  scannedMember?: StudentLookupResult | null;
}

function userToStudent(u: UserPayerLookup): StudentLookupResult {
  return {
    id: u.user_id,
    name: u.full_name,
    photo_url: u.photo_url ?? null,
    customer_code: u.username,
    wallet_balance: u.wallet_balance,
    wallet_id: u.wallet_id,
    customer_kind: u.role,
    user_id: u.user_id,
  };
}

export function CardTapModal({ open, onOpenChange, currentMember, onSelect, scannedMember }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<StudentLookupResult | null>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);
  // The inline red text under the search row is easy to miss when the
  // cashier is looking elsewhere. Pop a real alert too so a missed scan
  // / wrong code is impossible to overlook.
  const [notFoundOpen, setNotFoundOpen] = useState(false);

  // Always read the latest currentMember inside the tap-driven effect below
  // without needing it in the dependency array (which would refire on every
  // unrelated member change).
  const currentMemberRef = useRef(currentMember);
  useEffect(() => { currentMemberRef.current = currentMember; }, [currentMember]);

  // Reset state on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setError(null);
      setFound(null);
      setReplaceOpen(false);
      // Delay focus so dialog animation completes
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  // A physical card tap resolved while this modal is open — go through the
  // same replace-confirmation gate a manual lookup + select would use.
  useEffect(() => {
    if (!open || !scannedMember) return;
    setFound(scannedMember);
    setError(null);
    setNotFoundOpen(false);
    const current = currentMemberRef.current;
    if (current && current.id !== scannedMember.id) {
      setReplaceOpen(true);
    } else {
      onSelect(scannedMember);
      onOpenChange(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannedMember]);

  const lookup = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setFound(null);

    try {
      // 1. Customer by card UID
      try {
        const result = await api.get<StudentLookupResult>(
          `/customers/by-card/${encodeURIComponent(trimmed)}`,
        );
        setFound(result);
        return;
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }

      // 2. User by card UID
      try {
        const result = await api.get<UserPayerLookup>(
          `/users/by-card/${encodeURIComponent(trimmed)}`,
        );
        setFound(userToStudent(result));
        return;
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }

      // 3. Customer by code
      try {
        const result = await api.get<StudentLookupResult>(
          `/customers/by-code/${encodeURIComponent(trimmed)}`,
        );
        setFound(result);
        return;
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }

      // 4. User by staff code (external_id — e.g. EMP-001)
      try {
        const result = await api.get<UserPayerLookup>(
          `/users/by-external-id/${encodeURIComponent(trimmed)}`,
        );
        setFound(userToStudent(result));
        return;
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }

      throw new ApiError(404, t("canteen.cardTap.notFoundInSystem"), undefined);
    } catch (e) {
      const msg = e instanceof ApiError ? e.detail : t("canteen.cardTap.notFound");
      setError(msg);
      setNotFoundOpen(true);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = () => {
    if (!found) return;
    if (currentMember && currentMember.id !== found.id) {
      setReplaceOpen(true);
    } else {
      onSelect(found);
      onOpenChange(false);
    }
  };

  const handleConfirmReplace = () => {
    if (!found) return;
    setReplaceOpen(false);
    onSelect(found);
    onOpenChange(false);
  };

  const balance = found?.wallet_balance ?? null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("canteen.cardTap.title", "แตะบัตรหรือใส่รหัส")}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Input row */}
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void lookup(query);
                }}
                placeholder={t("canteen.cardTap.placeholder", "UID / รหัสนักเรียน / ISB_ID_Number")}
                disabled={loading}
                className="flex-1"
              />
              <Button
                onClick={() => void lookup(query)}
                disabled={loading || !query.trim()}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t("canteen.cardTap.search", "ค้นหา")
                )}
              </Button>
            </div>

            {/* Inline error */}
            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}

            {/* Member card */}
            {found && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-3">
                <div className="flex items-center gap-3">
                  {/* Avatar / photo */}
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-amber-100 ring-2 ring-amber-300 flex items-center justify-center">
                    <img
                      src={resolveAvatarUrl(found.photo_url, found.name || String(found.id))}
                      alt={found.name}
                      className="h-full w-full object-cover"
                      onError={(e) => { e.currentTarget.src = getFallbackAvatar(found.name || String(found.id)); }}
                    />
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-amber-900">
                      {found.name}
                    </div>
                    <div className="text-xs text-amber-700 mt-0.5">
                      {found.student_code ?? found.customer_code}
                      {found.grade ? ` · Grade ${found.grade}` : ""}
                    </div>
                    {balance !== null && (
                      <div className="text-sm font-bold tabular-nums text-amber-700 mt-1">
                        ฿{Number(balance).toFixed(2)}
                      </div>
                    )}
                  </div>
                </div>

                <Button
                  className="w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold"
                  onClick={handleSelect}
                >
                  {t("canteen.cardTap.select", "เลือกสมาชิกนี้")}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Not-found alert — pops on top of the search dialog so the cashier
          can't miss it. Auto-focuses the input again when dismissed. */}
      <AlertDialog open={notFoundOpen} onOpenChange={setNotFoundOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-3">
              <XCircle className="h-10 w-10 shrink-0 text-red-600" strokeWidth={2.5} />
              <AlertDialogTitle className="text-red-700">
                {t("canteen.cardTap.notFound", "Not found")}
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription className="pt-2">
              {error ?? t("canteen.cardTap.notFoundInSystem", "Not found in the system")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => {
                setNotFoundOpen(false);
                inputRef.current?.focus();
                inputRef.current?.select();
              }}
            >
              {t("common.ok", "OK")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Replace confirmation */}
      <AlertDialog open={replaceOpen} onOpenChange={setReplaceOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("canteen.cardTap.replaceTitle", "เปลี่ยนสมาชิก?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("canteen.cardTap.replaceBody", { from: currentMember?.name ?? "", to: found?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "ยกเลิก")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-500 hover:bg-amber-600"
              onClick={handleConfirmReplace}
            >
              {t("canteen.cardTap.confirmReplace", "เปลี่ยน")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
