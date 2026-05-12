import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Server } from "lucide-react";

export function ServerStatusIndicator() {
  const { t } = useTranslation();
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  const checkServerStatus = useCallback(async () => {
    if (typeof window === "undefined") return;

    if (!navigator.onLine) {
      setIsOnline(false);
      return;
    }

    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 3500);
      const response = await fetch(`/isb-logo.svg?ping=${Date.now()}`, {
        method: "HEAD",
        cache: "no-store",
        signal: controller.signal,
      });
      window.clearTimeout(timeoutId);
      setIsOnline(response.ok);
    } catch {
      setIsOnline(false);
    }
  }, []);

  useEffect(() => {
    void checkServerStatus();

    const onOnline = () => {
      void checkServerStatus();
    };
    const onOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const intervalId = window.setInterval(() => {
      void checkServerStatus();
    }, 15000);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(intervalId);
    };
  }, [checkServerStatus]);

  return (
    <Badge
      variant={isOnline ? "success" : "destructive"}
      className="h-9 gap-1.5 px-3"
      aria-live="polite"
    >
      <Server className="h-3.5 w-3.5" />
      <span className="inline-block h-2 w-2 rounded-full bg-current" />
      <span className="text-xs font-semibold">
        {t("serverStatus.label")}: {isOnline ? t("serverStatus.online") : t("serverStatus.offline")}
      </span>
    </Badge>
  );
}
