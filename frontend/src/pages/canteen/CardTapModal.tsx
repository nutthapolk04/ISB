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
import { Loader2, UserCircle2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type {
  StudentLookupResult,
  UserPayerLookup,
} from "./RfidPaymentModal";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentMember: StudentLookupResult | null;
  onSelect: (member: StudentLookupResult) => void;
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

export function CardTapModal({ open, onOpenChange, currentMember, onSelect }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<StudentLookupResult | null>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);

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

      // 4. User by username
      try {
        const result = await api.get<UserPayerLookup>(
          `/users/by-username/${encodeURIComponent(trimmed)}`,
        );
        setFound(userToStudent(result));
        return;
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }

      throw new ApiError(404, t("canteen.cardTap.notFoundInSystem"), undefined);
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : t("canteen.cardTap.notFound"));
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
                placeholder={t("canteen.cardTap.placeholder", "UID / รหัสนักเรียน / username")}
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
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-amber-100 ring-2 ring-amber-300 flex items-center justify-center">
                    {found.photo_url ? (
                      <img
                        src={found.photo_url}
                        alt={found.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <UserCircle2 className="h-10 w-10 text-amber-400" />
                    )}
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
