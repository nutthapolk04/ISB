import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth, LAST_ACTIVITY_KEY } from "@/contexts/AuthContext";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const IDLE_LIMIT_MS = 60 * 60 * 1000; // 1 hour
const CHECK_INTERVAL_MS = 15_000;
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"] as const;

function readPersistedLastActivity(): number {
  const raw = localStorage.getItem(LAST_ACTIVITY_KEY);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/** Mounted once inside the authenticated app shell. Tracks user activity and,
 *  after an hour of silence, marks the session expired without disturbing the
 *  current page. The next activity after that reveals a blocking "session
 *  timeout" dialog instead of resetting the idle timer — real logout only
 *  happens when the user confirms, so we never race the router's own
 *  auth-guard redirect or the API layer's 401 handler.
 *
 *  The clock is persisted to localStorage (AuthContext.LAST_ACTIVITY_KEY),
 *  not just this in-memory ref — an in-memory-only clock resets to "now" on
 *  every fresh mount, so closing the tab/browser and reopening it later
 *  (even days later) would never trip the idle limit no matter how long it
 *  sat closed. On mount we check the persisted timestamp immediately: if
 *  it's already past the limit, we show the dialog right away rather than
 *  waiting for the user to move the mouse first — a shared device left
 *  logged in and reopened later should never silently keep serving the
 *  previous person's session while they read what's on screen. */
export function IdleSessionGuard() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const alreadyExpiredOnMount = useRef(Date.now() - readPersistedLastActivity() >= IDLE_LIMIT_MS).current;
  const lastActivityRef = useRef(Date.now());
  const expiredRef = useRef(alreadyExpiredOnMount);
  const [showDialog, setShowDialog] = useState(alreadyExpiredOnMount);

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
      } else {
        localStorage.setItem(LAST_ACTIVITY_KEY, String(lastActivityRef.current));
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
