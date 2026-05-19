<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useKioskStore } from '../stores/kioskStore';
import { ChevronLeft, ChevronRight, Banknote, QrCode, CreditCard, Smartphone, CheckCircle2, AlertTriangle, XCircle, Timer, ArrowLeft } from 'lucide-vue-next';
import { ref, computed, onUnmounted } from 'vue';

const router = useRouter();
const store = useKioskStore();

if (!store.isAuthenticated) {
  router.push('/');
}

const t = {
  EN: {
    title: 'Top-up',
    sub: 'Select payment method',
    promptpay: 'PromptPay',
    cash: 'Cash',
    back: 'Back',
    scan: 'Scan the QR code below to top-up',
    amount: 'Amount will be credited automatically',
    demo: 'This is a demo screen',
    backToMenu: 'Back to methods',
    enterAmount: 'Enter top-up amount',
    maxAmount: 'Max 5,000 Baht per transaction',
    confirm: 'Confirm',
    clear: 'C',
    baht: 'Baht',
    currentBalance: 'Current Balance',
    successTitle: 'Top-up Successful',
    successDate: 'Date & Time',
    successMethod: 'Method',
    successAmount: 'Amount',
    backToBalance: 'Back to Balance',
    failTitle: 'Top-up Failed',
    failNoInternet: 'Unable to connect to the internet',
    failNoInternetSub: 'Please collect your money and try again.',
    failServer: 'An error occurred',
    failServerSub: 'Please collect your money and contact support.',
    failServerCode: 'Service Unavailable',
    retry: 'Try Again',
    close: 'Close',
    minAmount: 'Minimum top-up: 1 Baht',
    timeRemaining: 'Time remaining',
    qrExpired: 'QR Code has expired',
    qrExpiredSub: 'Please try again to generate a new QR code.',
    cancelTopup: 'Cancel Top-up',
    changeMethod: 'Change Payment Method',
    seconds: 'sec',
    cashConfirmTitle: 'Proceed to Cashier',
    cashConfirmDesc: 'Please show this screen to the cashier and pay the amount below.',
    cashConfirmNote: 'The cashier will top up your wallet after receiving payment.',
  },
  TH: {
    title: 'เติมเงิน',
    sub: 'เลือกช่องทางการเติมเงิน',
    promptpay: 'พร้อมเพย์',
    cash: 'เงินสด',
    back: 'กลับ',
    scan: 'สแกน QR Code ด้านล่างเพื่อเติมเงิน',
    amount: 'ยอดเงินจะถูกเพิ่มโดยอัตโนมัติ',
    demo: 'นี่คือหน้าจอตัวอย่าง',
    backToMenu: 'กลับเลือกช่องทาง',
    enterAmount: 'กรอกจำนวนเงินที่ต้องการเติม',
    maxAmount: 'เติมได้สูงสุด 5,000 บาท / ครั้ง',
    confirm: 'ยืนยัน',
    clear: 'C',
    baht: 'บาท',
    currentBalance: 'ยอดคงเหลือปัจจุบัน',
    successTitle: 'เติมเงินสำเร็จ',
    successDate: 'วันที่และเวลาทำรายการ',
    successMethod: 'ช่องทาง',
    successAmount: 'จำนวนเงิน',
    backToBalance: 'กลับไปหน้าเติมเงิน',
    failTitle: 'เกิดข้อผิดพลาด',
    failNoInternet: 'ไม่สามารถเชื่อมต่ออินเทอร์เน็ตได้',
    failNoInternetSub: 'กรุณารับเงินคืน และลองทำรายการใหม่อีกครั้ง',
    failServer: 'เกิดข้อผิดพลาด',
    failServerSub: 'กรุณารับเงินคืน และติดต่อผู้ดูแลระบบ',
    failServerCode: '503 Service Unavailable',
    retry: 'ลองอีกครั้ง',
    close: 'ปิด',
    minAmount: 'เติมเงินขั้นต่ำ 1 บาท',
    timeRemaining: 'เวลาที่เหลือ',
    qrExpired: 'QR Code หมดอายุ',
    qrExpiredSub: 'กรุณาทำรายการใหม่อีกครั้ง',
    cancelTopup: 'ยกเลิกการเติมเงิน',
    changeMethod: 'เปลี่ยนช่องทางชำระ',
    seconds: 'วินาที',
    cashConfirmTitle: 'ชำระเงินที่แคชเชียร์',
    cashConfirmDesc: 'กรุณาแสดงหน้าจอนี้ให้แคชเชียร์และชำระจำนวนเงินด้านล่าง',
    cashConfirmNote: 'แคชเชียร์จะเติมเงินเข้าวอลเล็ตของคุณหลังจากรับเงินแล้ว',
  }
};

const methods = [
  { key: 'promptpay', logo: '/images/payments/promptpay.png', colorBg: '#ffffff', colorText: '#0284c7', border: '#bae6fd' },
  { key: 'cash', icon: 'banknote', colorBg: '#f0fdf4', colorText: '#16a34a', border: '#86efac' },
];

type Step = 'methods' | 'amount' | 'qr' | 'cash-confirm' | 'success' | 'fail';

const selectedMethod = ref<string | null>(null);
const currentStep = ref<Step>('methods');
const enteredAmount = ref('0');
const failType = ref<'internet' | 'server'>('internet');

const MAX_AMOUNT = 5000;
const SHORTCUTS = [50, 100, 200, 500, 1000];

const amountNumber = computed(() => {
  const n = parseFloat(enteredAmount.value);
  return isNaN(n) ? 0 : n;
});

const isAmountValid = computed(() => {
  return amountNumber.value > 0 && amountNumber.value <= MAX_AMOUNT;
});

const formattedAmount = computed(() => {
  return new Intl.NumberFormat(store.language === 'TH' ? 'th-TH' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amountNumber.value);
});

const currentWallet = computed(() => store.currentWallet);

const formatCurrency = (val: number) => {
  return new Intl.NumberFormat(store.language === 'TH' ? 'th-TH' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(val);
};

// --- Actions ---
const selectMethod = (key: string) => {
  selectedMethod.value = key;
  enteredAmount.value = '0';
  currentStep.value = 'amount';
};

const pressKey = (key: string) => {
  if (key === 'C') {
    enteredAmount.value = '0';
    return;
  }
  if (key === '00') {
    if (enteredAmount.value === '0') return;
    const newVal = enteredAmount.value + '00';
    if (parseFloat(newVal) > MAX_AMOUNT) return;
    enteredAmount.value = newVal;
    return;
  }
  if (enteredAmount.value === '0') {
    if (key === '0') return; 
    enteredAmount.value = key;
  } else {
    const newVal = enteredAmount.value + key;
    if (parseFloat(newVal) > MAX_AMOUNT) return;
    enteredAmount.value = newVal;
  }
};

const selectShortcut = (val: number) => {
  enteredAmount.value = val.toString();
};

const confirmAmount = () => {
  if (!isAmountValid.value) return;
  if (selectedMethod.value === 'cash') {
    currentStep.value = 'cash-confirm';
  } else {
    currentStep.value = 'qr';
    startQrTimer();
  }
};

// --- QR Timer (120 seconds) ---
const QR_TIMEOUT = 120;
const qrTimeLeft = ref(QR_TIMEOUT);
let qrTimerInterval: number | null = null;

const qrProgress = computed(() => qrTimeLeft.value / QR_TIMEOUT);
const isQrExpired = computed(() => qrTimeLeft.value <= 0);

const startQrTimer = () => {
  clearQrTimer();
  qrTimeLeft.value = QR_TIMEOUT;
  qrTimerInterval = window.setInterval(() => {
    qrTimeLeft.value--;
    if (qrTimeLeft.value <= 0) {
      clearQrTimer();
    }
  }, 1000);
};

const clearQrTimer = () => {
  if (qrTimerInterval) {
    clearInterval(qrTimerInterval);
    qrTimerInterval = null;
  }
};

onUnmounted(() => {
  clearQrTimer();
});

// Simulate top-up result (demo)
const simulateSuccess = () => {
  currentStep.value = 'success';
};

const simulateFail = (type: 'internet' | 'server') => {
  failType.value = type;
  currentStep.value = 'fail';
};

const backToMethods = () => {
  selectedMethod.value = null;
  currentStep.value = 'methods';
  enteredAmount.value = '0';
  clearQrTimer();
};

const backToAmount = () => {
  currentStep.value = 'amount';
  clearQrTimer();
};

const goBack = () => {
  clearQrTimer();
  router.push('/balance');
};

const goBackToBalance = () => {
  clearQrTimer();
  router.push('/balance');
};

const cancelTopup = () => {
  clearQrTimer();
  store.logout();
  router.push('/');
};

const retryTopup = () => {
  currentStep.value = 'amount';
  enteredAmount.value = '0';
};

const selectedColor = (prop: 'colorBg' | 'colorText' | 'border') => {
  const m = methods.find(m => m.key === selectedMethod.value);
  return m ? m[prop] : '#e0f2fe';
};

const nowFormatted = computed(() => {
  const d = new Date();
  const day = d.getDate().toString().padStart(2, '0');
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const monthsEN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = store.language === 'TH' ? months[d.getMonth()] : monthsEN[d.getMonth()];
  const year = store.language === 'TH' ? d.getFullYear() + 543 : d.getFullYear();
  const h = d.getHours().toString().padStart(2, '0');
  const min = d.getMinutes().toString().padStart(2, '0');
  return `${day} ${m} ${year} ${h}:${min}`;
});

const currT = computed(() => t[store.language as 'EN' | 'TH']);
</script>

<template>
  <div class="kiosk-container topup-view">
    <!-- Header -->
    <div class="header-section" v-if="currentStep !== 'success' && currentStep !== 'fail'">
      <button class="back-btn" @click="currentStep === 'methods' ? goBack() : currentStep === 'cash-confirm' ? backToMethods() : currentStep === 'qr' ? backToAmount() : currentStep === 'amount' ? backToMethods() : goBack()">
        <ChevronLeft :size="32" />
        <span>{{ currT.back }}</span>
      </button>
      <h2>{{ currT.title }}</h2>
      <div style="width: 100px"></div>
    </div>

    <!-- Wallet Info Bar (shown in amount & qr steps) -->
    <div v-if="currentWallet && (currentStep === 'amount' || currentStep === 'qr' || currentStep === 'cash-confirm')" class="wallet-bar" :style="{ background: currentWallet.colorTheme }">
      <div class="wallet-bar-name">{{ currentWallet.holderName }}</div>
      <div class="wallet-bar-balance">
        <span class="wallet-bar-label">{{ currT.currentBalance }}</span>
        <span class="wallet-bar-amount">{{ formatCurrency(currentWallet.balance) }}</span>
      </div>
    </div>

    <!-- Step 1: Method Selection -->
    <div v-if="currentStep === 'methods'" class="method-list">
      <p class="sub-heading">{{ currT.sub }}</p>

      <button
        v-for="m in methods"
        :key="m.key"
        class="method-item"
        :style="{ borderColor: m.border }"
        @click="selectMethod(m.key)"
      >
        <div class="method-left">
          <div class="method-icon" :style="{ background: m.colorBg, color: m.colorText }">
            <img v-if="(m as any).logo" :src="(m as any).logo" class="payment-logo" />
            <template v-else>
              <Banknote v-if="(m as any).icon === 'banknote'" :size="24" />
              <QrCode v-else-if="(m as any).icon === 'qr'" :size="24" />
              <CreditCard v-else :size="24" />
            </template>
          </div>
          <span>{{ (currT as any)[m.key] }}</span>
        </div>
        <ChevronRight :size="24" class="chevron" />
      </button>
    </div>

    <!-- Step 2: Amount Input -->
    <div v-if="currentStep === 'amount'" class="amount-section">
      <div class="amount-display-card">
        <div class="amount-display" :class="{ 'has-value': amountNumber > 0 }">
          {{ formattedAmount }}
        </div>
        <p class="max-hint">{{ currT.maxAmount }}</p>
      </div>

      <!-- Shortcut Buttons -->
      <div class="shortcut-row">
        <button
          v-for="s in SHORTCUTS"
          :key="s"
          class="shortcut-btn"
          :class="{ active: amountNumber === s }"
          @click="selectShortcut(s)"
        >
          {{ s.toLocaleString() }}
        </button>
      </div>

      <!-- Numpad -->
      <div class="numpad">
        <button v-for="k in ['7','8','9','4','5','6','1','2','3','0','00','C']" :key="k" class="num-key" :class="{ 'key-clear': k === 'C' }" @click="pressKey(k)">
          {{ k }}
        </button>
      </div>

      <!-- Confirm -->
      <div class="amount-footer">
        <button class="kiosk-btn btn-secondary" @click="backToMethods" style="max-width: 180px;">
          <ChevronLeft :size="24" />
          <span>{{ currT.back }}</span>
        </button>
        <button class="kiosk-btn btn-primary" :disabled="!isAmountValid" @click="confirmAmount" style="max-width: 260px;">
          <span>{{ currT.confirm }}</span>
        </button>
      </div>
    </div>

    <!-- Step 3: QR Code Screen -->
    <div v-if="currentStep === 'qr'" class="qr-section">
      <div class="qr-card" :style="{ borderColor: selectedColor('border') }">
        <h3 class="qr-method-name">{{ (currT as any)[selectedMethod as any] }}</h3>
        <div class="qr-amount-badge">฿{{ formattedAmount }}</div>
        
        <!-- QR Code with overlay when expired -->
        <div class="qr-wrapper">
          <div class="qr-placeholder" :class="{ expired: isQrExpired }" :style="{ backgroundColor: selectedColor('colorBg'), color: selectedColor('colorText') }">
            <QrCode :size="160" />
          </div>
          <div v-if="isQrExpired" class="qr-expired-overlay">
            <XCircle :size="48" />
            <span>{{ currT.qrExpired }}</span>
          </div>
        </div>

        <!-- Countdown Timer -->
        <div class="qr-timer" :class="{ 'timer-warning': qrTimeLeft <= 30, 'timer-danger': qrTimeLeft <= 10 }">
          <Timer :size="18" />
          <span>{{ currT.timeRemaining }}: </span>
          <span class="timer-value">{{ Math.floor(qrTimeLeft / 60) }}:{{ (qrTimeLeft % 60).toString().padStart(2, '0') }}</span>
        </div>

        <!-- Timer Progress Bar -->
        <div class="timer-bar">
          <div class="timer-bar-fill" :style="{ width: (qrProgress * 100) + '%' }" :class="{ 'bar-warning': qrTimeLeft <= 30, 'bar-danger': qrTimeLeft <= 10 }"></div>
        </div>

        <p v-if="!isQrExpired" class="scan-text">{{ currT.scan }}</p>
        <p v-if="!isQrExpired" class="sub-text">{{ currT.amount }}</p>
        <p v-if="isQrExpired" class="expired-sub-text">{{ currT.qrExpiredSub }}</p>

        <!-- Min amount info -->
        <p class="min-amount-hint">{{ currT.minAmount }}</p>
      </div>

      <!-- Action Buttons -->
      <div class="qr-actions">
        <button class="kiosk-btn btn-secondary qr-action-btn" @click="backToMethods">
          <ArrowLeft :size="20" />
          <span>{{ currT.changeMethod }}</span>
        </button>
        <button class="kiosk-btn btn-danger qr-action-btn" @click="cancelTopup">
          <XCircle :size="20" />
          <span>{{ currT.cancelTopup }}</span>
        </button>
      </div>

      <!-- Demo buttons to simulate success/fail -->
      <div class="demo-actions">
        <div class="demo-notice">
          <Smartphone :size="20" />
          <span>{{ currT.demo }}</span>
        </div>
        <div class="demo-buttons">
          <button class="demo-btn success" @click="simulateSuccess">✓ Success</button>
          <button class="demo-btn fail" @click="simulateFail('internet')">✗ No Internet</button>
          <button class="demo-btn fail" @click="simulateFail('server')">✗ Server Error</button>
        </div>
      </div>
    </div>

    <!-- Step 3b: Cash Confirm -->
    <div v-if="currentStep === 'cash-confirm'" class="cash-confirm-section">
      <div class="cash-confirm-card">
        <div class="cash-icon">
          <Banknote :size="64" class="cash-icon-svg" />
        </div>
        <h3 class="cash-title">{{ currT.cashConfirmTitle }}</h3>
        <p class="cash-desc">{{ currT.cashConfirmDesc }}</p>
        <div class="cash-amount-display">฿{{ formattedAmount }}</div>
        <p class="cash-note">{{ currT.cashConfirmNote }}</p>
        <div class="qr-actions">
          <button class="kiosk-btn btn-secondary qr-action-btn" @click="backToMethods">
            <ArrowLeft :size="20" />
            <span>{{ currT.changeMethod }}</span>
          </button>
          <button class="kiosk-btn btn-danger qr-action-btn" @click="cancelTopup">
            <XCircle :size="20" />
            <span>{{ currT.cancelTopup }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Step 4: Success Screen -->
    <div v-if="currentStep === 'success'" class="result-screen success-screen">
      <div class="result-icon success-icon-wrap">
        <CheckCircle2 :size="80" />
      </div>
      <h2 class="result-title">{{ currT.successTitle }}</h2>
      <div class="result-details">
        <div class="result-row">
          <span class="result-label">{{ currT.successDate }}</span>
          <span class="result-value">{{ nowFormatted }}</span>
        </div>
        <div class="result-row">
          <span class="result-label">{{ currT.successMethod }}</span>
          <span class="result-value">{{ selectedMethod ? (currT as any)[selectedMethod] : '' }}</span>
        </div>
      </div>
      <div class="result-amount-box">
        <span class="result-amount">฿{{ formattedAmount }}</span>
      </div>
      <button class="kiosk-btn btn-primary" style="margin-top: 2rem;" @click="goBackToBalance">
        {{ currT.backToBalance }}
      </button>
    </div>

    <!-- Step 5: Failure Screen -->
    <div v-if="currentStep === 'fail'" class="result-screen fail-screen">
      <div class="fail-modal">
        <div class="result-icon fail-icon-wrap">
          <AlertTriangle v-if="failType === 'internet'" :size="64" />
          <XCircle v-else :size="64" />
        </div>
        <h3 class="fail-title">{{ currT.failTitle }}</h3>
        <p class="fail-message">
          {{ failType === 'internet' ? currT.failNoInternet : currT.failServer }}
        </p>
        <p class="fail-sub">
          {{ failType === 'internet' ? currT.failNoInternetSub : currT.failServerSub }}
        </p>
        <p v-if="failType === 'server'" class="fail-code">{{ currT.failServerCode }}</p>
        <div class="fail-actions">
          <button class="kiosk-btn btn-primary" @click="retryTopup" v-if="failType === 'internet'">
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
.topup-view {
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

/* Wallet Bar */
.wallet-bar {
  width: 100%;
  color: white;
  border-radius: 1rem;
  padding: 0.75rem 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.wallet-bar-name {
  font-weight: 800;
  font-size: 1.1rem;
}
.wallet-bar-balance {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.wallet-bar-label {
  font-size: 0.75rem;
  opacity: 0.8;
}
.wallet-bar-amount {
  font-size: 1.3rem;
  font-weight: 800;
}

/* Method List */
.method-list {
  width: 100%;
  flex: 1;
}

.sub-heading {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 1.5rem;
}

.method-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 1.25rem 1.5rem;
  background: var(--card-bg);
  border: 2px solid;
  border-radius: 1.25rem;
  margin-bottom: 0.75rem;
  cursor: pointer;
  transition: transform 0.1s;
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--text-color);
}

.method-item:active {
  transform: scale(0.98);
}

.method-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.method-icon {
  width: 48px;
  height: 48px;
  border-radius: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}

.payment-logo {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.chevron {
  color: var(--text-muted);
  opacity: 0.5;
}

/* --- Amount Section --- */
.amount-section {
  width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.amount-display-card {
  width: 100%;
  background: var(--card-bg);
  border-radius: 1.25rem;
  padding: 1.25rem 1.5rem;
  box-shadow: var(--shadow);
  text-align: center;
  border: 2px solid rgba(0,0,0,0.05);
}

.amount-display {
  font-size: 3rem;
  font-weight: 800;
  color: var(--text-muted);
  transition: color 0.2s;
}
.amount-display.has-value {
  color: var(--text-color);
}

.max-hint {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-top: 0.25rem;
}

/* Shortcuts */
.shortcut-row {
  display: flex;
  gap: 0.5rem;
  width: 100%;
  justify-content: center;
  flex-wrap: wrap;
}

.shortcut-btn {
  padding: 0.5rem 1.25rem;
  border-radius: 2rem;
  border: 2px solid var(--text-muted);
  background: var(--card-bg);
  color: var(--text-color);
  font-size: 1.1rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s;
}
.shortcut-btn.active,
.shortcut-btn:active {
  background: var(--primary);
  color: white;
  border-color: var(--primary);
}

/* Numpad */
.numpad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
  width: 100%;
  max-width: 400px;
}

.num-key {
  height: 3.5rem;
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 0.75rem;
  background: var(--card-bg);
  color: var(--text-color);
  font-size: 1.5rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.1s;
  display: flex;
  align-items: center;
  justify-content: center;
}
.num-key:active {
  background: #e2e8f0;
}
.key-clear {
  color: #ef4444;
  font-weight: 800;
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

/* --- QR Section --- */
.qr-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
}

.qr-card {
  background: var(--card-bg);
  border-radius: 2rem;
  padding: 2rem;
  box-shadow: var(--shadow);
  text-align: center;
  border: 3px solid;
  max-width: 450px;
  width: 100%;
}

.qr-method-name {
  font-size: 1.4rem;
  font-weight: 800;
  margin-bottom: 0.5rem;
}

.qr-amount-badge {
  font-size: 2rem;
  font-weight: 800;
  color: var(--primary);
  margin-bottom: 1rem;
}

.qr-placeholder {
  width: 200px;
  height: 200px;
  border-radius: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 1rem;
}

.scan-text {
  font-size: 1.1rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
}

.sub-text {
  color: var(--text-muted);
  font-size: 0.95rem;
}

/* QR Timer */
.qr-wrapper {
  position: relative;
  display: inline-block;
  margin-bottom: 0.75rem;
}

.qr-placeholder.expired {
  opacity: 0.15;
  filter: blur(2px);
}

.qr-expired-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  color: #dc2626;
  font-weight: 700;
  font-size: 1rem;
  text-align: center;
}

.qr-timer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  font-size: 1rem;
  font-weight: 600;
  color: #16a34a;
  margin-bottom: 0.5rem;
  transition: color 0.3s;
}

.qr-timer.timer-warning {
  color: #d97706;
}

.qr-timer.timer-danger {
  color: #dc2626;
  animation: pulse-danger 1s infinite;
}

.timer-value {
  font-size: 1.2rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.timer-bar {
  width: 80%;
  height: 6px;
  background: #e2e8f0;
  border-radius: 3px;
  margin: 0 auto 1rem;
  overflow: hidden;
}

.timer-bar-fill {
  height: 100%;
  background: #16a34a;
  border-radius: 3px;
  transition: width 1s linear, background 0.3s;
}

.timer-bar-fill.bar-warning {
  background: #d97706;
}

.timer-bar-fill.bar-danger {
  background: #dc2626;
}

.min-amount-hint {
  margin-top: 0.75rem;
  font-size: 0.85rem;
  color: var(--text-muted);
  font-weight: 600;
  padding: 0.35rem 1rem;
  background: #f8fafc;
  border-radius: 0.5rem;
  display: inline-block;
}

.expired-sub-text {
  color: #dc2626;
  font-weight: 600;
  font-size: 0.95rem;
}

/* QR Action Buttons */
.qr-actions {
  display: flex;
  gap: 0.75rem;
  width: 100%;
  max-width: 450px;
  margin-top: 1.25rem;
}

.qr-action-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  font-size: 0.95rem;
  padding: 0.85rem 1rem;
}

.btn-danger {
  background: #fef2f2 !important;
  color: #dc2626 !important;
  border: 2px solid #fca5a5 !important;
}

.btn-danger:hover {
  background: #fee2e2 !important;
}

@keyframes pulse-danger {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* Demo actions */
.demo-actions {
  margin-top: 1.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.demo-notice {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-muted);
  opacity: 0.6;
  font-size: 0.9rem;
}

.demo-buttons {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  justify-content: center;
}

.demo-btn {
  padding: 0.5rem 1rem;
  border-radius: 0.75rem;
  border: 2px solid;
  font-weight: 700;
  font-size: 0.95rem;
  cursor: pointer;
  transition: transform 0.1s;
}
.demo-btn:active { transform: scale(0.95); }
.demo-btn.success {
  background: #dcfce7;
  color: #16a34a;
  border-color: #86efac;
}
.demo-btn.fail {
  background: #fef2f2;
  color: #dc2626;
  border-color: #fca5a5;
}

/* --- Result Screens --- */
.result-screen {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 2rem;
}

/* Success */
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
  border-bottom: 1px solid rgba(0,0,0,0.06);
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

/* Failure */
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
  font-size: 1.1rem;
  font-weight: 600;
  color: #dc2626;
  margin-bottom: 0.5rem;
}
.fail-sub {
  font-size: 0.95rem;
  color: var(--text-muted);
  margin-bottom: 0.75rem;
}
.fail-code {
  font-size: 0.9rem;
  color: #dc2626;
  font-weight: 700;
  margin-bottom: 1rem;
  padding: 0.25rem 0.75rem;
  background: #fef2f2;
  border-radius: 0.5rem;
}

.fail-actions {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
  margin-top: 1rem;
}

/* --- Cash Confirm Section --- */
.cash-confirm-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
}
.cash-confirm-card {
  background: var(--card-bg);
  border-radius: 2rem;
  padding: 2.5rem 2rem;
  box-shadow: var(--shadow);
  text-align: center;
  border: 3px solid #86efac;
  max-width: 450px;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}
.cash-icon { color: #16a34a; }
.cash-title { font-size: 1.6rem; font-weight: 800; }
.cash-desc { color: var(--text-muted); font-size: 1rem; }
.cash-amount-display {
  font-size: 3rem;
  font-weight: 800;
  color: #16a34a;
}
.cash-note {
  font-size: 0.9rem;
  color: var(--text-muted);
  padding: 0.75rem 1rem;
  background: #f0fdf4;
  border-radius: 0.75rem;
  width: 100%;
}
</style>
