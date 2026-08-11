<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { App } from '@capacitor/app';
import { useKioskStore } from './stores/kioskStore.ts';
import { Hardware } from 'capacitor-hardware';
import { retryPendingCashTopup } from './hooks/useBillAcceptor.ts';
import { connectPrinter } from './hooks/usePrinter.ts';
import { blockRfidAfterBoot, resetKioskSession } from './lib/kioskSession.ts';
import { isOutOfService } from './lib/kioskOutOfService.ts';
import BootSplashScreen from './components/BootSplashScreen.vue';

const router = useRouter();
const route = useRoute();
const store = useKioskStore();
const buildInfo = `V${__APP_VERSION__} ${__BUILD_TIME__}`;
const showSplash = ref(true);
const contentVisible = ref(false);
const splashDone = ref(false);

function onSplashFinished() {
    contentVisible.value = true;
    showSplash.value = false;
    blockRfidAfterBoot();
}

function onSplashAfterLeave() {
    splashDone.value = true;
}

// Global idle logout for authenticated pages (balance, history, top-up amount/methods).
// QR and cash-confirm steps suppress this — TopUpView owns those timers.
const TIMEOUT_DEFAULT = 10_000;
let timeoutId: number | null = null;

const resetTimeout = () => {
    if (timeoutId) clearTimeout(timeoutId);
    store.updateActivity();

    if (route.name === 'welcome' || route.name === 'technician' || route.name === 'out-of-service') return;
    if (store.suppressGlobalIdleTimeout) return;

    timeoutId = window.setTimeout(handleTimeout, TIMEOUT_DEFAULT);
};

const handleTimeout = () => {
    if (isOutOfService()) return;
    store.logout();
    router.push('/');
};

const handleInteraction = () => {
    resetTimeout();
};

onMounted(async () => {
    resetKioskSession(store, router);
    blockRfidAfterBoot();

    window.addEventListener('mousedown', handleInteraction);
    window.addEventListener('touchstart', handleInteraction);
    window.addEventListener('keydown', handleInteraction);
    resetTimeout();
    void store.bootstrap().then(() => {
        if (isOutOfService()) {
            router.replace('/out-of-service');
            return;
        }
        retryPendingCashTopup();
    });

    void App.addListener('resume', () => {
        resetKioskSession(store, router);
        blockRfidAfterBoot();
    });

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

    void connectPrinter();
});

onUnmounted(() => {
    window.removeEventListener('mousedown', handleInteraction);
    window.removeEventListener('touchstart', handleInteraction);
    window.removeEventListener('keydown', handleInteraction);
    if (timeoutId) clearTimeout(timeoutId);
});

watch(
    () => route.path,
    () => {
        resetTimeout();
    },
);

watch(
    () => store.suppressGlobalIdleTimeout,
    () => {
        resetTimeout();
    },
);
</script>

<template>
    <div class="kiosk-app-wrapper" @contextmenu.prevent>
        <div class="kiosk-back-layer" :class="{ 'kiosk-back-layer--visible': contentVisible }">
            <div v-if="store.bootStatus === 'loading'" class="kiosk-boot-screen">
                <div class="kiosk-spinner" />
                <p class="kiosk-overlay-msg" style="color: var(--text-color)">Connecting to server…</p>
            </div>

            <div v-else-if="store.bootStatus === 'error'" class="kiosk-boot-screen">
                <p class="kiosk-boot-error">Cannot connect to server</p>
                <p v-if="store.bootError" class="text-muted text-center">{{ store.bootError }}</p>
                <button class="kiosk-btn btn-primary" style="max-width: 280px" @click="store.bootstrap()">Retry</button>
            </div>

            <router-view v-else v-slot="{ Component }">
                <transition name="fade" mode="out-in">
                    <component :is="Component" />
                </transition>
            </router-view>
        </div>

        <Transition name="splash-fade" @after-leave="onSplashAfterLeave">
            <BootSplashScreen v-if="showSplash" @finished="onSplashFinished" />
        </Transition>

        <div v-if="splashDone" class="build-badge">build {{ buildInfo }}</div>
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

.splash-fade-leave-active {
    transition: opacity 0.65s ease;
}

.splash-fade-leave-from {
    opacity: 1;
}

.splash-fade-leave-to {
    opacity: 0;
}

.kiosk-back-layer {
    position: absolute;
    inset: 0;
    opacity: 0;
    transition: opacity 0.65s ease;
    z-index: 1;
}

.kiosk-back-layer--visible {
    opacity: 1;
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
