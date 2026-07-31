<script setup lang="ts">
import { computed, ref } from 'vue';
import { KeyRound, LogIn, XCircle } from 'lucide-vue-next';
import { useKioskStore } from '../stores/kioskStore';
import { getKioskServiceUsername } from '../lib/kioskServiceAccount';

const emit = defineEmits<{ loggedIn: [] }>();

const store = useKioskStore();
const password = ref('');
const submitting = ref(false);
const error = ref('');

const username = computed(() => {
    try {
        return getKioskServiceUsername();
    } catch {
        return '';
    }
});

const t = computed(() => ({
    EN: {
        title: 'Kiosk sign-in',
        subtitle: 'Enter the service account password to start this device.',
        username: 'Account',
        password: 'Password',
        signIn: 'Sign in',
        signingIn: 'Signing in…',
        wrongPassword: 'Incorrect password',
        missingUsername: 'Device username is not configured (VITE_KIOSK_USERNAME)',
        networkError: 'Cannot reach server — check network and try again',
    },
    TH: {
        title: 'เข้าสู่ระบบคีออสก์',
        subtitle: 'กรอกรหัสผ่านบัญชี service เพื่อเริ่มใช้งานเครื่องนี้',
        username: 'บัญชี',
        password: 'รหัสผ่าน',
        signIn: 'เข้าสู่ระบบ',
        signingIn: 'กำลังเข้าสู่ระบบ…',
        wrongPassword: 'รหัสผ่านไม่ถูกต้อง',
        missingUsername: 'ยังไม่ได้ตั้งค่า username ของเครื่อง (VITE_KIOSK_USERNAME)',
        networkError: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบเครือข่ายแล้วลองใหม่',
    },
}[store.language]));

async function submit() {
    if (submitting.value || !username.value) return;
    if (!password.value.trim()) return;

    submitting.value = true;
    error.value = '';

    const result = await store.authenticateService(password.value);
    submitting.value = false;

    if (result.ok) {
        password.value = '';
        emit('loggedIn');
        return;
    }

    if (result.reason === 'wrong_password') {
        error.value = t.value.wrongPassword;
    } else if (result.reason === 'missing_username') {
        error.value = t.value.missingUsername;
    } else {
        error.value = store.bootError ?? t.value.networkError;
    }
}
</script>

<template>
    <div class="service-login">
        <div class="service-login-card">
            <div class="service-login-icon-wrap">
                <KeyRound :size="28" class="service-login-icon" />
            </div>
            <h1 class="service-login-title">{{ t.title }}</h1>
            <p class="service-login-sub">{{ t.subtitle }}</p>

            <label class="field-label">{{ t.username }}</label>
            <input
                :value="username || '—'"
                type="text"
                class="tech-input tech-input-readonly"
                readonly
                autocomplete="username"
            />

            <label class="field-label">{{ t.password }}</label>
            <input
                v-model="password"
                type="password"
                class="tech-input"
                autocomplete="current-password"
                :disabled="submitting || !username"
                @keyup.enter="submit"
            />

            <p v-if="error" class="error-line">
                <XCircle :size="14" />
                {{ error }}
            </p>

            <button
                class="btn-primary-full"
                type="button"
                :disabled="submitting || !username || !password.trim()"
                @click="submit"
            >
                <LogIn :size="16" />
                {{ submitting ? t.signingIn : t.signIn }}
            </button>
        </div>
    </div>
</template>

<style scoped>
.service-login {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100%;
    padding: 2rem;
}

.service-login-card {
    width: min(420px, 100%);
    padding: 2rem;
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 24px 48px rgba(0, 0, 0, 0.25);
}

.service-login-icon-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3.5rem;
    height: 3.5rem;
    margin: 0 auto 1rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
}

.service-login-icon {
    color: var(--accent-color, #f59e0b);
}

.service-login-title {
    margin: 0 0 0.5rem;
    font-size: 1.5rem;
    font-weight: 600;
    text-align: center;
    color: var(--text-color);
}

.service-login-sub {
    margin: 0 0 1.5rem;
    font-size: 0.95rem;
    line-height: 1.5;
    text-align: center;
    color: var(--text-muted);
}

.field-label {
    display: block;
    margin-bottom: 0.35rem;
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--text-muted);
}

.tech-input {
    width: 100%;
    margin-bottom: 1rem;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(0, 0, 0, 0.2);
    color: var(--text-color);
    font-size: 1rem;
}

.tech-input-readonly {
    opacity: 0.85;
    cursor: default;
}

.error-line {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin: -0.25rem 0 1rem;
    font-size: 0.875rem;
    color: #f87171;
}

.btn-primary-full {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.85rem 1rem;
    border: none;
    border-radius: 0.5rem;
    background: var(--accent-color, #f59e0b);
    color: #111;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
}

.btn-primary-full:disabled {
    opacity: 0.55;
    cursor: not-allowed;
}
</style>
