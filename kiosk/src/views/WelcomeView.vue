<script setup lang="ts">
import { useRouter } from 'vue-router';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useKioskStore } from '../stores/kioskStore';
import KioskOverlay from '../components/KioskOverlay.vue';
import { CreditCard, Languages, Wrench } from 'lucide-vue-next';

const router = useRouter();
const store = useKioskStore();

function openTechnician() {
    router.push('/technician');
}

const toggleLanguage = () => {
    store.setLanguage(store.language === 'EN' ? 'TH' : 'EN');
};

const currT = computed(() => t[store.language as 'EN' | 'TH']);

const rfidError = ref(false);
const rfidNetworkError = ref(false);

// ── Passive RFID capture-phase listener ─────────────────────────────────────
// RFID readers emit fast keypresses ending with Enter.
// Uses capture phase so it intercepts even when an input is focused.
const rfidBuffer = ref('');
const rfidLastKey = ref(0);
const rfidMode = ref(false);

async function handleRfidLogin(code: string) {
    if (store.isLoading || !store.isReady) return;

    const result = await store.login(code.trim(), 'rfid');
    if (result.ok) {
        router.push('/balance');
        return;
    }

    if (result.reason === 'network') {
        rfidNetworkError.value = true;
        setTimeout(() => { rfidNetworkError.value = false; }, 3000);
        return;
    }

    if (result.reason === 'not_found') {
        rfidError.value = true;
        setTimeout(() => { rfidError.value = false; }, 2500);
    }
}

function handleKeyDown(e: KeyboardEvent) {
    if (store.isLoading || !store.isReady) return;

    const now = Date.now();
    const gap = now - rfidLastKey.value;

    if (e.key === 'Enter') {
        if (rfidMode.value && rfidBuffer.value.length >= 3) {
            e.preventDefault();
            e.stopPropagation();
            const captured = rfidBuffer.value;
            rfidBuffer.value = '';
            rfidMode.value = false;
            rfidLastKey.value = 0;
            void handleRfidLogin(captured);
        } else {
            rfidBuffer.value = '';
            rfidMode.value = false;
        }
        return;
    }

    if (e.key.length !== 1) return;

    if (gap > 100 && rfidBuffer.value.length > 0) {
        rfidBuffer.value = '';
        rfidMode.value = false;
    }

    rfidLastKey.value = now;
    rfidBuffer.value += e.key;

    if (gap < 50 && rfidBuffer.value.length >= 2) {
        rfidMode.value = true;
    }

    if (rfidMode.value) {
        e.preventDefault();
        e.stopPropagation();
    }
}

onMounted(() => {
    document.addEventListener('keydown', handleKeyDown, true);
});

onUnmounted(() => {
    document.removeEventListener('keydown', handleKeyDown, true);
});

const t = {
    EN: {
        welcome: 'Welcome',
        sub: 'Please tap your card',
        lang: 'ภาษาไทย',
        cardNotFound: 'Card not found',
        networkError: 'Connection error. Please try again.',
        searching: 'Looking up card…',
        technician: 'Technician',
    },
    TH: {
        welcome: 'ยินดีต้อนรับ',
        sub: 'กรุณาแตะบัตรของคุณ',
        lang: 'English',
        cardNotFound: 'ไม่พบบัตรนี้ในระบบ',
        networkError: 'เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่',
        searching: 'กำลังค้นหาบัตร…',
        technician: 'ผู้ดูแลเครื่อง',
    }
};
</script>

<template>
    <div class="kiosk-container welcome-view">
        <KioskOverlay v-if="store.isLoading" :message="currT.searching" />

        <div class="lang-switch-container">
            <button class="tech-entry-btn" type="button" :disabled="store.isLoading" @click="openTechnician">
                <Wrench :size="28" />
                <span>{{ currT.technician }}</span>
            </button>
            <button class="lang-btn" :disabled="store.isLoading" @click="toggleLanguage">
                <Languages :size="32" />
                <span>{{ currT.lang }}</span>
            </button>
        </div>

        <!-- School branding -->
        <div class="school-brand">
            <img v-if="store.schoolInfo.school_logo_url" :src="store.schoolInfo.school_logo_url" class="school-logo"
                alt="School logo" />
            <h2 v-if="store.schoolInfo.school_name" class="school-name">{{ store.schoolInfo.school_name }}</h2>
        </div>

        <div class="welcome-content">
            <div class="rfid-animation mb-8">
                <div class="card-icon pulse-animation" :class="{ 'card-error': rfidError }">
                    <CreditCard :size="120" stroke-width="1.5" />
                </div>
                <div class="rfid-waves">
                    <div class="wave"></div>
                    <div class="wave"></div>
                    <div class="wave"></div>
                </div>
            </div>

            <h1 class="mb-4">{{ currT.welcome }}</h1>
            <p class="text-muted text-center mb-12">{{ currT.sub }}</p>
            <p v-if="rfidError" class="rfid-error-msg">{{ currT.cardNotFound }}</p>
            <p v-if="rfidNetworkError" class="rfid-error-msg">{{ currT.networkError }}</p>
        </div>
    </div>
</template>

<style scoped>
.welcome-view {
    justify-content: flex-start;
    padding: 4rem 2rem 2rem;
}

.lang-switch-container {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
}

.tech-entry-btn {
    background: none;
    border: 2px solid #94a3b8;
    color: var(--text-muted);
    padding: 0.75rem 1.25rem;
    border-radius: 3rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.9rem;
}

.tech-entry-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.lang-btn {
    background: none;
    border: 2px solid var(--text-muted);
    color: var(--text-color);
    padding: 0.75rem 1.5rem;
    border-radius: 3rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-weight: 700;
    cursor: pointer;
}

.lang-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.welcome-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1;
    justify-content: center;
    cursor: pointer;
}

.rfid-animation {
    position: relative;
    margin-bottom: 3rem;
}

.card-icon {
    color: var(--primary);
    background: rgba(37, 99, 235, 0.1);
    padding: 3rem;
    border-radius: 3rem;
}

.mb-4 {
    margin-bottom: 1rem;
}

.mb-8 {
    margin-bottom: 2rem;
}

.mb-12 {
    margin-bottom: 3rem;
}

.text-muted {
    color: var(--text-muted);
    font-size: 1.75rem;
}

.text-center {
    text-align: center;
}

.card-error .card-icon {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
}

.rfid-error-msg {
    margin-top: 1rem;
    color: #ef4444;
    font-size: 1.25rem;
    font-weight: 600;
    text-align: center;
}

.school-brand {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
}

.school-logo {
    height: 72px;
    width: auto;
    max-width: 200px;
    object-fit: contain;
    filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.15));
}

.school-name {
    font-size: 1.4rem;
    font-weight: 800;
    color: var(--text-color);
    text-align: center;
    opacity: 0.9;
}

.rfid-waves {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: -1;
}

.wave {
    position: absolute;
    border: 4px solid var(--primary);
    opacity: 0;
    border-radius: 50%;
    width: 300px;
    height: 300px;
    top: -150px;
    left: -150px;
    animation: wave-animation 3s infinite;
}

.wave:nth-child(2) {
    animation-delay: 1s;
}

.wave:nth-child(3) {
    animation-delay: 2s;
}

@keyframes wave-animation {
    0% {
        transform: scale(0.5);
        opacity: 0.5;
    }

    100% {
        transform: scale(1.5);
        opacity: 0;
    }
}
</style>
