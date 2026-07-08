<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useKioskStore } from '../stores/kioskStore';
import { ChevronLeft } from 'lucide-vue-next';

const router = useRouter();
const store = useKioskStore();

type Step = 'login' | 'settings';
const step = ref<Step>('login');

const username = ref('');
const password = ref('');
const loginError = ref(false);

const machineNameInput = ref(store.machineName);

const t = {
    EN: {
        titleLogin: 'Staff Access',
        subtitleLogin: 'Enter kiosk credentials to continue',
        username: 'Username',
        password: 'Password',
        confirm: 'Confirm',
        cancel: 'Cancel',
        errorLogin: 'Incorrect username or password',
        titleSettings: 'Settings',
        machineName: 'Machine Name',
        machineNamePlaceholder: 'e.g. Kiosk 1',
        save: 'Save',
    },
    TH: {
        titleLogin: 'เข้าถึงสำหรับ Staff',
        subtitleLogin: 'ใส่ credentials ของ kiosk เพื่อดำเนินการ',
        username: 'ชื่อผู้ใช้',
        password: 'รหัสผ่าน',
        confirm: 'ยืนยัน',
        cancel: 'ยกเลิก',
        errorLogin: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
        titleSettings: 'ตั้งค่า',
        machineName: 'ชื่อเครื่อง',
        machineNamePlaceholder: 'เช่น Kiosk 1',
        save: 'บันทึก',
    },
};

const currT = () => t[store.language as 'EN' | 'TH'];

function confirmLogin() {
    const validUser = import.meta.env.VITE_KIOSK_USERNAME as string;
    const validPass = import.meta.env.VITE_KIOSK_PASSWORD as string;
    if (username.value === validUser && password.value === validPass) {
        loginError.value = false;
        step.value = 'settings';
    } else {
        loginError.value = true;
    }
}

function saveSettings() {
    store.setMachineName(machineNameInput.value);
    router.push('/');
}

function cancel() {
    router.push('/');
}
</script>

<template>
    <div class="kiosk-container settings-view">
        <div class="settings-card">

            <!-- Step: Login -->
            <template v-if="step === 'login'">
                <h2 class="settings-title">{{ currT().titleLogin }}</h2>
                <p class="settings-subtitle">{{ currT().subtitleLogin }}</p>

                <div class="field-group">
                    <label class="field-label">{{ currT().username }}</label>
                    <input
                        v-model="username"
                        type="text"
                        class="settings-input"
                        autocomplete="off"
                        autocorrect="off"
                        autocapitalize="none"
                        spellcheck="false"
                    />
                </div>

                <div class="field-group">
                    <label class="field-label">{{ currT().password }}</label>
                    <input
                        v-model="password"
                        type="password"
                        class="settings-input"
                        autocomplete="off"
                        @keyup.enter="confirmLogin"
                    />
                </div>

                <p v-if="loginError" class="error-msg">{{ currT().errorLogin }}</p>

                <div class="btn-row">
                    <button class="kiosk-btn btn-secondary" @click="cancel">
                        <ChevronLeft :size="22" />
                        {{ currT().cancel }}
                    </button>
                    <button class="kiosk-btn btn-primary" @click="confirmLogin">
                        {{ currT().confirm }}
                    </button>
                </div>
            </template>

            <!-- Step: Settings -->
            <template v-else>
                <h2 class="settings-title">{{ currT().titleSettings }}</h2>

                <div class="field-group">
                    <label class="field-label">{{ currT().machineName }}</label>
                    <input
                        v-model="machineNameInput"
                        type="text"
                        class="settings-input"
                        :placeholder="currT().machineNamePlaceholder"
                        maxlength="30"
                    />
                </div>

                <div class="btn-row">
                    <button class="kiosk-btn btn-secondary" @click="cancel">
                        <ChevronLeft :size="22" />
                        {{ currT().cancel }}
                    </button>
                    <button class="kiosk-btn btn-primary" @click="saveSettings">
                        {{ currT().save }}
                    </button>
                </div>
            </template>

        </div>
    </div>
</template>

<style scoped>
.settings-view {
    justify-content: center;
    align-items: center;
    padding: 2rem;
}

.settings-card {
    background: var(--card-bg);
    border-radius: var(--border-radius);
    box-shadow: var(--shadow);
    padding: 2.5rem 2rem;
    width: 100%;
    max-width: 480px;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
}

.settings-title {
    font-size: 2rem;
    font-weight: 800;
    text-align: center;
}

.settings-subtitle {
    font-size: 1rem;
    color: var(--text-muted);
    text-align: center;
    margin-top: -0.75rem;
}

.field-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.field-label {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-muted);
}

.settings-input {
    width: 100%;
    padding: 0.85rem 1rem;
    border: 2px solid rgba(0, 0, 0, 0.1);
    border-radius: 0.75rem;
    background: var(--bg-color);
    color: var(--text-color);
    font-size: 1.1rem;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s;
    user-select: text;
}

.settings-input:focus {
    border-color: var(--primary);
}

.error-msg {
    color: #ef4444;
    font-size: 0.95rem;
    font-weight: 600;
    text-align: center;
    margin-top: -0.5rem;
}

.btn-row {
    display: flex;
    gap: 1rem;
    margin-top: 0.5rem;
}

.btn-row .kiosk-btn {
    flex: 1;
}

.kiosk-btn {
    height: var(--btn-height);
    border-radius: 0.75rem;
    font-size: 1.1rem;
    font-weight: 700;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    transition: opacity 0.15s;
}

.btn-primary {
    background: var(--primary);
    color: white;
}

.btn-primary:active {
    opacity: 0.85;
}

.btn-secondary {
    background: var(--card-bg);
    color: var(--text-color);
    border: 2px solid rgba(0, 0, 0, 0.12);
}

.btn-secondary:active {
    opacity: 0.7;
}
</style>
