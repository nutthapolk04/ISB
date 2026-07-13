<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useKioskStore } from '../stores/kioskStore';
import { User, LogOut, ChevronRight, ChevronLeft, Wallet, History, AlertTriangle, ArrowLeftRight } from 'lucide-vue-next';

const router = useRouter();
const store = useKioskStore();
const currT = computed(() => t[store.language as 'EN' | 'TH']);

/** Maximum balance a wallet may hold (THB). Top-up is blocked at or above this. */
const MAX_BALANCE = 50000;
const showLimitModal = ref(false);

if (!store.isAuthenticated) {
    router.push('/');
}

const t = {
    EN: {
        balance: 'Current Balance',
        balanceUnit: '(Baht)',
        empId: 'Employee ID',
        cardId: 'Card ID',
        menuTitle: 'Please select the service you need',
        topup: 'Top-up',
        transfer: 'Transfer to Family',
        history: 'Transaction History',
        personal: 'Personal',
        child: "Child's",
        walletOf: 'of',
        roleParent: 'Parent / Guardian',
        roleStaff: 'Staff / Teacher',
        roleStudent: 'Student',
        limitTitle: 'Unable to Process Transaction',
        limitMsg: 'This card has already reached the maximum limit of 50,000 Baht, so no further top-up is possible.',
        limitClose: 'OK',
    },
    TH: {
        balance: 'ยอดเงินคงเหลือ',
        balanceUnit: '(บาท)',
        empId: 'รหัสพนักงาน',
        cardId: 'เลขบัตร',
        menuTitle: 'โปรดเลือกรายการที่ท่านต้องการ',
        topup: 'เติมเงิน',
        transfer: 'โอนเงินให้ครอบครัว',
        history: 'ประวัติการทำรายการ',
        personal: 'ส่วนตัว',
        child: 'ของบุตร',
        walletOf: 'ของ',
        roleParent: 'ผู้ปกครอง / ผู้ดูแล',
        roleStaff: 'บุคลากร / ครู',
        roleStudent: 'นักเรียน',
        limitTitle: 'ไม่สามารถทำรายการได้',
        limitMsg: 'บัตรนี้มีวงเงินสูงสุด 50,000 บาทแล้ว จึงไม่สามารถเติมเงินเพิ่มได้',
        limitClose: 'ตกลง',
    }
};

const handleLogout = () => {
    store.logout();
    router.push('/');
};

const goToTopup = () => {
    // Block top-up when the active wallet is already at (or above) the balance cap.
    if ((store.currentWallet?.balance ?? 0) >= MAX_BALANCE) {
        showLimitModal.value = true;
        return;
    }
    router.push('/topup');
};

// Transfer is only offered to parents who have at least one linked child
// wallet to send money to — mirrors the parent-portal Transfer page, which
// hides itself when there's nothing to transfer to.
const canTransfer = computed(() => {
    return store.currentUser?.role === 'parent'
        && (store.currentUser?.wallets ?? []).some(w => w.type === 'child');
});

const goToTransfer = () => {
    router.push('/transfer');
};

const goToHistory = async () => {
    // Refresh transactions for whichever wallet is currently active before navigating
    const walletId = store.currentWallet?.id ?? null;
    if (walletId) {
        await store.refreshTransactions(walletId, store.activeWalletIndex);
    }
    router.push('/history');
};

const formatCurrency = (val: number) => {
    return new Intl.NumberFormat(store.language === 'TH' ? 'th-TH' : 'en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(val);
};

// Per-wallet role label — uses each wallet's holder role, not the logged-in user's.
// E.g. when Malee (parent) taps her card, her own wallet shows "Parent / Guardian"
// but Somchai's coparent wallet shows "Staff / Teacher".
const walletRoleLabel = (role: string | null | undefined): string => {
    const r = (role ?? '').toLowerCase();
    if (r.includes('parent') || r.includes('guardian')) return currT.value.roleParent;
    if (r.includes('staff') || r.includes('teacher') || r.includes('employee')) return currT.value.roleStaff;
    if (r.includes('student') || r.includes('child')) return currT.value.roleStudent;
    return currT.value.roleParent;
};

const maskData = (str: string) => {
    if (str.length <= 4) return str;
    return '****' + str.slice(-4);
};

// --- Carousel Logic ---
const carouselRef = ref<HTMLElement | null>(null);
let touchStartX = 0;
let touchDelta = 0;
const isDragging = ref(false);

const wallets = store.currentUser?.wallets ?? [];
const hasMultipleWallets = wallets.length > 1;

const goToWallet = (index: number) => {
    store.setActiveWallet(index);
    scrollToWallet(index);
};

const scrollToWallet = (index: number) => {
    if (!carouselRef.value) return;
    const cardWidth = carouselRef.value.children[0]?.clientWidth ?? 0;
    const gap = 16;
    carouselRef.value.scrollTo({
        left: index * (cardWidth + gap),
        behavior: 'smooth',
    });
};

const handleTouchStart = (e: TouchEvent) => {
    touchStartX = e.touches[0].clientX;
    isDragging.value = true;
};

const handleTouchMove = (e: TouchEvent) => {
    if (!isDragging.value) return;
    touchDelta = e.touches[0].clientX - touchStartX;
};

const handleTouchEnd = () => {
    isDragging.value = false;
    if (Math.abs(touchDelta) > 50) {
        if (touchDelta < 0 && store.activeWalletIndex < wallets.length - 1) {
            goToWallet(store.activeWalletIndex + 1);
        } else if (touchDelta > 0 && store.activeWalletIndex > 0) {
            goToWallet(store.activeWalletIndex - 1);
        }
    }
    touchDelta = 0;
};

// Mouse drag for desktop
let mouseStartX = 0;
let mouseDelta = 0;
const isMouseDrag = ref(false);

const handleMouseDown = (e: MouseEvent) => {
    mouseStartX = e.clientX;
    isMouseDrag.value = true;
};

const handleMouseMove = (e: MouseEvent) => {
    if (!isMouseDrag.value) return;
    mouseDelta = e.clientX - mouseStartX;
};

const handleMouseUp = () => {
    if (!isMouseDrag.value) return;
    isMouseDrag.value = false;
    if (Math.abs(mouseDelta) > 50) {
        if (mouseDelta < 0 && store.activeWalletIndex < wallets.length - 1) {
            goToWallet(store.activeWalletIndex + 1);
        } else if (mouseDelta > 0 && store.activeWalletIndex > 0) {
            goToWallet(store.activeWalletIndex - 1);
        }
    }
    mouseDelta = 0;
};

const navPrev = () => {
    if (store.activeWalletIndex > 0) goToWallet(store.activeWalletIndex - 1);
};

const navNext = () => {
    if (store.activeWalletIndex < wallets.length - 1) goToWallet(store.activeWalletIndex + 1);
};

onMounted(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    // Restore carousel scroll position when returning from sub-pages
    if (store.activeWalletIndex > 0) {
        setTimeout(() => scrollToWallet(store.activeWalletIndex), 50);
    }
});

onUnmounted(() => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
});
</script>

<template>
    <div class="kiosk-container balance-view" v-if="store.currentUser">
        <!-- Wallet Carousel Section -->
        <div class="carousel-wrapper">
            <!-- Nav arrows for desktop -->
            <button v-if="hasMultipleWallets" class="carousel-nav prev" :disabled="store.activeWalletIndex === 0"
                @click="navPrev">
                <ChevronLeft :size="32" />
            </button>

            <div class="wallet-carousel" ref="carouselRef" @touchstart="handleTouchStart" @touchmove="handleTouchMove"
                @touchend="handleTouchEnd" @mousedown="handleMouseDown">
                <div v-for="(wallet, index) in wallets" :key="wallet.id" class="user-balance-card"
                    :class="{ active: index === store.activeWalletIndex, 'wallet-child': wallet.type === 'child' }"
                    :style="{ background: wallet.colorTheme }" @click="goToWallet(index)">
                    <!-- Wallet Type Badge -->
                    <div class="wallet-type-badge">
                        {{ wallet.type === 'personal' ? currT.personal : wallet.type === 'coparent' ? currT.personal :
                            currT.child }}
                    </div>

                    <div class="user-row">
                        <div class="avatar" :class="wallet.type === 'child' ? 'avatar-child' : ''">
                            <img v-if="wallet.photoUrl" :src="wallet.photoUrl" class="avatar-photo" alt="photo" />
                            <User v-else :size="36" />
                        </div>
                        <div class="user-details">
                            <h2 class="user-name">{{ wallet.holderName }}</h2>
                            <div class="role-row">
                                <span class="role-badge role-account">{{ walletRoleLabel(wallet.role) }}</span>
                            </div>
                            <p class="balance-sub">{{ currT.balance }} {{ currT.balanceUnit }}</p>
                        </div>
                        <button class="logout-icon-btn" @click.stop="handleLogout">
                            <LogOut :size="24" />
                        </button>
                    </div>
                    <div class="balance-row">
                        <div class="balance-display">
                            <span class="currency-sign">฿</span>
                            <span class="balance-value">{{ formatCurrency(wallet.balance) }}</span>
                        </div>
                    </div>
                    <div class="user-meta-row">
                        <span class="meta-badge">{{ currT.empId }}: {{ maskData(store.currentUser!.employeeId) }}</span>
                        <span class="meta-badge">{{ currT.cardId }}: {{ maskData(wallet.cardId) }}</span>
                    </div>
                </div>
            </div>

            <button v-if="hasMultipleWallets" class="carousel-nav next"
                :disabled="store.activeWalletIndex === wallets.length - 1" @click="navNext">
                <ChevronRight :size="32" />
            </button>
        </div>

        <!-- Dot indicators -->
        <div v-if="hasMultipleWallets" class="carousel-dots">
            <span v-for="(wallet, i) in wallets" :key="wallet.id" class="dot"
                :class="{ active: i === store.activeWalletIndex }"
                :style="i === store.activeWalletIndex ? { backgroundColor: wallet.type === 'child' ? '#f59e0b' : '#6b3fa0' } : {}"
                @click="goToWallet(i)"></span>
        </div>

        <!-- Service Menu — 2 items -->
        <div class="menu-section">
            <h3 class="menu-title">{{ currT.menuTitle }}</h3>

            <button class="menu-item topup" @click="goToTopup">
                <div class="menu-item-left">
                    <div class="menu-icon topup-icon">
                        <Wallet :size="28" />
                    </div>
                    <span>{{ currT.topup }}</span>
                </div>
                <ChevronRight :size="24" class="chevron" />
            </button>

            <button v-if="canTransfer" class="menu-item transfer" @click="goToTransfer">
                <div class="menu-item-left">
                    <div class="menu-icon transfer-icon">
                        <ArrowLeftRight :size="28" />
                    </div>
                    <span>{{ currT.transfer }}</span>
                </div>
                <ChevronRight :size="24" class="chevron" />
            </button>

            <button class="menu-item history" @click="goToHistory">
                <div class="menu-item-left">
                    <div class="menu-icon history-icon">
                        <History :size="28" />
                    </div>
                    <span>{{ currT.history }}</span>
                </div>
                <ChevronRight :size="24" class="chevron" />
            </button>
        </div>

        <!-- Max-balance limit alert -->
        <div v-if="showLimitModal" class="limit-overlay" @click.self="showLimitModal = false">
            <div class="limit-modal">
                <div class="limit-icon">
                    <AlertTriangle :size="48" />
                </div>
                <h3 class="limit-title">{{ currT.limitTitle }}</h3>
                <p class="limit-msg">{{ currT.limitMsg }}</p>
                <button class="limit-btn" @click="showLimitModal = false">{{ currT.limitClose }}</button>
            </div>
        </div>
    </div>
</template>

<style scoped>
.balance-view {
    padding: 3rem 2rem 2rem;
    justify-content: flex-start;
    gap: 1.5rem;
}

/* ---- Carousel ---- */
.carousel-wrapper {
    width: 100%;
    position: relative;
}

.wallet-carousel {
    display: flex;
    gap: 1rem;
    overflow-x: scroll;
    scroll-snap-type: x mandatory;
    flex: 1;
    cursor: grab;
    scrollbar-width: none;
    -ms-overflow-style: none;
}

.wallet-carousel::-webkit-scrollbar {
    display: none;
}

.wallet-carousel:active {
    cursor: grabbing;
}

.user-balance-card {
    min-width: 100%;
    scroll-snap-align: center;
    color: white;
    border-radius: 1.5rem;
    padding: 1.5rem 2rem;
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.25);
    transition: transform 0.35s ease, opacity 0.35s ease;
    position: relative;
    overflow: hidden;
}

.user-balance-card:not(.active) {
    opacity: 0.6;
    transform: scale(0.95);
}

.wallet-type-badge {
    position: absolute;
    top: 1rem;
    right: 1rem;
    background: rgba(255, 255, 255, 0.25);
    backdrop-filter: blur(4px);
    padding: 0.25rem 1rem;
    border-radius: 2rem;
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
}

.user-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
}

.avatar {
    background: rgba(255, 255, 255, 0.2);
    width: 56px;
    height: 56px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

.avatar-child {
    background: rgba(255, 255, 255, 0.3);
    border: 2px dashed rgba(255, 255, 255, 0.5);
}

.avatar-photo {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
}

.role-row {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.2rem;
    margin-bottom: 0.1rem;
    flex-wrap: wrap;
}

.role-badge {
    display: inline-block;
    padding: 0.15rem 0.6rem;
    border-radius: 2rem;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    background: rgba(255, 255, 255, 0.25);
    border: 1px solid rgba(255, 255, 255, 0.4);
    color: #fff;
}

.role-account,
.role-child {
    /* Use the unified role-badge style above — white tint works on all gradients. */
}

.user-details {
    flex: 1;
}

.user-name {
    font-size: 1.5rem;
    font-weight: 800;
    margin-bottom: 0.1rem;
}

.balance-sub {
    font-size: 0.95rem;
    opacity: 0.8;
}

.logout-icon-btn {
    background: rgba(255, 255, 255, 0.15);
    border: none;
    color: white;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
}

.balance-row {
    text-align: center;
    margin: 1rem 0;
}

.balance-display {
    display: inline-flex;
    align-items: flex-start;
    gap: 0.25rem;
}

.currency-sign {
    font-size: 2rem;
    font-weight: 700;
    margin-top: 0.5rem;
}

.balance-value {
    font-size: 4rem;
    font-weight: 800;
    line-height: 1;
}

.user-meta-row {
    display: flex;
    gap: 0.75rem;
    justify-content: center;
    flex-wrap: wrap;
}

.meta-badge {
    background: rgba(255, 255, 255, 0.15);
    padding: 0.25rem 0.75rem;
    border-radius: 2rem;
    font-size: 0.85rem;
    font-weight: 500;
}

/* Carousel nav buttons — overlay on card edges */
.carousel-nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 10;
    background: rgba(0, 0, 0, 0.35);
    border: none;
    color: white;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    transition: opacity 0.2s, transform 0.1s;
}

.carousel-nav.prev {
    left: 0.75rem;
}

.carousel-nav.next {
    right: 0.75rem;
}

.carousel-nav:disabled {
    opacity: 0.2;
    cursor: default;
}

.carousel-nav:active:not(:disabled) {
    transform: translateY(-50%) scale(0.9);
}

/* Dot indicators */
.carousel-dots {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
}

.dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--text-muted);
    opacity: 0.3;
    cursor: pointer;
    transition: all 0.3s ease;
}

.dot.active {
    opacity: 1;
    width: 28px;
    border-radius: 5px;
}

/* ---- Service Menu ---- */
.menu-section {
    width: 100%;
    flex: 1;
}

.menu-title {
    font-size: 1.5rem;
    font-weight: 800;
    margin-bottom: 1.5rem;
}

.menu-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 1.25rem 1.5rem;
    background: var(--card-bg);
    border: 2px solid transparent;
    border-radius: 1.25rem;
    margin-bottom: 1rem;
    cursor: pointer;
    transition: transform 0.1s, box-shadow 0.2s;
    font-size: 1.35rem;
    font-weight: 700;
    color: var(--text-color);
}

.menu-item:active {
    transform: scale(0.98);
}

.menu-item-left {
    display: flex;
    align-items: center;
    gap: 1rem;
}

.menu-icon {
    width: 52px;
    height: 52px;
    border-radius: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

.topup-icon {
    background: rgba(212, 54, 42, 0.1);
    color: var(--primary);
}

.history-icon {
    background: rgba(234, 203, 70, 0.25);
    color: #8a6d1a;
}

.menu-item.topup {
    border-color: rgba(212, 54, 42, 0.2);
}

.menu-item.history {
    border-color: rgba(234, 203, 70, 0.5);
}

.transfer-icon {
    background: linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%);
    color: #fff;
}

.menu-item.transfer {
    border-color: rgba(212, 54, 42, 0.15);
}

.menu-item:active {
    box-shadow: 0 4px 14px -4px rgba(212, 54, 42, 0.2);
}

.chevron {
    color: var(--text-muted);
    opacity: 0.5;
}

/* ---- Max-balance limit modal ---- */
.limit-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    padding: 1.5rem;
}

.limit-modal {
    background: var(--card-bg);
    border-radius: 1.5rem;
    padding: 2.5rem 2rem 2rem;
    max-width: 420px;
    width: 100%;
    text-align: center;
    box-shadow: 0 25px 60px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
}

.limit-icon {
    color: #d97706;
    background: #fef3c7;
    width: 88px;
    height: 88px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
}

.limit-title {
    font-size: 1.5rem;
    font-weight: 800;
    color: var(--text-color);
}

.limit-msg {
    font-size: 1.05rem;
    line-height: 1.5;
    color: var(--text-muted);
}

.limit-btn {
    margin-top: 0.5rem;
    width: 100%;
    height: 3.5rem;
    border: none;
    border-radius: 1rem;
    background: var(--primary);
    color: #fff;
    font-size: 1.15rem;
    font-weight: 700;
    cursor: pointer;
    transition: transform 0.1s, background 0.2s;
}

.limit-btn:active {
    transform: scale(0.97);
}
</style>
