import { getRaw } from "./settings_service";
import { sendPendingLowBalanceAlerts } from "./low_balance_notification";

/** Key = "HH:MM_YYYY-MM-DD" — prevents double-firing within the same minute. */
let lastFiredKey = "";

export function startLowBalanceScheduler(): void {
  setInterval(async () => {
    try {
      const alertEnabled = (await getRaw("low_balance_alert_enabled")) as boolean | null;
      if (!alertEnabled) return;

      const sendTime = ((await getRaw("low_balance_alert_send_time")) as string | null) ?? "19:00";
      const now = new Date();
      const nowBKK = now.toLocaleTimeString("sv-SE", {
        timeZone: "Asia/Bangkok",
        hour: "2-digit",
        minute: "2-digit",
      });
      const todayBKK = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
      const fireKey = `${nowBKK}_${todayBKK}`;

      if (nowBKK !== sendTime || lastFiredKey === fireKey) return;
      lastFiredKey = fireKey;

      await sendPendingLowBalanceAlerts();
    } catch {
      // silent — don't crash the server on scheduler errors
    }
  }, 60_000);
}
