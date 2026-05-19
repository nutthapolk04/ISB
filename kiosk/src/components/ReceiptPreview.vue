<script setup lang="ts">
import { useKioskStore } from '../stores/kioskStore';
import { X, Printer, CheckCircle2 } from 'lucide-vue-next';
import { computed } from 'vue';
import type { Transaction } from '../api/mockApi';

const props = defineProps<{
  transaction: Transaction
}>();

const emit = defineEmits(['close']);
const store = useKioskStore();
const currT = computed(() => t[store.language as 'EN' | 'TH']);

const t = {
  EN: {
    title: 'Receipt',
    txId: 'Transaction ID',
    type: 'Type',
    date: 'Date & Time',
    location: 'Location',
    before: 'Balance Before',
    amount: 'Amount',
    after: 'Balance After',
    close: 'Close',
    print: 'Print Receipt',
    topup: 'Top-up',
    purchase: 'Purchase',
    thankYou: 'Thank you for using our service',
    poweredBy: 'Kiosk Check Balance System',
    items: 'Items',
    qty: 'x'
  },
  TH: {
    title: 'ใบเสร็จ',
    txId: 'เลขที่รายการ',
    type: 'ประเภท',
    date: 'วันที่และเวลา',
    location: 'สถานที่',
    before: 'ยอดก่อนหน้า',
    amount: 'จำนวนเงิน',
    after: 'ยอดคงเหลือ',
    close: 'ปิด',
    print: 'พิมพ์ใบเสร็จ',
    topup: 'เติมเงิน',
    purchase: 'ซื้อสินค้า',
    thankYou: 'ขอบคุณที่ใช้บริการ',
    poweredBy: 'ระบบตรวจสอบยอดเงิน Kiosk',
    items: 'รายการสินค้า',
    qty: 'x'
  }
};

const formatCurrency = (val: number) => {
  return new Intl.NumberFormat(store.language === 'TH' ? 'th-TH' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(val);
};

const handlePrint = () => {
  window.print();
};
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
    <div class="receipt-card animate-slide-up" id="printable-receipt">
      <!-- Close button (hidden in print) -->
      <button class="close-btn no-print" @click="emit('close')">
        <X :size="28" />
      </button>

      <!-- Receipt content -->
      <div class="receipt-content">
        <!-- Header -->
        <div class="receipt-header">
          <div class="receipt-logo">
            <CheckCircle2 :size="40" class="text-success" />
          </div>
          <h2 class="receipt-title">{{ currT.title }}</h2>
          <div class="receipt-separator-thick"></div>
        </div>

        <!-- Transaction details -->
        <div class="receipt-section">
          <div class="receipt-row">
            <span class="r-label">{{ currT.txId }}</span>
            <span class="r-value mono">{{ props.transaction.id }}</span>
          </div>
          <div class="receipt-row">
            <span class="r-label">{{ currT.type }}</span>
            <span class="r-value type-badge" :class="props.transaction.type">
              {{ props.transaction.type === 'topup' ? currT.topup : currT.purchase }}
            </span>
          </div>
          <div class="receipt-row">
            <span class="r-label">{{ currT.date }}</span>
            <span class="r-value">{{ props.transaction.date }} {{ props.transaction.time }}</span>
          </div>
          <div class="receipt-row">
            <span class="r-label">{{ currT.location }}</span>
            <span class="r-value">{{ props.transaction.machine }}</span>
          </div>
        </div>

        <!-- Purchase items (only for purchases) -->
        <div v-if="props.transaction.items && props.transaction.items.length" class="receipt-items-section">
          <div class="receipt-separator-dashed"></div>
          <div class="receipt-section">
            <div class="items-header">{{ currT.items }}</div>
            <div v-for="(item, i) in props.transaction.items" :key="i" class="receipt-item-container">
              <div class="receipt-item-row">
                <span class="item-name">
                  {{ item.name }}
                  <span v-if="item.qty > 1" class="item-qty">{{ currT.qty }}{{ item.qty }}</span>
                </span>
                <span class="item-price">฿{{ formatCurrency(item.price * item.qty) }}</span>
              </div>
              <!-- Add-ons in receipt -->
              <div v-if="item.addons && item.addons.length" class="receipt-item-addons">
                <div v-for="(addon, j) in item.addons" :key="j" class="receipt-addon-line">
                  + {{ addon }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="receipt-separator-dashed"></div>

        <!-- Financial details -->
        <div class="receipt-section">
          <div class="receipt-row">
            <span class="r-label">{{ currT.before }}</span>
            <span class="r-value">฿{{ formatCurrency(props.transaction.balanceBefore) }}</span>
          </div>
          <div class="receipt-row amount-row">
            <span class="r-label">{{ currT.amount }}</span>
            <span class="r-value amount-value" :class="props.transaction.type">
              {{ props.transaction.type === 'topup' ? '+' : '-' }}฿{{ formatCurrency(props.transaction.amount) }}
            </span>
          </div>
        </div>

        <div class="receipt-separator-dashed"></div>

        <!-- Balance After — highlighted -->
        <div class="receipt-section balance-after-section">
          <div class="receipt-row balance-after-row">
            <span class="r-label-large">{{ currT.after }}</span>
            <span class="r-value-large">฿{{ formatCurrency(props.transaction.balanceAfter) }}</span>
          </div>
        </div>

        <div class="receipt-separator-thick"></div>

        <!-- Footer -->
        <div class="receipt-thank-you">
          <p>{{ currT.thankYou }}</p>
          <p class="powered-by">{{ currT.poweredBy }}</p>
        </div>
      </div>

      <!-- Action buttons (hidden in print) -->
      <div class="receipt-actions no-print">
        <button class="action-btn print-btn" @click="handlePrint">
          <Printer :size="22" />
          <span>{{ currT.print }}</span>
        </button>
        <button class="action-btn close-action-btn" @click="emit('close')">
          <span>{{ currT.close }}</span>
        </button>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<style scoped>
/* ===== Modal Overlay ===== */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}

/* ===== Receipt Card ===== */
.receipt-card {
  background: #ffffff;
  width: 100%;
  max-width: 420px;
  border-radius: 1.5rem;
  box-shadow: 0 25px 60px rgba(0,0,0,0.3);
  position: relative;
  overflow: hidden;
}

.receipt-content {
  padding: 2rem 2rem 1.5rem;
}

/* ===== Close button ===== */
.close-btn {
  position: absolute;
  top: 1rem;
  right: 1rem;
  background: rgba(0,0,0,0.05);
  border: none;
  color: #64748b;
  cursor: pointer;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
  z-index: 2;
}
.close-btn:hover {
  background: rgba(0,0,0,0.1);
}

/* ===== Header ===== */
.receipt-header {
  text-align: center;
  margin-bottom: 1.5rem;
}

.receipt-logo {
  margin-bottom: 0.5rem;
}

.text-success { color: #10b981; }

.receipt-title {
  font-size: 1.5rem;
  font-weight: 800;
  color: #0f172a;
  margin-bottom: 1rem;
  letter-spacing: -0.02em;
}

/* ===== Separators ===== */
.receipt-separator-thick {
  height: 3px;
  background: #0f172a;
  border-radius: 2px;
}

.receipt-separator-dashed {
  border: none;
  border-top: 2px dashed #cbd5e1;
  margin: 1rem 0;
}

/* ===== Sections ===== */
.receipt-section {
  padding: 0.75rem 0;
}

.receipt-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0;
}

.r-label {
  color: #64748b;
  font-size: 0.95rem;
  font-weight: 500;
}

.r-value {
  font-weight: 700;
  font-size: 1rem;
  color: #0f172a;
  text-align: right;
}

.mono {
  font-family: 'SF Mono', 'Fira Mono', monospace;
  letter-spacing: 0.05em;
}

/* Type badge */
.type-badge {
  padding: 0.15rem 0.75rem;
  border-radius: 1rem;
  font-size: 0.85rem;
  font-weight: 700;
}
.type-badge.topup {
  background: #dcfce7;
  color: #16a34a;
}
.type-badge.purchase {
  background: #fef2f2;
  color: #dc2626;
}

/* Amount row */
.amount-row {
  padding: 0.75rem 0;
}
.amount-value {
  font-size: 1.35rem;
  font-weight: 800;
}
.amount-value.topup { color: #16a34a; }
.amount-value.purchase { color: #dc2626; }

/* Balance after */
.balance-after-section {
  padding: 1rem 0;
}
.balance-after-row {
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}
.r-label-large {
  color: #64748b;
  font-size: 0.9rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.r-value-large {
  font-size: 2.5rem;
  font-weight: 800;
  color: #2563eb;
  letter-spacing: -0.02em;
}

/* ===== Thank you footer ===== */
.receipt-thank-you {
  text-align: center;
  padding: 1.25rem 0 0.5rem;
  color: #94a3b8;
  font-size: 0.85rem;
}
.receipt-thank-you p {
  margin-bottom: 0.25rem;
}
.powered-by {
  font-weight: 600;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

/* ===== Action buttons ===== */
.receipt-actions {
  display: flex;
  gap: 0.75rem;
  padding: 1rem 2rem 2rem;
}

.action-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  height: 3.5rem;
  border-radius: 1rem;
  font-size: 1.1rem;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.1s, background 0.2s;
  border: none;
}
.action-btn:active {
  transform: scale(0.97);
}

.print-btn {
  background: #2563eb;
  color: white;
}
.print-btn:hover {
  background: #1d4ed8;
}

.close-action-btn {
  background: #f1f5f9;
  color: #475569;
  border: 2px solid #e2e8f0;
}
.close-action-btn:hover {
  background: #e2e8f0;
}

/* ===== Receipt Items ===== */
.receipt-items-section {
  margin: 0;
}

.items-header {
  font-size: 0.85rem;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 0.5rem;
}

.receipt-item-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.3rem 0;
  font-size: 0.9rem;
}

.item-name {
  color: #334155;
  font-weight: 500;
}

.item-qty {
  color: #94a3b8;
  font-size: 0.8rem;
  margin-left: 0.25rem;
}

.item-price {
  color: #475569;
  font-weight: 600;
  font-size: 0.9rem;
}

.receipt-item-container {
  padding: 0.3rem 0;
}

.receipt-item-addons {
  padding-left: 0.75rem;
  margin-top: -0.15rem;
  margin-bottom: 0.25rem;
}

.receipt-addon-line {
  font-size: 0.75rem;
  color: #64748b;
  font-style: italic;
  display: block;
  line-height: 1.2;
}

/* ===== Animation ===== */
.animate-slide-up {
  animation: slide-up 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes slide-up {
  from { transform: translateY(40px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

/* ===== Print Styles ===== */
@media print {
  .no-print {
    display: none !important;
  }

  .modal-overlay {
    position: static;
    background: none !important;
    backdrop-filter: none !important;
    padding: 0;
    display: block;
  }

  .receipt-card {
    max-width: 80mm; /* Standard thermal receipt width */
    width: 80mm;
    border-radius: 0;
    box-shadow: none;
    margin: 0 auto;
    border: 1px solid #000;
  }

  .receipt-content {
    padding: 8mm 5mm 5mm;
  }

  /* Force black & white for thermal printing */
  .text-success { color: #000 !important; }
  .receipt-title { color: #000 !important; }
  .r-value { color: #000 !important; }
  .r-value-large { color: #000 !important; }
  .r-label { color: #333 !important; }
  .r-label-large { color: #333 !important; }
  
  .type-badge {
    background: none !important;
    color: #000 !important;
    padding: 0;
    border: 1px solid #000;
  }
  
  .amount-value.topup,
  .amount-value.purchase {
    color: #000 !important;
  }

  .receipt-separator-thick {
    background: #000 !important;
    height: 2px;
  }

  .receipt-separator-dashed {
    border-color: #000 !important;
  }

  .receipt-thank-you {
    color: #333 !important;
  }

  /* Sizing for thermal printer */
  .receipt-title { font-size: 14pt; }
  .r-label { font-size: 8pt; }
  .r-value { font-size: 9pt; }
  .r-value-large { font-size: 18pt; }
  .r-label-large { font-size: 7pt; }
  .amount-value { font-size: 11pt; }
  .receipt-thank-you { font-size: 7pt; }
  .powered-by { font-size: 6pt; }
  .receipt-addon-line {
    font-size: 7pt;
    color: #444 !important;
    font-style: normal;
  }
}
</style>
