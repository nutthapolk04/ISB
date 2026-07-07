# Kiosk Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มหน้าตั้งค่าให้ kiosk สำหรับตั้งชื่อเครื่อง โดยมีระบบ login ป้องกัน ด้วย kiosk credentials เดิม

**Architecture:** เพิ่ม route `/settings` ใหม่ใน Vue Router, สร้าง `SettingsView.vue` ที่มี 2 step (login → settings), เก็บชื่อเครื่องใน `localStorage` ผ่าน `kioskStore`, แสดงบน WelcomeView พร้อม gear icon เข้าถึง

**Tech Stack:** Vue 3 (Composition API), Pinia, Vue Router 4, TypeScript, lucide-vue-next

---

## ไฟล์ที่เปลี่ยน

| ไฟล์ | การเปลี่ยนแปลง |
|------|---------------|
| `kiosk/src/stores/kioskStore.ts` | เพิ่ม `machineName` ref + `setMachineName()` |
| `kiosk/src/router/index.ts` | เพิ่ม route `/settings` |
| `kiosk/src/views/SettingsView.vue` | ไฟล์ใหม่ — login + settings form |
| `kiosk/src/views/WelcomeView.vue` | เพิ่ม gear icon + แสดงชื่อเครื่อง |

---

### Task 1: เพิ่ม machineName ใน kioskStore

**Files:**
- Modify: `kiosk/src/stores/kioskStore.ts`

- [ ] **Step 1: เพิ่ม machineName ref และ setMachineName ใน store**

เปิด `kiosk/src/stores/kioskStore.ts` แก้ส่วน state declarations (หลัง `loginSource` ref บรรทัด 14) เพิ่ม:

```ts
const machineName = ref<string>(localStorage.getItem('kiosk_machine_name') ?? '')
```

เพิ่ม function หลัง `fetchSchoolInfo`:

```ts
function setMachineName(name: string) {
    machineName.value = name.trim()
    localStorage.setItem('kiosk_machine_name', machineName.value)
}
```

- [ ] **Step 2: Expose ใน return object**

ใน return object ของ store เพิ่ม `machineName` และ `setMachineName`:

```ts
return {
    currentUser,
    currentWallet,
    activeWalletIndex,
    transactions,
    isLoading,
    language,
    lastActivity,
    isAuthenticated,
    loginSource,
    transactionWalletIndex,
    machineName,        // เพิ่ม
    setLanguage,
    setActiveWallet,
    updateActivity,
    login,
    logout,
    refreshBalance,
    refreshTransactions,
    schoolInfo,
    fetchSchoolInfo,
    setMachineName,     // เพิ่ม
};
```

- [ ] **Step 3: Verify — เปิด browser console ที่ localhost:5173 รัน:**

```js
const store = window.__pinia_stores__?.kiosk
// ถ้าไม่ได้ ให้ลองใน Vue DevTools → Pinia → kiosk store
// ต้องเห็น machineName: "" และ setMachineName เป็น function
```

- [ ] **Step 4: Commit**

```bash
git add kiosk/src/stores/kioskStore.ts
git commit -m "feat(kiosk): add machineName state to kioskStore"
```

---

### Task 2: เพิ่ม route /settings

**Files:**
- Modify: `kiosk/src/router/index.ts`

- [ ] **Step 1: Import SettingsView และเพิ่ม route**

เปิด `kiosk/src/router/index.ts` เพิ่ม import:

```ts
import SettingsView from '../views/SettingsView.vue';
```

เพิ่ม route ก่อน catch-all:

```ts
{
    path: '/settings',
    name: 'settings',
    component: SettingsView
},
```

ไฟล์สุดท้ายควรเป็น:

```ts
import { createRouter, createWebHistory } from 'vue-router';
import WelcomeView from '../views/WelcomeView.vue';
import BalanceView from '../views/BalanceView.vue';
import TransactionHistoryView from '../views/TransactionHistoryView.vue';
import TopUpView from '../views/TopUpView.vue';
import SettingsView from '../views/SettingsView.vue';

const routes = [
    {
        path: '/',
        name: 'welcome',
        component: WelcomeView
    },
    {
        path: '/balance',
        name: 'balance',
        component: BalanceView
    },
    {
        path: '/history',
        name: 'history',
        component: TransactionHistoryView
    },
    {
        path: '/topup',
        name: 'topup',
        component: TopUpView
    },
    {
        path: '/settings',
        name: 'settings',
        component: SettingsView
    },
    {
        path: '/:pathMatch(.*)*',
        redirect: '/'
    }
];

const router = createRouter({
    history: createWebHistory(),
    routes
});

export default router;
```

- [ ] **Step 2: Commit (SettingsView.vue ยังไม่มี — TypeScript จะ error จนกว่าจะสร้างใน Task 3)**

ยังไม่ commit ขั้นตอนนี้ รอทำพร้อม Task 3

---

### Task 3: สร้าง SettingsView.vue

**Files:**
- Create: `kiosk/src/views/SettingsView.vue`

- [ ] **Step 1: สร้างไฟล์ SettingsView.vue**

สร้างไฟล์ `kiosk/src/views/SettingsView.vue` ด้วย content นี้:

```vue
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

/* kiosk-btn ใช้ global style จาก style.css */
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
```

- [ ] **Step 2: Verify — TypeScript build ไม่ error**

```bash
cd kiosk && npx vue-tsc --noEmit
```

Expected: ไม่มี error

- [ ] **Step 3: Verify — เปิด browser ไปที่ localhost:5173/settings**

ต้องเห็นหน้า login form มี username/password input และปุ่ม Confirm/Cancel

- [ ] **Step 4: ทดสอบ login**

- ใส่ username/password ผิด → ต้องเห็น error message
- ใส่ credentials ตาม `.env` (VITE_KIOSK_USERNAME / VITE_KIOSK_PASSWORD) → ต้องข้ามไป step settings
- ใส่ชื่อเครื่อง → กด Save → ต้องกลับหน้า Welcome

- [ ] **Step 5: Commit**

```bash
git add kiosk/src/views/SettingsView.vue kiosk/src/router/index.ts
git commit -m "feat(kiosk): add settings route and SettingsView with login protection"
```

---

### Task 4: เพิ่ม gear icon และแสดงชื่อเครื่องใน WelcomeView

**Files:**
- Modify: `kiosk/src/views/WelcomeView.vue`

- [ ] **Step 1: เพิ่ม import Settings icon และ useRouter**

ใน `<script setup>` เพิ่ม import:

```ts
import { useRouter } from 'vue-router';
import { CreditCard, Languages, Settings } from 'lucide-vue-next';

const router = useRouter();
```

(useRouter มีอยู่แล้วในไฟล์ — แค่เพิ่ม `Settings` ใน lucide import)

- [ ] **Step 2: เพิ่ม bottom bar ใน template**

ใน `<template>` เพิ่ม div ด้านล่างสุดของ `.kiosk-container` (ต่อจาก `.welcome-content`):

```html
<!-- Bottom bar: gear icon + machine name -->
<div class="bottom-bar">
    <button class="settings-btn" @click="router.push('/settings')">
        <Settings :size="20" />
        <span v-if="store.machineName" class="machine-name-label">{{ store.machineName }}</span>
    </button>
</div>
```

- [ ] **Step 3: เพิ่ม CSS styles**

ใน `<style scoped>` เพิ่ม:

```css
.bottom-bar {
    width: 100%;
    display: flex;
    justify-content: flex-start;
    align-items: center;
    padding-bottom: 1.5rem;
}

.settings-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: none;
    border: none;
    color: var(--text-muted);
    opacity: 0.4;
    cursor: pointer;
    padding: 0.5rem 0.25rem;
    border-radius: 0.5rem;
    transition: opacity 0.2s;
}

.settings-btn:hover,
.settings-btn:active {
    opacity: 0.8;
}

.machine-name-label {
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--text-muted);
}
```

- [ ] **Step 4: Verify — เปิด localhost:5173**

- ต้องเห็น gear icon เล็กๆ มุมซ้ายล่าง opacity ต่ำ
- กด gear icon → ไปหน้า `/settings`
- ถ้าตั้งชื่อเครื่องไว้แล้ว → ต้องเห็นชื่อเครื่องถัดจาก gear icon
- ถ้ายังไม่ตั้ง → เห็นแค่ gear icon

- [ ] **Step 5: ทดสอบ flow ครบ**

1. กด gear → Login → ใส่ credentials ถูก → ตั้งชื่อ "Kiosk 1" → Save
2. หน้า Welcome ต้องแสดง gear icon + "Kiosk 1"
3. Refresh page → ชื่อเครื่องต้องยังอยู่ (localStorage persist)
4. กด gear → Cancel → ต้องกลับ Welcome โดยไม่เปลี่ยนชื่อ

- [ ] **Step 6: Commit**

```bash
git add kiosk/src/views/WelcomeView.vue
git commit -m "feat(kiosk): show machine name and settings gear icon on welcome screen"
```
