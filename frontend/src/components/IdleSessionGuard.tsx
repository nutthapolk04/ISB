import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const IDLE_LIMIT_MS = 60 * 60 * 1000; // 1 hour
const CHECK_INTERVAL_MS = 15_000;
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"] as const;

/** Mounted once inside the authenticated app shell. Tracks user activity and,
 *  after an hour of silence, marks the session expired without disturbing the
 *  current page. The next activity after that reveals a blocking "session
 *  timeout" dialog instead of resetting the idle timer — real logout only
 *  happens when the user confirms, so we never race the router's own
 *  auth-guard redirect or the API layer's 401 handler. */
export function IdleSessionGuard() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const lastActivityRef = useRef(Date.now());
  const expiredRef = useRef(false);
  const [showDialog, setShowDialog] = useState(false);

  useEffect(() => {
    const markActivity = () => {
      if (expiredRef.current) {
        setShowDialog(true);
        return;
      }
      lastActivityRef.current = Date.now();
    };
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, markActivity, { passive: true }));

    const interval = setInterval(() => {
      if (expiredRef.current) return;
      if (Date.now() - lastActivityRef.current >= IDLE_LIMIT_MS) {
        expiredRef.current = true;
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, markActivity));
      clearInterval(interval);
    };
  }, []);

  const handleGoToLogin = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <Dialog open={showDialog} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-sm"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{t("sessionTimeout.title")}</DialogTitle>
          <DialogDescription>{t("sessionTimeout.description")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={handleGoToLogin}>{t("sessionTimeout.goToLogin")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
