<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowLeft, KeyRound, CheckCircle2, XCircle, Wrench } from 'lucide-vue-next';
import { useKioskStore } from '../stores/kioskStore';
import { realApi } from '../api/realApi';
import {
    changeTechnicianPassword,
    TECHNICIAN_PASSWORD_MIN_LENGTH,
    TECHNICIAN_SESSION_KEY,
    type ChangePasswordError,
} from '../lib/technicianPassword';
import { logKioskEvent } from '../lib/kioskLog';

const router = useRouter();
const store = useKioskStore();

const currentPasswordInput = ref('');
const newPasswordInput = ref('');
const confirmPasswordInput = ref('');
const passwordChangeMessage = ref('');
const passwordChangeError = ref('');
const changingPassword = ref(false);

const t = computed(() => ({
    EN: {
        console: 'Technician Console',
        title: 'Change device password',
        back: 'Back to console',
        hint: 'Stored on this device only. The build default applies until you set a new password here.',
        currentPassword: 'Current password',
        newPassword: 'New password',
        confirmPassword: 'Confirm new password',
        changePasswordBtn: 'Update password',
        changingPassword: 'Updating…',
        passwordChanged: 'Device password updated',
        passwordWrongCurrent: 'Current password is incorrect',
        passwordTooShort: `New password must be at least ${TECHNICIAN_PASSWORD_MIN_LENGTH} characters`,
        passwordMismatch: 'New passwords do not match',
        passwordSameAsCurrent: 'New password must differ from the current one',
        passwordStorageFailed: 'Could not save password on this device',
    },
    TH: {
        console: 'ผู้ดูแลเครื่อง',
        title: 'เปลี่ยนรหัสผ่านเครื่อง',
        back: 'กลับหน้าผู้ดูแล',
        hint: 'เก็บในเครื่องนี้เท่านั้น จนกว่าจะตั้งรหัสใหม่ ระบบใช้ค่าเริ่มต้นจาก build',
        currentPassword: 'รหัสผ่านปัจจุบัน',
        newPassword: 'รหัสผ่านใหม่',
        confirmPassword: 'ยืนยันรหัสผ่านใหม่',
        changePasswordBtn: 'บันทึกรหัสใหม่',
        changingPassword: 'กำลังบันทึก…',
        passwordChanged: 'เปลี่ยนรหัสผ่านแล้ว',
        passwordWrongCurrent: 'รหัสผ่านปัจจุบันไม่ถูกต้อง',
        passwordTooShort: `รหัสผ่านใหม่ต้องมีอย่างน้อย ${TECHNICIAN_PASSWORD_MIN_LENGTH} ตัวอักษร`,
        passwordMismatch: 'รหัสผ่านใหม่ไม่ตรงกัน',
        passwordSameAsCurrent: 'รหัสใหม่ต้องไม่ซ้ำกับรหัสปัจจุบัน',
        passwordStorageFailed: 'บันทึกรหัสผ่านบนเครื่องไม่สำเร็จ',
    },
}[store.language]));

onMounted(() => {
    try {
        if (sessionStorage.getItem(TECHNICIAN_SESSION_KEY) !== '1') {
            router.replace('/technician');
            return;
        }
    } catch {
        router.replace('/technician');
        return;
    }
    logKioskEvent('system', 'info', 'Technician password screen opened');
});

function goBack() {
    router.push('/technician');
}

function passwordChangeErrorText(code: ChangePasswordError): string {
    const map: Record<ChangePasswordError, string> = {
        wrong_current: t.value.passwordWrongCurrent,
        too_short: t.value.passwordTooShort,
        mismatch: t.value.passwordMismatch,
        same_as_current: t.value.passwordSameAsCurrent,
        storage_failed: t.value.passwordStorageFailed,
    };
    return map[code];
}

function submitPasswordChange() {
    if (changingPassword.value) return;
    passwordChangeMessage.value = '';
    passwordChangeError.value = '';

    changingPassword.value = true;
    try {
        const result = changeTechnicianPassword(
            currentPasswordInput.value,
            newPasswordInput.value,
            confirmPasswordInput.value,
        );

        if (!result.ok) {
            passwordChangeError.value = passwordChangeErrorText(result.error);
            logKioskEvent('system', 'warn', 'Technician password change failed', { reason: result.error });
            return;
        }

        currentPasswordInput.value = '';
        newPasswordInput.value = '';
        confirmPasswordInput.value = '';
        passwordChangeMessage.value = t.value.passwordChanged;
        logKioskEvent('system', 'info', 'Technician device password changed');
        setTimeout(() => { passwordChangeMessage.value = ''; }, 2500);

        void realApi.notifyTechnicianPasswordChanged()
            .then((res) => {
                if (res.notified > 0) {
                    logKioskEvent('system', 'info', 'Custodian password-change alert sent', { notified: res.notified });
                }
            })
            .catch((e) => {
                logKioskEvent('system', 'warn', 'Custodian password-change alert failed', {
                    error: e instanceof Error ? e.message : String(e),
                });
            });
    } finally {
        changingPassword.value = false;
    }
}
</script>

<template>
    <div class="kiosk-container pwd-page">
        <div class="pwd-shell">
            <header class="pwd-topbar">
                <button class="back-pill" type="button" @click="goBack">
                    <ArrowLeft :size="16" />
                    {{ t.back }}
                </button>
                <div class="pwd-heading">
                    <div class="pwd-eyebrow">
                        <Wrench :size="14" />
                        {{ t.console }}
                    </div>
                    <h1 class="pwd-h1">{{ t.title }}</h1>
                </div>
            </header>

            <section class="pwd-card">
                <div class="pwd-icon-wrap">
                    <KeyRound :size="24" class="pwd-icon" />
                </div>
                <p class="pwd-hint">{{ t.hint }}</p>

                <div class="pwd-fields">
                    <div>
                        <label class="field-label">{{ t.currentPassword }}</label>
                        <input v-model="currentPasswordInput" type="password" class="tech-input" autocomplete="off" />
                    </div>
                    <div>
                        <label class="field-label">{{ t.newPassword }}</label>
                        <input v-model="newPasswordInput" type="password" class="tech-input" autocomplete="new-password" />
                    </div>
                    <div>
                        <label class="field-label">{{ t.confirmPassword }}</label>
                        <input v-model="confirmPasswordInput" type="password" class="tech-input"
                            autocomplete="new-password" @keyup.enter="submitPasswordChange" />
                    </div>
                </div>

                <button class="btn-primary-full" type="button" :disabled="changingPassword" @click="submitPasswordChange">
                    <KeyRound :size="16" />
                    {{ changingPassword ? t.changingPassword : t.changePasswordBtn }}
                </button>

                <p v-if="passwordChangeMessage" class="success-line">
                    <CheckCircle2 :size="14" />
                    {{ passwordChangeMessage }}
                </p>
                <p v-if="passwordChangeError" class="error-line">
                    <XCircle :size="14" />
                    {{ passwordChangeError }}
                </p>
            </section>
        </div>
    </div>
</template>

<style scoped>
.pwd-page {
    min-height: 100vh;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    background: #f8fafc;
    color: #0f172a;
}

.pwd-shell {
    flex: 1;
    max-width: 28rem;
    width: 100%;
    margin: 0 auto;
    padding: 1rem 1rem 1.5rem;
}

.pwd-topbar {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
}

.back-pill {
    display: inline-flex;
    align-self: flex-start;
    align-items: center;
    gap: 0.375rem;
    border-radius: 9999px;
    border: 1px solid #e2e8f0;
    background: #fff;
    padding: 0.375rem 0.75rem;
    font-size: 0.875rem;
    color: #475569;
    cursor: pointer;
    box-shadow: 0 1px 2px rgb(0 0 0 / 5%);
}

.pwd-eyebrow {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #64748b;
}

.pwd-h1 {
    margin: 0.125rem 0 0;
    font-size: 1.5rem;
    font-weight: 600;
    letter-spacing: -0.02em;
}

.pwd-card {
    border-radius: 1rem;
    border: 1px solid #e2e8f0;
    background: #fff;
    padding: 1.5rem;
    box-shadow: 0 1px 2px rgb(0 0 0 / 5%);
}

.pwd-icon-wrap {
    display: flex;
    height: 3rem;
    width: 3rem;
    align-items: center;
    justify-content: center;
    border-radius: 0.75rem;
    background: linear-gradient(to bottom, #e0e7ff, #eef2ff);
    box-shadow: inset 0 0 0 1px #c7d2fe;
}

.pwd-icon {
    color: #2563eb;
}

.pwd-hint {
    margin: 1rem 0 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: #64748b;
}

.field-label {
    display: block;
    margin-top: 1rem;
    margin-bottom: 0.375rem;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #64748b;
}

.pwd-fields .field-label:first-child {
    margin-top: 0;
}

.tech-input {
    width: 100%;
    border-radius: 0.75rem;
    border: 1px solid #e2e8f0;
    background: #fff;
    padding: 0.625rem 0.875rem;
    font-size: 0.875rem;
    color: #0f172a;
    outline: none;
}

.tech-input:focus {
    border-color: #2563eb;
}

.pwd-fields {
    margin-top: 1.25rem;
    display: grid;
    gap: 0.25rem;
}

.btn-primary-full {
    margin-top: 1.25rem;
    display: inline-flex;
    width: 100%;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border: none;
    border-radius: 0.75rem;
    background: #2563eb;
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: #fff;
    cursor: pointer;
}

.btn-primary-full:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.success-line {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin: 0.75rem 0 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: #059669;
}

.error-line {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin: 0.75rem 0 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: #e11d48;
}
</style>
