<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useKioskStore } from './stores/kioskStore';

const router = useRouter();
const route = useRoute();
const store = useKioskStore();
const buildInfo = `V${__APP_VERSION__} ${__BUILD_TIME__}`;

// Auto-reset logic
// topup page gets 5 min (user is paying via phone — no kiosk interaction)
const TIMEOUT_TOPUP = 300_000;
const TIMEOUT_DEFAULT = 60_000;
let timeoutId: number | null = null;

const resetTimeout = () => {
  if (timeoutId) clearTimeout(timeoutId);
  store.updateActivity();

  if (route.name === 'welcome') return;

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

onMounted(() => {
  window.addEventListener('mousedown', handleInteraction);
  window.addEventListener('touchstart', handleInteraction);
  window.addEventListener('keydown', handleInteraction);
  resetTimeout();
  store.fetchSchoolInfo();
});

onUnmounted(() => {
  window.removeEventListener('mousedown', handleInteraction);
  window.removeEventListener('touchstart', handleInteraction);
  window.removeEventListener('keydown', handleInteraction);
  if (timeoutId) clearTimeout(timeoutId);
});

// Watch route changes to reset timer
watch(() => route.path, () => {
  resetTimeout();
});
</script>

<template>
  <div class="kiosk-app-wrapper" @contextmenu.prevent>
    <router-view v-slot="{ Component }">
      <transition name="fade" mode="out-in">
        <component :is="Component" />
      </transition>
    </router-view>
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
</style>
