import { useEffect, useRef, useState } from "react";
import { Timer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/** Matches BAY gateway `expiredMinutes: 3` in topup_service.ts */
export const QR_TOPUP_TIMEOUT_SEC = 180;

interface QrCountdownBarProps {
  active: boolean;
  /** Restart countdown when this changes (e.g. ref_code). */
  resetKey?: string | number | null;
  totalSeconds?: number;
  onExpired?: () => void;
  className?: string;
}

export function QrCountdownBar({
  active,
  resetKey,
  totalSeconds = QR_TOPUP_TIMEOUT_SEC,
  onExpired,
  className,
}: QrCountdownBarProps) {
  const { t } = useTranslation();
  const [timeLeft, setTimeLeft] = useState(totalSeconds);
  const onExpiredRef = useRef(onExpired);
  onExpiredRef.current = onExpired;

  useEffect(() => {
    if (!active) return;
    setTimeLeft(totalSeconds);
    const id = window.setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [active, resetKey, totalSeconds]);

  useEffect(() => {
    if (active && timeLeft === 0) {
      onExpiredRef.current?.();
    }
  }, [active, timeLeft]);

  if (!active) return null;

  const progress = timeLeft / totalSeconds;
  const mm = Math.floor(timeLeft / 60);
  const ss = (timeLeft % 60).toString().padStart(2, "0");
  const warning = timeLeft <= 60;
  const danger = timeLeft <= 30;

  return (
    <div className={cn("space-y-2", className)}>
      <div
        className={cn(
          "flex items-center justify-center gap-2 text-sm font-medium",
          danger ? "text-destructive" : warning ? "text-amber-600" : "text-muted-foreground",
        )}
      >
        <Timer className="h-4 w-4 shrink-0" />
        <span>{t("qrCountdown.timeRemaining", "Time remaining")}:</span>
        <span className="font-mono tabular-nums">{mm}:{ss}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-1000 ease-linear",
            danger ? "bg-destructive" : warning ? "bg-amber-500" : "bg-primary",
          )}
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
}
