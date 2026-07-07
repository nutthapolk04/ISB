<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useKioskStore } from '../stores/kioskStore';
import { ChevronLeft, ChevronRight, Banknote, QrCode, CreditCard, CheckCircle2, AlertTriangle, XCircle, Timer, ArrowLeft, LogOut, Printer } from 'lucide-vue-next';
import { ref, computed, onUnmounted, watch } from 'vue';
import { realApi } from '../api/realApi';
import { useBillAcceptor } from '../hooks/useBillAcceptor';
import { usePrinter } from '../hooks/usePrinter';
import { logKioskEvent } from '../lib/kioskLog';
import type { TopupReceiptData, ReceiptRow } from '../lib/escpos';
import QRCode from 'qrcode';

const router = useRouter();
const store = useKioskStore();

if (!store.isAuthenticated) {
  router.push('/');
}

const t = {
  EN: {
    title: 'Top-up',
    sub: 'Select payment method',
    promptpay: 'QR Code',
    cash: 'Cash',
    back: 'Back',
    scan: 'Scan the QR code below to top-up',
    amount: 'Amount will be credited automatically',
    demo: 'This is a demo screen',
    backToMenu: 'Back to methods',
    enterAmount: 'Select top-up amount',
    maxAmount: 'Max 50,000 Baht per transaction',
    maxTopupHint: 'Top up up to {n} Baht',
    limitReachedHint: 'Remaining limit is below the 100 Baht minimum',
    overpayCapExceeded: 'Accepting would exceed the 50,000 Baht limit',
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
    minAmount: 'Minimum top-up: 100 Baht',
    timeRemaining: 'Time remaining',
    qrExpired: 'QR Code has expired',
    qrExpiredSub: 'Please try again to generate a new QR code.',
    cancelTopup: 'Cancel Top-up',
    changeMethod: 'Change Payment Method',
    seconds: 'sec',
    cashConfirmTitle: 'Insert Cash',
    cashConfirmDesc: 'Insert banknotes into the machine one at a time.',
    cashConfirmNote: 'Bills are accepted automatically. Top-up completes when the target is reached.',
    cashTarget: 'Target amount',
    cashInserted: 'Inserted',
    cashRemaining: 'Remaining',
    cashOverpayTitle: 'Bill exceeds target',
    cashOverpayDesc: 'This bill would exceed your target amount. What would you like to do?',
    cashOverpayBill: 'Bill amount',
    cashOverpayWouldBe: 'Total if accepted',
    cashOverpayAccept: 'Accept overpay',
    cashOverpayReturn: 'Return bill',
    cashPartialHint: 'Press cancel to finish with the amount inserted.',
    cashCancelAttentionTitle: 'Cancel this top-up?',
    cashCancelAttentionDesc: 'Inserted banknotes cannot be returned as cash. The amount below will be credited to the student wallet immediately.',
    cashCancelAttentionAmount: 'Amount to credit',
    cashCancelConfirmBtn: 'Cancel and credit wallet',
    cashCancelDismissBtn: 'Keep inserting',
    processing: 'Processing…',
    failDetail: 'Error detail',
    receiptTitle: 'Receipt',
    receiptType: 'Top-up',
    receiptTxId: 'Transaction No.',
    receiptMember: 'Member',
    receiptDevice: 'Machine',
    receiptBalanceAfter: 'Remaining Balance',
    receiptThankYou: 'Thank you for using our service',
    receiptPoweredBy: 'This document is system-generated',
    printReceipt: 'Print Receipt',
    printing: 'Printing…',
    printed: 'Receipt printed',
    printFailed: 'Could not print receipt',
    reprint: 'Print again',
  },
  TH: {
    title: 'เติมเงิน',
    sub: 'เลือกช่องทางการเติมเงิน',
    promptpay: 'QR Code',
    cash: 'เงินสด',
    back: 'กลับ',
    scan: 'สแกน QR Code ด้านล่างเพื่อเติมเงิน',
    amount: 'ยอดเงินจะถูกเพิ่มโดยอัตโนมัติ',
    demo: 'นี่คือหน้าจอตัวอย่าง',
    backToMenu: 'กลับเลือกช่องทาง',
    enterAmount: 'เลือกจำนวนเงินที่ต้องการเติม',
    maxAmount: 'เติมได้สูงสุด 50,000 บาท / ครั้ง',
    maxTopupHint: 'เติมได้สูงสุด {n} บาท',
    limitReachedHint: 'วงเงินคงเหลือต่ำกว่าขั้นต่ำ 100 บาท',
    overpayCapExceeded: 'หากรับจะเกินวงเงิน 50,000 บาท',
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
    minAmount: 'เติมเงินขั้นต่ำ 100 บาท',
    timeRemaining: 'เวลาที่เหลือ',
    qrExpired: 'QR Code หมดอายุ',
    qrExpiredSub: 'กรุณาทำรายการใหม่อีกครั้ง',
    cancelTopup: 'ยกเลิกการเติมเงิน',
    changeMethod: 'เปลี่ยนช่องทางชำระ',
    seconds: 'วินาที',
    cashConfirmTitle: 'สอดเงินสด',
    cashConfirmDesc: 'สอดธนบัตรเข้าเครื่องทีละใบ',
    cashConfirmNote: 'เครื่องจะรับแบงค์อัตโนมัติ เติมเงินสำเร็จเมื่อครบยอดที่ต้องการ',
    cashTarget: 'ยอดที่ต้องการเติม',
    cashInserted: 'สอดแล้ว',
    cashRemaining: 'คงเหลือ',
    cashOverpayTitle: 'แบงค์เกินยอด',
    cashOverpayDesc: 'แบงค์นี้จะทำให้เกินยอดที่ต้องการ ต้องการทำอย่างไร?',
    cashOverpayBill: 'มูลค่าแบงค์',
    cashOverpayWouldBe: 'ยอดรวมถ้ารับ',
    cashOverpayAccept: 'รับเกินยอด',
    cashOverpayReturn: 'คืนแบงค์',
    cashPartialHint: 'กดยกเลิกเพื่อเติมเงินด้วยยอดที่สอดแล้ว',
    cashCancelAttentionTitle: 'ยกเลิกการเติมเงิน?',
    cashCancelAttentionDesc: 'เงินสดที่สอดแล้วไม่สามารถรับคืนได้ — ยอดด้านล่างจะถูกเติมเข้าวอเล็ตทันที',
    cashCancelAttentionAmount: 'ยอดที่จะเติมเข้าวอเล็ต',
    cashCancelConfirmBtn: 'ยืนยัน ยกเลิกและเติมเงิน',
    cashCancelDismissBtn: 'สอดเงินต่อ',
    processing: 'กำลังดำเนินการ…',
    failDetail: 'รายละเอียดข้อผิดพลาด',
    receiptTitle: 'ใบเสร็จรับเงิน',
    receiptType: 'เติมเงิน',
    receiptTxId: 'เลขที่รายการ',
    receiptMember: 'สมาชิก',
    receiptDevice: 'เครื่อง',
    receiptBalanceAfter: 'ยอดคงเหลือ',
    receiptThankYou: 'ขอบคุณที่ใช้บริการ',
    receiptPoweredBy: 'เอกสารออกจากระบบอัตโนมัติ',
    printReceipt: 'พิมพ์ใบเสร็จ',
    printing: 'กำลังพิมพ์…',
    printed: 'พิมพ์ใบเสร็จแล้ว',
    printFailed: 'พิมพ์ใบเสร็จไม่สำเร็จ',
    reprint: 'พิมพ์อีกครั้ง',
  }
};

const methods = [
  { key: 'promptpay', logo: '/images/payments/promptpay.png', colorBg: '#ffffff', colorText: '#0284c7', border: '#bae6fd' },
  { key: 'cash', icon: 'banknote', colorBg: '#f0fdf4', colorText: '#16a34a', border: '#86efac' },
];

type Step = 'methods' | 'amount' | 'qr' | 'cash-confirm' | 'success' | 'fail';

const selectedMethod = ref<string | null>(null);
const currentStep = ref<Step>('amount');
const enteredAmount = ref('0');
const failType = ref<'internet' | 'server'>('internet');
const failDetail = ref<string | null>(null);
const isProcessing = ref(false);
const creditedAmount = ref(0);
const qrDataUrl = ref('');
const qrLoading = ref(false);
const activeRefCode = ref<string | null>(null);
const showCashCancelConfirm = ref(false);
let pollInterval: number | null = null;

const MAX_AMOUNT = 50000;
const MIN_AMOUNT = 100;
const SHORTCUTS = [100, 200, 300, 500, 1000];

const amountNumber = computed(() => {
  const n = parseFloat(enteredAmount.value);
  return isNaN(n) ? 0 : n;
});

const isAmountValid = computed(() => {
  return amountNumber.value >= MIN_AMOUNT && amountNumber.value <= effectiveMax.value;
});

const formattedAmount = computed(() => {
  return new Intl.NumberFormat(store.language === 'TH' ? 'th-TH' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amountNumber.value);
});

const currentWallet = computed(() => store.currentWallet);

/** Wallet balance ceiling (THB). Top-up may not push the balance above this. */
const MAX_BALANCE = 50000;
/** Remaining room before hitting the cap, for the currently active wallet. */
const headroom = computed(() => Math.max(0, MAX_BALANCE - (store.currentWallet?.balance ?? 0)));
/** Effective per-transaction ceiling: the smaller of the per-txn max and the wallet headroom. */
const effectiveMax = computed(() => Math.min(MAX_AMOUNT, headroom.value));

const bill = useBillAcceptor();
const printer = usePrinter();

// --- Receipt printing ---
const receiptTxId = ref<number | null>(null);
const balanceBefore = ref(0);
type PrintState = 'idle' | 'printing' | 'done' | 'error';
const printState = ref<PrintState>('idle');
let autoPrinted = false;

/** Cash session is locked once any bill has been stacked — no back, logout, or method change. */
const cashLocked = computed(
  () => currentStep.value === 'cash-confirm' && bill.collectedThb.value > 0,
);

const formatCurrency = (val: number) => {
  return new Intl.NumberFormat(store.language === 'TH' ? 'th-TH' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(val);
};

// --- Actions ---
const selectMethod = async (key: string) => {
  selectedMethod.value = key;
  balanceBefore.value = store.currentWallet?.balance ?? 0;
  receiptTxId.value = null;
  printState.value = 'idle';
  autoPrinted = false;
  if (key === 'cash') {
    currentStep.value = 'cash-confirm';
    logKioskEvent('cash', 'info', 'Cash top-up session started', { amount: amountNumber.value, walletId: store.currentWallet?.id });
    try {
      await bill.start(amountNumber.value);
    } catch (e) {
      console.warn('[TopUp] startCollecting failed:', e);
      failType.value = 'server';
      failDetail.value = e instanceof Error ? e.message : String(e);
      currentStep.value = 'fail';
    }
  } else {
    currentStep.value = 'qr';
    logKioskEvent('qr', 'info', 'QR top-up session started', { amount: amountNumber.value, walletId: store.currentWallet?.id });
    await initQrPayment();
  }
};

const selectShortcut = (val: number) => {
  if (val > effectiveMax.value) return;
  enteredAmount.value = val.toString();
};

const confirmAmount = () => {
  if (!isAmountValid.value) return;
  currentStep.value = 'methods';
};

// --- QR Timer (600 seconds = 10 min to match BAY gateway expiry) ---
const QR_TIMEOUT = 600;
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
  stopPolling();
};

const initQrPayment = async () => {
  const walletId = store.currentWallet?.id;
  if (!walletId || !isAmountValid.value) return;
  qrLoading.value = true;
  qrDataUrl.value = '';
  activeRefCode.value = null;
  stopPolling();
  try {
    const intent = await realApi.createTopupIntent(walletId, amountNumber.value);
    activeRefCode.value = intent.ref_code;
    logKioskEvent('qr', 'info', 'QR intent created', { ref_code: intent.ref_code, amount: amountNumber.value });
    qrDataUrl.value = await QRCode.toDataURL(intent.qr_payload, {
      width: 240,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });
    startQrTimer();
    startPolling();
  } catch (e) {
    failType.value = 'server';
    failDetail.value = e instanceof Error ? e.message : String(e);
    currentStep.value = 'fail';
  } finally {
    qrLoading.value = false;
  }
};

const startPolling = () => {
  stopPolling();
  pollInterval = window.setInterval(async () => {
    if (!activeRefCode.value) return;
    try {
      const s = await realApi.getTopupStatus(activeRefCode.value);
      if (s.status === 'confirmed') {
        stopPolling();
        clearQrTimer();
        logKioskEvent('qr', 'info', 'QR payment confirmed', { ref_code: activeRefCode.value, transaction_id: s.transaction_id });
        if (s.transaction_id != null) {
          receiptTxId.value = s.transaction_id;
        }
        creditedAmount.value = s.amount;
        await store.refreshBalance();
        currentStep.value = 'success';
      } else if (s.status === 'cancelled') {
        stopPolling();
        clearQrTimer();
        logKioskEvent('qr', 'warn', 'QR payment cancelled or expired', { ref_code: activeRefCode.value });
        failType.value = 'server';
        failDetail.value = 'Payment was cancelled or expired';
        currentStep.value = 'fail';
      }
    } catch { /* ignore transient poll errors */ }
  }, 3000);
};

const stopPolling = () => {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
};

onUnmounted(() => {
  clearQrTimer();
  stopPolling();
  void bill.stop();
});

// Auto-finalize when the acceptor reports the target is met.
watch(bill.collectComplete, async (done) => {
  if (done && currentStep.value === 'cash-confirm' && !isProcessing.value) {
    bill.acknowledgeCollectComplete();
    await finalizeCashTopUp();
  }
});

const finalizeCashTopUp = async (): Promise<boolean> => {
  const walletId = store.currentWallet?.id;
  const amount = bill.collectedThb.value;
  if (!walletId || amount <= 0) return false;

  isProcessing.value = true;
  failDetail.value = null;
  try {
    await bill.stop();
    const res = await bill.finalizeTopUp(walletId, amount);
    receiptTxId.value = res.transaction_id;
    creditedAmount.value = amount;
    await store.refreshBalance();
    currentStep.value = 'success';
    return true;
  } catch (e) {
    const isNetwork = e instanceof TypeError && (e.message.includes('fetch') || e.message.includes('network'));
    failType.value = isNetwork ? 'internet' : 'server';
    failDetail.value = e instanceof Error ? e.message : String(e);
    currentStep.value = 'fail';
    return false;
  } finally {
    isProcessing.value = false;
    bill.resetSessionState();
  }
};

const handleHeaderBack = () => {
  if (currentStep.value === 'amount') goBack();
  else if (currentStep.value === 'methods') backToAmount();
  else if (currentStep.value === 'cash-confirm') backToMethods();
  else if (currentStep.value === 'qr') backToMethods();
  else goBack();
};

const backToMethods = async () => {
  await bill.stop();
  bill.resetSessionState();
  selectedMethod.value = null;
  currentStep.value = 'methods';
  clearQrTimer();
  stopPolling();
  qrDataUrl.value = '';
  activeRefCode.value = null;
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

const executeCancelTopup = async () => {
  clearQrTimer();
  if (currentStep.value === 'cash-confirm' && bill.collectedThb.value > 0) {
    const ok = await finalizeCashTopUp();
    if (ok) return;
  }
  await bill.stop();
  bill.resetSessionState();
  store.logout();
  router.push('/');
};

const requestCancelTopup = () => {
  if (currentStep.value === 'cash-confirm' && bill.collectedThb.value > 0) {
    showCashCancelConfirm.value = true;
    return;
  }
  void executeCancelTopup();
};

const confirmCashCancel = async () => {
  showCashCancelConfirm.value = false;
  await executeCancelTopup();
};

const dismissCashCancel = () => {
  showCashCancelConfirm.value = false;
};

const cancelTopup = requestCancelTopup;

const retryTopup = async () => {
  await bill.stop();
  bill.resetSessionState();
  currentStep.value = 'amount';
  enteredAmount.value = '0';
  creditedAmount.value = 0;
};

const successAmountDisplay = computed(() => {
  if (selectedMethod.value === 'cash' && creditedAmount.value > 0) {
    return formatCurrency(creditedAmount.value);
  }
  return formattedAmount.value;
});

// --- Receipt building / printing ---
const creditedNumber = computed(() =>
  selectedMethod.value === 'cash' && creditedAmount.value > 0
    ? creditedAmount.value
    : amountNumber.value,
);

const buildReceiptData = (): TopupReceiptData => {
  const tt = currT.value;
  const wallet = store.currentWallet;
  const methodLabel = selectedMethod.value ? (tt as any)[selectedMethod.value] : '';
  const amount = creditedNumber.value;
  const balAfter = wallet?.balance ?? balanceBefore.value + amount;

  const rows: ReceiptRow[] = [];
  if (receiptTxId.value != null) {
    rows.push({ label: tt.receiptTxId, value: String(receiptTxId.value) });
  }
  rows.push({ label: tt.successDate, value: nowFormatted.value });
  const deviceName = store.deviceProfile?.full_name;
  if (deviceName) {
    rows.push({ label: tt.receiptDevice, value: deviceName });
  }
  if (wallet) {
    rows.push({ label: tt.receiptMember, value: wallet.holderName });
  }
  rows.push({ label: tt.successMethod, value: methodLabel });

  return {
    schoolName: store.schoolInfo.school_name || undefined,
    logoUrl: store.schoolInfo.school_logo_url || undefined,
    title: tt.receiptTitle,
    typeLabel: tt.receiptType,
    rows,
    amountLabel: tt.successAmount,
    amountText: `+฿${formatCurrency(amount)}`,
    balanceLabel: tt.receiptBalanceAfter,
    balanceText: `฿${formatCurrency(balAfter)}`,
    footerLines: [tt.receiptThankYou, tt.receiptPoweredBy],
  };
};

const printReceipt = async () => {
  if (printState.value === 'printing') return;
  printState.value = 'printing';
  try {
    await printer.printTopupReceipt(buildReceiptData());
    printState.value = 'done';
  } catch (e) {
    console.warn('[TopUp] print receipt failed:', e);
    printState.value = 'error';
  }
};

// Auto-print once when the success screen appears. printReceipt lazily connects if needed,
// so this also recovers when the boot-time printer connect failed.
watch(currentStep, (step) => {
  if (step === 'success' && !autoPrinted) {
    autoPrinted = true;
    void printReceipt();
  }
});

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

// Amount-screen hint: shows the remaining allowance, or a warning if it's below the minimum.
const maxHintText = computed(() => {
  const tt = currT.value;
  if (effectiveMax.value < MIN_AMOUNT) return tt.limitReachedHint;
  return tt.maxTopupHint.replace('{n}', effectiveMax.value.toLocaleString());
});

// For cash: block accepting an over-target bill when it would push the balance past the cap.
const overpayExceedsCap = computed(() => {
  const p = bill.overpayPending.value;
  if (!p) return false;
  return (p.collectedThb ?? 0) + (p.billAmountThb ?? 0) > effectiveMax.value;
});
</script>

<template>
  <div class="kiosk-container topup-view">
    <!-- Header -->
    <div class="header-section" v-if="currentStep !== 'success' && currentStep !== 'fail'">
      <button v-if="!cashLocked" class="back-btn" @click="handleHeaderBack">
        <ChevronLeft :size="32" />
        <span>{{ currT.back }}</span>
      </button>
      <div v-else class="back-btn back-btn-placeholder" aria-hidden="true" />
      <h2>{{ currT.title }}</h2>
      <button v-if="!cashLocked" class="logout-btn" @click="cancelTopup">
        <LogOut :size="28" />
      </button>
      <div v-else class="logout-btn logout-btn-placeholder" aria-hidden="true" />
    </div>

    <!-- Wallet Info Bar (shown in amount & qr steps) -->
    <div v-if="currentWallet && (currentStep === 'amount' || currentStep === 'methods' || currentStep === 'qr' || currentStep === 'cash-confirm')" class="wallet-bar" :style="{ background: currentWallet.colorTheme }">
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

    <!-- Step 2: Amount selection (shortcut chips) -->
    <div v-if="currentStep === 'amount'" class="amount-section">
      <p class="amount-heading">{{ currT.enterAmount }}</p>
      <div class="amount-display-card">
        <div class="amount-display" :class="{ 'has-value': amountNumber > 0 }">
          {{ formattedAmount }}
        </div>
        <p class="max-hint">{{ maxHintText }}</p>
      </div>

      <div class="shortcut-grid">
        <button
          v-for="s in SHORTCUTS"
          :key="s"
          type="button"
          class="shortcut-btn"
          :class="{ active: amountNumber === s }"
          :disabled="s > effectiveMax"
          @click="selectShortcut(s)"
        >
          ฿{{ s.toLocaleString() }}
        </button>
      </div>

      <div class="amount-footer">
        <button class="kiosk-btn btn-secondary" @click="goBack">
          <ChevronLeft :size="24" />
          <span>{{ currT.back }}</span>
        </button>
        <button class="kiosk-btn btn-primary" :disabled="!isAmountValid" @click="confirmAmount">
          <span>{{ currT.confirm }}</span>
        </button>
      </div>
    </div>

    <!-- Step 3: QR Code Screen -->
    <div v-if="currentStep === 'qr'" class="qr-section">
      <div class="qr-card" :style="{ borderColor: selectedColor('border') }">
        <h3 class="qr-method-name">{{ (currT as any)[selectedMethod as any] }}</h3>
        <div class="qr-amount-badge">฿{{ formattedAmount }}</div>

        <!-- QR Code -->
        <div class="qr-wrapper">
          <div v-if="qrLoading" class="qr-loading">
            <div class="qr-spinner"></div>
          </div>
          <template v-else-if="qrDataUrl && !isQrExpired">
            <img :src="qrDataUrl" class="qr-image" alt="PromptPay QR" />
          </template>
          <div v-else-if="isQrExpired" class="qr-expired-overlay-standalone">
            <XCircle :size="48" />
            <span>{{ currT.qrExpired }}</span>
          </div>
        </div>

        <!-- Countdown Timer -->
        <div class="qr-timer" :class="{ 'timer-warning': qrTimeLeft <= 60, 'timer-danger': qrTimeLeft <= 30 }">
          <Timer :size="18" />
          <span>{{ currT.timeRemaining }}: </span>
          <span class="timer-value">{{ Math.floor(qrTimeLeft / 60) }}:{{ (qrTimeLeft % 60).toString().padStart(2, '0') }}</span>
        </div>

        <!-- Timer Progress Bar -->
        <div class="timer-bar">
          <div class="timer-bar-fill" :style="{ width: (qrProgress * 100) + '%' }" :class="{ 'bar-warning': qrTimeLeft <= 60, 'bar-danger': qrTimeLeft <= 30 }"></div>
        </div>

        <p v-if="!isQrExpired && !qrLoading" class="scan-text">{{ currT.scan }}</p>
        <p v-if="!isQrExpired && !qrLoading" class="sub-text">{{ currT.amount }}</p>
        <p v-if="isQrExpired" class="expired-sub-text">{{ currT.qrExpiredSub }}</p>
      </div>

      <!-- Action Buttons -->
      <div class="qr-actions">
        <button class="kiosk-btn btn-secondary qr-action-btn" :disabled="qrLoading" @click="backToMethods">
          <ArrowLeft :size="20" />
          <span>{{ currT.changeMethod }}</span>
        </button>
        <button class="kiosk-btn btn-danger qr-action-btn" @click="cancelTopup">
          <XCircle :size="20" />
          <span>{{ currT.cancelTopup }}</span>
        </button>
      </div>
    </div>

    <!-- Step 3b: Cash — insert bills -->
    <div v-if="currentStep === 'cash-confirm'" class="cash-confirm-section">
      <div class="cash-confirm-card">
        <div class="cash-icon">
          <Banknote :size="64" class="cash-icon-svg" />
        </div>
        <h3 class="cash-title">{{ currT.cashConfirmTitle }}</h3>
        <p class="cash-desc">{{ currT.cashConfirmDesc }}</p>

        <div class="cash-stats">
          <div class="cash-stat">
            <span class="cash-stat-label">{{ currT.cashTarget }}</span>
            <span class="cash-stat-value">฿{{ formattedAmount }}</span>
          </div>
          <div class="cash-stat cash-stat-inserted">
            <span class="cash-stat-label">{{ currT.cashInserted }}</span>
            <span class="cash-stat-value">฿{{ formatCurrency(bill.collectedThb.value) }}</span>
          </div>
          <div class="cash-stat">
            <span class="cash-stat-label">{{ currT.cashRemaining }}</span>
            <span class="cash-stat-value">฿{{ formatCurrency(bill.remainingThb.value) }}</span>
          </div>
        </div>

        <p class="cash-note">{{ currT.cashConfirmNote }}</p>
        <p v-if="cashLocked && !bill.isTargetMet.value" class="cash-partial-hint">
          {{ currT.cashPartialHint }}
        </p>

        <div class="qr-actions" :class="{ 'cash-actions-locked': cashLocked }">
          <button
            v-if="!cashLocked"
            class="kiosk-btn btn-secondary qr-action-btn"
            :disabled="isProcessing"
            @click="backToMethods"
          >
            <ArrowLeft :size="20" />
            <span>{{ currT.changeMethod }}</span>
          </button>
          <button
            class="kiosk-btn btn-danger qr-action-btn"
            :class="{ 'cash-cancel-only': cashLocked }"
            :disabled="isProcessing"
            @click="cancelTopup"
          >
            <XCircle :size="20" />
            <span>{{ currT.cancelTopup }}</span>
          </button>
        </div>
      </div>

      <!-- Cash cancel attention modal -->
      <div v-if="showCashCancelConfirm" class="overpay-overlay">
        <div class="overpay-modal cancel-attention-modal">
          <div class="cancel-attention-icon">
            <AlertTriangle :size="48" />
          </div>
          <h3 class="overpay-title">{{ currT.cashCancelAttentionTitle }}</h3>
          <p class="overpay-desc">{{ currT.cashCancelAttentionDesc }}</p>
          <div class="cancel-attention-amount">
            <span>{{ currT.cashCancelAttentionAmount }}</span>
            <strong>฿{{ formatCurrency(bill.collectedThb.value) }}</strong>
          </div>
          <div class="overpay-actions">
            <button
              class="kiosk-btn btn-danger"
              :disabled="isProcessing"
              @click="confirmCashCancel"
            >
              {{ isProcessing ? currT.processing : currT.cashCancelConfirmBtn }}
            </button>
            <button
              class="kiosk-btn btn-secondary"
              :disabled="isProcessing"
              @click="dismissCashCancel"
            >
              {{ currT.cashCancelDismissBtn }}
            </button>
          </div>
        </div>
      </div>

      <!-- Overpay decision modal -->
      <div v-if="bill.overpayPending.value" class="overpay-overlay">
        <div class="overpay-modal">
          <h3 class="overpay-title">{{ currT.cashOverpayTitle }}</h3>
          <p class="overpay-desc">{{ currT.cashOverpayDesc }}</p>
          <div class="overpay-details">
            <div class="overpay-row">
              <span>{{ currT.cashOverpayBill }}</span>
              <strong>฿{{ bill.overpayPending.value?.billAmountThb ?? 0 }}</strong>
            </div>
            <div class="overpay-row">
              <span>{{ currT.cashOverpayWouldBe }}</span>
              <strong>
                ฿{{ (bill.overpayPending.value?.collectedThb ?? 0) + (bill.overpayPending.value?.billAmountThb ?? 0) }}
              </strong>
            </div>
          </div>
          <p v-if="overpayExceedsCap" class="overpay-cap-note">{{ currT.overpayCapExceeded }}</p>
          <div class="overpay-actions">
            <button
              class="kiosk-btn btn-primary"
              :disabled="isProcessing || overpayExceedsCap"
              @click="bill.acceptOverpay()"
            >
              {{ currT.cashOverpayAccept }}
            </button>
            <button class="kiosk-btn btn-secondary" :disabled="isProcessing" @click="bill.returnOverpay()">
              {{ currT.cashOverpayReturn }}
            </button>
          </div>
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
        <div v-if="store.deviceProfile?.full_name" class="result-row">
          <span class="result-label">{{ currT.receiptDevice }}</span>
          <span class="result-value">{{ store.deviceProfile.full_name }}</span>
        </div>
        <div class="result-row">
          <span class="result-label">{{ currT.successMethod }}</span>
          <span class="result-value">{{ selectedMethod ? (currT as any)[selectedMethod] : '' }}</span>
        </div>
      </div>
      <div class="result-amount-box">
        <span class="result-amount">฿{{ successAmountDisplay }}</span>
      </div>

      <!-- Receipt printing -->
      <div class="receipt-print-block">
        <p v-if="printState === 'printing'" class="print-status printing">{{ currT.printing }}</p>
        <p v-else-if="printState === 'done'" class="print-status done">
          <CheckCircle2 :size="18" /> {{ currT.printed }}
        </p>
        <p v-else-if="printState === 'error'" class="print-status error">
          {{ currT.printFailed }}
          <span v-if="printer.lastPrinterError.value" class="print-error-detail">({{ printer.lastPrinterError.value }})</span>
        </p>

        <button
          class="kiosk-btn btn-secondary print-receipt-btn"
          :disabled="printState === 'printing'"
          @click="printReceipt"
        >
          <Printer :size="22" />
          <span>{{ printState === 'done' || printState === 'error' ? currT.reprint : currT.printReceipt }}</span>
        </button>
      </div>

      <button class="kiosk-btn btn-primary" style="margin-top: 1rem;" @click="goBackToBalance">
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
        <p v-if="failDetail" class="fail-code">{{ failDetail }}</p>
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
  border: 2px solid rgba(0,0,0,0.05);
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

/* Shortcut amount chips */
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

/* Receipt print block */
.receipt-print-block {
  margin-top: 1.5rem;
  width: 100%;
  max-width: 400px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}
.print-status {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.95rem;
  font-weight: 600;
}
.print-status.printing { color: var(--text-muted); }
.print-status.done { color: #16a34a; }
.print-status.error { color: #dc2626; flex-direction: column; gap: 0.15rem; text-align: center; }
.print-error-detail { font-size: 0.75rem; font-weight: 500; opacity: 0.8; word-break: break-all; }
.print-receipt-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  width: 100%;
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

.cash-stats {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0.75rem;
  width: 100%;
}
.cash-stat {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.75rem;
  background: #f8fafc;
  border-radius: 0.75rem;
}
.cash-stat-inserted {
  background: #f0fdf4;
  border: 2px solid #86efac;
}
.cash-stat-label {
  font-size: 0.8rem;
  color: var(--text-muted);
}
.cash-stat-value {
  font-size: 1.25rem;
  font-weight: 800;
  color: var(--text-color);
}
.cash-stat-inserted .cash-stat-value {
  color: #16a34a;
}
.cash-partial-hint {
  font-size: 0.85rem;
  color: #ca8a04;
  width: 100%;
}

.overpay-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 1.5rem;
}
.overpay-modal {
  background: var(--card-bg);
  border-radius: 1.5rem;
  padding: 2rem;
  max-width: 420px;
  width: 100%;
  text-align: center;
  box-shadow: var(--shadow);
}
.overpay-title {
  font-size: 1.4rem;
  font-weight: 800;
  margin-bottom: 0.5rem;
}
.overpay-desc {
  color: var(--text-muted);
  margin-bottom: 1.25rem;
}
.overpay-details {
  background: #fef3c7;
  border-radius: 0.75rem;
  padding: 1rem;
  margin-bottom: 1.25rem;
}
.overpay-row {
  display: flex;
  justify-content: space-between;
  padding: 0.35rem 0;
  font-size: 1rem;
}
.overpay-actions {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.overpay-cap-note {
  color: #dc2626;
  font-weight: 700;
  font-size: 0.95rem;
  margin-bottom: 0.75rem;
}

.cancel-attention-modal {
  max-width: 440px;
}
.cancel-attention-icon {
  color: #ca8a04;
  margin-bottom: 0.75rem;
}
.cancel-attention-amount {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #fef3c7;
  border-radius: 0.75rem;
  padding: 1rem 1.25rem;
  margin-bottom: 1.25rem;
  font-size: 1rem;
}
.cancel-attention-amount strong {
  font-size: 1.35rem;
  color: #16a34a;
}

.back-btn-placeholder,
.logout-btn-placeholder {
  visibility: hidden;
  pointer-events: none;
}

.cash-actions-locked {
  width: 100%;
}
.cash-cancel-only {
  width: 100%;
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
.logout-btn:hover { opacity: 1; }

.qr-image {
  width: 240px;
  height: 240px;
  border-radius: 8px;
}
.qr-loading {
  width: 240px;
  height: 240px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.qr-spinner {
  width: 48px;
  height: 48px;
  border: 4px solid #e5e7eb;
  border-top-color: #0284c7;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.qr-expired-overlay-standalone {
  width: 240px;
  height: 240px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #ef4444;
  font-weight: 600;
}
</style>
