/**
 * Best-effort custodian email when the kiosk enters Out-of-Service (LOCK).
 * See backend POST /kiosk/lock-alert and kiosk_monitoring_service.notifyKioskLocked.
 */
import { realApi } from '../api/realApi';
import type { RecoveryTopupSnapshot } from './recoveryReceipt';

export async function notifyCustodiansOfLock(snapshot: RecoveryTopupSnapshot): Promise<void> {
    try {
        await realApi.notifyKioskLock({
            ref: snapshot.ref,
            method: snapshot.method,
            payer_id: snapshot.payer_id,
            receiver_id: snapshot.receiver_id,
            actual_amount: snapshot.actual_amount,
            target_amount: snapshot.target_amount,
            locked_at: snapshot.recorded_at,
        });
    } catch (e) {
        console.warn('[OOS] custodian lock alert failed:', e);
    }
}
