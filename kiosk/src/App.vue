<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useKioskStore } from './stores/kioskStore';
import { Hardware } from 'capacitor-hardware';
import { retryPendingCashTopup } from './hooks/useBillAcceptor';
import { connectPrinter } from './hooks/usePrinter';

const router = useRouter();
const route = useRoute();
const store = useKioskStore();
const buildInfo = `V${__APP_VERSION__} ${__BUILD_TIME__}`;

// Auto-reset logic
// topup page gets 5 min (user is paying via phone — no kiosk interaction)
const TIMEOUT_TOPUP = 7_000;
const TIMEOUT_DEFAULT = 5_000;
let timeoutId: number | null = null;

const resetTimeout = () => {
    if (timeoutId) clearTimeout(timeoutId);
    store.updateActivity();

    if (route.name === 'welcome' || route.name === 'technician') return;

    const duration = route.path.startsWith('/topup') ? TIMEOUT_TOPUP : TIMEOUT_DEFAULT;
    timeoutId = window.setTimeout(handleTimeout, duration);
};

const handleTimeout = () => {
    store.logout();
    router.push('/');
};

// Global event listeners for interaction
const handleInteraction = () => {
    resetTimeout();
};

onMounted(async () => {
    window.addEventListener('mousedown', handleInteraction);
    window.addEventListener('touchstart', handleInteraction);
    window.addEventListener('keydown', handleInteraction);
    resetTimeout();
    void store.bootstrap().then(() => retryPendingCashTopup());

    // NK77 bill acceptor — FM-3568D maps UART1 to /dev/ttyS2 (9600 8E1)
    Hardware.connect({
        port: '/dev/ttyS2',
        baudRate: 9600,
    })
        .then((result) => {
            console.log('[Hardware] connect:', result);
        })
        .catch((err) => {
            console.warn('[Hardware] connect failed:', err);
        });

    // 80mm receipt printer on its own UART (see usePrinter for port/baud). Non-fatal on failure.
    void connectPrinter();
});

onUnmounted(() => {
    window.removeEventListener('mousedown', handleInteraction);
    window.removeEventListener('touchstart', handleInteraction);
    window.removeEventListener('keydown', handleInteraction);
    if (timeoutId) clearTimeout(timeoutId);
});

// Watch route changes to reset timer
watch(
    () => route.path,
    () => {
        resetTimeout();
    },
);
</script>

<template>
    <div class="kiosk-app-wrapper" @contextmenu.prevent>
        <div v-if="store.bootStatus === 'loading'" class="kiosk-boot-screen">
            <div class="kiosk-spinner" />
            <p class="kiosk-overlay-msg" style="color: var(--text-color)">Connecting to server…</p>
        </div>

        <div v-else-if="store.bootStatus === 'error'" class="kiosk-boot-screen">
            <p class="kiosk-boot-error">Cannot connect to server</p>
            <p v-if="store.bootError" class="text-muted text-center">{{ store.bootError }}</p>
            <button class="kiosk-btn btn-primary" style="max-width: 280px" @click="store.bootstrap()">Retry</button>
        </div>

        <template v-else>
            <router-view v-slot="{ Component }">
                <transition name="fade" mode="out-in">
                    <component :is="Component" />
                </transition>
            </router-view>
        </template>

        <div class="build-badge">build {{ buildInfo }}</div>
    </div>
</template>

<style>
.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}

.kiosk-app-wrapper {
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    position: relative;
}

.build-badge {
    position: fixed;
    bottom: 8px;
    left: 12px;
    font-size: 0.7rem;
    color: #ef4444;
    pointer-events: none;
    user-select: none;
    z-index: 9999;
}

.text-muted {
    color: var(--text-muted);
}

.text-center {
    text-align: center;
}
</style>
