<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useKioskStore } from './stores/kioskStore';

const router = useRouter();
const route = useRoute();
const store = useKioskStore();

// Auto-reset logic
const TIMEOUT_DURATION = 45000; // 45 seconds
let timeoutId: number | null = null;

const resetTimeout = () => {
  if (timeoutId) clearTimeout(timeoutId);
  store.updateActivity();
  
  // Don't start timer on Welcome screen
  if (route.name !== 'welcome') {
    timeoutId = window.setTimeout(handleTimeout, TIMEOUT_DURATION);
  }
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
}
</style>
