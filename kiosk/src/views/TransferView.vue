<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useKioskStore } from '../stores/kioskStore';
import { realApi } from '../api/realApi';
import { ref, computed, onMounted } from 'vue';
import {
    ChevronLeft,
    ChevronRight,
    LogOut,
    User,
    ArrowLeftRight,
    CheckCircle2,
    XCircle,
} from 'lucide-vue-next';

const router = useRouter();
const store = useKioskStore();

if (!store.isAuthenticated) {
    router.push('/');
}

type Step = 'recipient' | 'amount' | 'confirm' | 'success' | 'fail';

const step = ref<Step>('recipient');
const selectedChildId = ref<string | null>(null);
const enteredAmount = ref('0');
const isProcessing = ref(false);
const failMessage = ref('');
const successAmount = ref(0);
const successChildName = ref('');

const MIN_AMOUNT = 100;
const MAX_AMOUNT = 50000;
const MAX_BALANCE = 50000;
const SHORTCUTS = [500, 1000, 2000, 5000, 10000, 20000, 50000];

// The parent's own wallet always funds the transfer — matches the common
// real-world case (parent tops up a child from the kiosk) and keeps the
// flow to a single, unambiguous direction rather than mirroring the portal's
// full from/to picker.
const fromWallet = computed(() => store.currentUser?.wallets.find(w => w.type === 'personal') ?? null);
const children = computed(() => store.currentUser?.wallets.filter(w => w.type === 'child') ?? []);
const selectedChild = computed(() => children.value.find(c => c.id === selectedChildId.value) ?? null);

onMounted(() => {
    // Nothing to transfer to — bounce back rather than show an empty screen.
    if (children.value.length === 0) {
        router.push('/balance');
    }
});

const amountNumber = computed(() => {
    const n = parseFloat(enteredAmount.value);
    return isNaN(n) ? 0 : n;
});

const headroom = computed(() => Math.max(0, MAX_BALANCE - (selectedChild.value?.balance ?? 0)));
const effectiveMax = computed(() => Math.min(MAX_AMOUNT, fromWallet.value?.balance ?? 0, headroom.value));

const isAmountValid = computed(() => amountNumber.value >= MIN_AMOUNT && amountNumber.value <= effectiveMax.value);

const fromBalanceAfter = computed(() => (fromWallet.value?.balance ?? 0) - amountNumber.value);
const toBalanceAfter = computed(() => (selectedChild.value?.balance ?? 0) + amountNumber.value);

const formatCurrency = (val: number) => {
    return new Intl.NumberFormat(store.language === 'TH' ? 'th-TH' : 'en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(val);
};

const formattedAmount = computed(() => formatCurrency(amountNumber.value));

const nowFormatted = computed(() => {
    return new Date().toLocaleString(store.language === 'TH' ? 'th-TH' : 'en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
    });
});

const selectChild = (childId: string) => {
    selectedChildId.value = childId;
    enteredAmount.value = '0';
    step.value = 'amount';
};

const selectShortcut = (val: number) => {
    if (val > effectiveMax.value) return;
    enteredAmount.value = String(val);
};

const confirmAmount = () => {
    if (!isAmountValid.value) return;
    step.value = 'confirm';
};

const submitTransfer = async () => {
    if (isProcessing.value || !fromWallet.value || !selectedChild.value) return;
    isProcessing.value = true;
    try {
        const child = selectedChild.value;
        const amount = amountNumber.value;
        await realApi.transfer(
            fromWallet.value.id,
            child.id,
            amount,
            `Transfer via kiosk to ${child.holderName}`,
            Number(store.currentUser!.id),
        );
        successAmount.value = amount;
        successChildName.value = child.holderName;
        await store.refreshBalance();
        step.value = 'success';
    } catch (e) {
        failMessage.value = e instanceof Error ? e.message : String(e);
        step.value = 'fail';
    } finally {
        isProcessing.value = false;
    }
};

const handleHeaderBack = () => {
    if (isProcessing.value) return;
    if (step.value === 'recipient') {
        router.push('/balance');
    } else if (step.value === 'amount') {
        step.value = 'recipient';
    } else if (step.value === 'confirm') {
        step.value = 'amount';
    }
};

const handleLogout = () => {
    if (isProcessing.value) return;
    store.logout();
    router.push('/');
};

const goBackToBalance = () => {
    router.push('/balance');
};

const t = {
    EN: {
        title: 'Transfer to Family',
        back: 'Back',
        selectRecipient: 'Who would you like to send money to?',
        enterAmount: 'Select transfer amount',
        maxTopupHint: 'You can send up to {n} Baht',
        confirm: 'Confirm',
        confirmTitle: 'Review Transfer',
        confirmBtn: 'Confirm Transfer',
        fromLabel: 'From',
        toLabel: 'To',
        amountLabel: 'Amount',
        processing: 'Processing…',
        successTitle: 'Transfer Successful',
        successDate: 'Date & Time',
        backToBalance: 'Back to Balance',
        failTitle: 'Transfer Failed',
        retry: 'Try Again',
        close: 'Close',
    },
    TH: {
        title: 'โอนเงินให้ครอบครัว',
        back: 'กลับ',
        selectRecipient: 'ต้องการโอนเงินให้ใคร?',
        enterAmount: 'เลือกจำนวนเงินที่ต้องการโอน',
        maxTopupHint: 'โอนได้สูงสุด {n} บาท',
        confirm: 'ยืนยัน',
        confirmTitle: 'ตรวจสอบรายการโอนเงิน',
        confirmBtn: 'ยืนยันการโอนเงิน',
        fromLabel: 'จาก',
        toLabel: 'ถึง',
        amountLabel: 'จำนวนเงิน',
        processing: 'กำลังดำเนินการ…',
        successTitle: 'โอนเงินสำเร็จ',
        successDate: 'วันที่และเวลาทำรายการ',
        backToBalance: 'กลับไปหน้าหลัก',
        failTitle: 'โอนเงินไม่สำเร็จ',
        retry: 'ลองอีกครั้ง',
        close: 'ปิด',
    },
};

const currT = computed(() => t[store.language as 'EN' | 'TH']);

const maxHintText = computed(() => currT.value.maxTopupHint.replace('{n}', effectiveMax.value.toLocaleString()));
</script>

<template>
    <div class="kiosk-container transfer-view">
        <!-- Header -->
        <div class="header-section" v-if="step !== 'success' && step !== 'fail'">
            <button class="back-btn" @click="handleHeaderBack">
                <ChevronLeft :size="32" />
                <span>{{ currT.back }}</span>
            </button>
            <h2>{{ currT.title }}</h2>
            <button class="logout-btn" @click="handleLogout">
                <LogOut :size="28" />
            </button>
        </div>

        <!-- Wallet Info Bar -->
        <div v-if="fromWallet && step !== 'success' && step !== 'fail'" class="wallet-bar"
            :style="{ background: fromWallet.colorTheme }">
            <div class="wallet-bar-name">{{ fromWallet.holderName }}</div>
            <div class="wallet-bar-balance">
                <span class="wallet-bar-label">{{ currT.fromLabel }}</span>
                <span class="wallet-bar-amount">฿{{ formatCurrency(fromWallet.balance) }}</span>
            </div>
        </div>

        <!-- Step 1: Recipient Selection -->
        <div v-if="step === 'recipient'" class="recipient-list">
            <p class="sub-heading">{{ currT.selectRecipient }}</p>

            <button v-for="child in children" :key="child.id" class="recipient-item" @click="selectChild(child.id)">
                <div class="recipient-left">
                    <div class="recipient-avatar">
                        <img v-if="child.photoUrl" :src="child.photoUrl" class="avatar-photo-sm" alt="photo" />
                        <User v-else :size="28" />
                    </div>
                    <div class="recipient-info">
                        <span class="recipient-name">{{ child.holderName }}</span>
                        <span class="recipient-balance">฿{{ formatCurrency(child.balance) }}</span>
                    </div>
                </div>
                <ChevronRight :size="24" class="chevron" />
            </button>
        </div>

        <!-- Step 2: Amount selection -->
        <div v-if="step === 'amount'" class="amount-section">
            <p class="amount-heading">{{ currT.enterAmount }}</p>
            <div class="amount-display-card">
                <div class="amount-display" :class="{ 'has-value': amountNumber > 0 }">
                    {{ formattedAmount }}
                </div>
                <p class="max-hint">{{ maxHintText }}</p>
            </div>

            <div class="shortcut-grid">
                <button v-for="s in SHORTCUTS" :key="s" type="button" class="shortcut-btn"
                    :class="{ active: amountNumber === s }" :disabled="s > effectiveMax" @click="selectShortcut(s)">
                    ฿{{ s.toLocaleString() }}
                </button>
            </div>

            <div class="amount-footer">
                <button class="kiosk-btn btn-secondary" @click="step = 'recipient'">
                    <ChevronLeft :size="24" />
                    <span>{{ currT.back }}</span>
                </button>
                <button class="kiosk-btn btn-primary" :disabled="!isAmountValid" @click="confirmAmount">
                    <span>{{ currT.confirm }}</span>
                </button>
            </div>
        </div>

        <!-- Step 3: Confirm -->
        <div v-if="step === 'confirm'" class="confirm-section">
            <p class="amount-heading">{{ currT.confirmTitle }}</p>

            <div class="confirm-card">
                <div class="confirm-row">
                    <span class="confirm-label">{{ currT.fromLabel }}</span>
                    <span class="confirm-value">{{ fromWallet?.holderName }}</span>
                </div>
                <div class="confirm-balance-change">
                    <span>฿{{ formatCurrency(fromWallet?.balance ?? 0) }}</span>
                    <ArrowLeftRight :size="16" />
                    <span>฿{{ formatCurrency(fromBalanceAfter) }}</span>
                </div>

                <div class="confirm-divider"></div>

                <div class="confirm-row">
                    <span class="confirm-label">{{ currT.toLabel }}</span>
                    <span class="confirm-value">{{ selectedChild?.holderName }}</span>
                </div>
                <div class="confirm-balance-change">
                    <span>฿{{ formatCurrency(selectedChild?.balance ?? 0) }}</span>
                    <ArrowLeftRight :size="16" />
                    <span class="positive">฿{{ formatCurrency(toBalanceAfter) }}</span>
                </div>
            </div>

            <div class="confirm-amount-box">
                <span class="confirm-amount-label">{{ currT.amountLabel }}</span>
                <span class="confirm-amount">฿{{ formattedAmount }}</span>
            </div>

            <div class="amount-footer">
                <button class="kiosk-btn btn-secondary" :disabled="isProcessing" @click="step = 'amount'">
                    <ChevronLeft :size="24" />
                    <span>{{ currT.back }}</span>
                </button>
                <button class="kiosk-btn btn-primary" :disabled="isProcessing" @click="submitTransfer">
                    <span>{{ isProcessing ? currT.processing : currT.confirmBtn }}</span>
                </button>
            </div>
        </div>

        <!-- Step 4: Success -->
        <div v-if="step === 'success'" class="result-screen success-screen">
            <div class="result-icon success-icon-wrap">
                <CheckCircle2 :size="80" />
            </div>
            <h2 class="result-title">{{ currT.successTitle }}</h2>
            <div class="result-details">
                <div class="result-row">
                    <span class="result-label">{{ currT.toLabel }}</span>
                    <span class="result-value">{{ successChildName }}</span>
                </div>
                <div class="result-row">
                    <span class="result-label">{{ currT.successDate }}</span>
                    <span class="result-value">{{ nowFormatted }}</span>
                </div>
            </div>
            <div class="result-amount-box">
                <span class="result-amount">฿{{ formatCurrency(successAmount) }}</span>
            </div>

            <button class="kiosk-btn btn-primary" style="margin-top: 1.5rem;" @click="goBackToBalance">
                {{ currT.backToBalance }}
            </button>
        </div>

        <!-- Step 5: Failure -->
        <div v-if="step === 'fail'" class="result-screen fail-screen">
            <div class="fail-modal">
                <div class="result-icon fail-icon-wrap">
                    <XCircle :size="64" />
                </div>
                <h3 class="fail-title">{{ currT.failTitle }}</h3>
                <p class="fail-message">{{ failMessage }}</p>
                <div class="fail-actions">
                    <button class="kiosk-btn btn-primary" @click="step = 'confirm'">
                        {{ currT.retry }}
                    </button>
                    <button class="kiosk-btn btn-secondary" @click="goBackToBalance">
                        {{ currT.close }}
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.transfer-view {
    padding: 1.5rem 2rem;
    justify-content: flex-start;
    gap: 1rem;
}

.header-section {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.back-btn {
    background: none;
    border: none;
    color: var(--text-color);
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.25rem;
    font-weight: 700;
    cursor: pointer;
}

.logout-btn {
    background: none;
    border: 2px solid var(--text-muted);
    color: var(--text-color);
    width: 52px;
    height: 52px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    opacity: 0.7;
}

.logout-btn:hover {
    opacity: 1;
}

/* Wallet Bar */
.wallet-bar {
    width: 100%;
    color: white;
    border-radius: 1.25rem;
    padding: 1.75rem 2rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.wallet-bar-name {
    font-weight: 800;
    font-size: 1.6rem;
}

.wallet-bar-balance {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
}

.wallet-bar-label {
    font-size: 0.9rem;
    opacity: 0.8;
}

.wallet-bar-amount {
    font-size: 2.2rem;
    font-weight: 800;
}

/* Recipient list */
.recipient-list {
    width: 100%;
    flex: 1;
}

.sub-heading {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-muted);
    margin-bottom: 1.5rem;
}

.recipient-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 1.25rem 1.5rem;
    background: var(--card-bg);
    border: 2px solid rgba(212, 54, 42, 0.15);
    border-radius: 1.25rem;
    margin-bottom: 0.75rem;
    cursor: pointer;
    transition: transform 0.1s;
    color: var(--text-color);
}

.recipient-item:active {
    transform: scale(0.98);
}

.recipient-left {
    display: flex;
    align-items: center;
    gap: 1rem;
}

.recipient-avatar {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
}

.avatar-photo-sm {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.recipient-info {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
}

.recipient-name {
    font-size: 1.3rem;
    font-weight: 700;
}

.recipient-balance {
    font-size: 0.95rem;
    color: var(--text-muted);
}

.chevron {
    color: var(--text-muted);
    opacity: 0.5;
}

/* Amount section (shared look with Top-up) */
.amount-section,
.confirm-section {
    width: 100%;
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
}

.amount-heading {
    width: 100%;
    text-align: center;
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--text-color);
    margin: 0;
}

.amount-display-card {
    width: 100%;
    background: var(--card-bg);
    border-radius: 1.25rem;
    padding: 1rem 1.5rem 0.75rem;
    box-shadow: var(--shadow);
    text-align: center;
    border: 2px solid rgba(0, 0, 0, 0.05);
}

.amount-display {
    font-size: 3.5rem;
    font-weight: 800;
    color: var(--text-muted);
    transition: color 0.2s;
    line-height: 1;
}

.amount-display.has-value {
    color: var(--text-color);
}

.max-hint {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-top: 0.25rem;
}

.shortcut-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.75rem;
    width: 100%;
    flex: 1;
    align-content: center;
}

.shortcut-btn {
    min-height: 5.5rem;
    padding: 1rem 0.5rem;
    border-radius: 1.25rem;
    border: 2px solid rgba(0, 0, 0, 0.12);
    background: var(--card-bg);
    color: var(--text-color);
    font-size: 1.75rem;
    font-weight: 800;
    cursor: pointer;
    transition: all 0.15s;
    box-shadow: var(--shadow);
}

.shortcut-btn.active,
.shortcut-btn:active:not(:disabled) {
    background: var(--primary);
    color: white;
    border-color: var(--primary);
    transform: scale(0.98);
}

.shortcut-btn:disabled {
    opacity: 0.35;
    pointer-events: none;
}

.amount-footer {
    display: flex;
    gap: 1rem;
    width: 100%;
    justify-content: center;
    margin-top: 0.5rem;
}

.amount-footer .kiosk-btn {
    flex: 1;
}

.kiosk-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

/* Confirm step */
.confirm-card {
    width: 100%;
    background: var(--card-bg);
    border-radius: 1.25rem;
    padding: 1.5rem;
    box-shadow: var(--shadow);
    border: 2px solid rgba(0, 0, 0, 0.05);
}

.confirm-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 1.1rem;
}

.confirm-label {
    color: var(--text-muted);
    font-weight: 600;
}

.confirm-value {
    font-weight: 800;
}

.confirm-balance-change {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
    color: var(--text-muted);
    font-size: 0.95rem;
    margin-top: 0.25rem;
}

.confirm-balance-change .positive {
    color: #16a34a;
    font-weight: 700;
}

.confirm-divider {
    height: 1px;
    background: rgba(0, 0, 0, 0.08);
    margin: 1rem 0;
}

.confirm-amount-box {
    width: 100%;
    background: var(--card-bg);
    border-radius: 1.25rem;
    padding: 1rem 1.5rem;
    box-shadow: var(--shadow);
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.confirm-amount-label {
    font-size: 0.9rem;
    color: var(--text-muted);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.confirm-amount {
    font-size: 2.5rem;
    font-weight: 800;
    color: var(--primary);
}

/* Result screens (shared look with Top-up) */
.result-screen {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: 2rem;
}

.success-screen {
    text-align: center;
}

.success-icon-wrap {
    color: #16a34a;
    margin-bottom: 1rem;
}

.result-title {
    font-size: 2rem;
    font-weight: 800;
    margin-bottom: 1.5rem;
}

.result-details {
    width: 100%;
    max-width: 400px;
    margin-bottom: 1rem;
}

.result-row {
    display: flex;
    justify-content: space-between;
    padding: 0.5rem 0;
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
    font-size: 1rem;
}

.result-label {
    color: var(--text-muted);
}

.result-value {
    font-weight: 700;
}

.result-amount-box {
    margin-top: 0.5rem;
}

.result-amount {
    font-size: 3rem;
    font-weight: 800;
    color: #16a34a;
}

.fail-screen {
    text-align: center;
}

.fail-modal {
    background: var(--card-bg);
    border-radius: 2rem;
    padding: 2.5rem 2rem;
    box-shadow: var(--shadow);
    max-width: 420px;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
}

.fail-icon-wrap {
    color: #dc2626;
    margin-bottom: 1rem;
}

.fail-title {
    font-size: 1.5rem;
    font-weight: 800;
    margin-bottom: 0.75rem;
    color: var(--text-color);
}

.fail-message {
    font-size: 1rem;
    font-weight: 600;
    color: #dc2626;
    margin-bottom: 0.5rem;
    word-break: break-word;
}

.fail-actions {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
    margin-top: 1rem;
}
</style>
