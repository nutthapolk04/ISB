<script setup lang="ts">
import { useRouter } from 'vue-router';
import { computed } from 'vue';
import { useKioskStore } from '../stores/kioskStore';
import { CreditCard, Languages, MousePointer2 } from 'lucide-vue-next';

const router = useRouter();
const store = useKioskStore();

const toggleLanguage = () => {
  store.setLanguage(store.language === 'EN' ? 'TH' : 'EN');
};

const currT = computed(() => t[store.language as 'EN' | 'TH']);

const goToManual = () => {
  router.push('/manual-input');
};

// Mock RFID Tap simulation for demo
const simulateTap = async () => {
  const success = await store.login('1234567890');
  if (success) {
    router.push('/balance');
  }
};

const t = {
  EN: {
    welcome: 'Welcome',
    sub: 'Please tap your card',
    manual: 'Manual Input',
    lang: 'ภาษาไทย'
  },
  TH: {
    welcome: 'ยินดีต้อนรับ',
    sub: 'กรุณาแตะบัตรของคุณ',
    manual: 'กรอกเลขบัตรเอง',
    lang: 'English'
  }
};
</script>

<template>
  <div class="kiosk-container welcome-view">
    <div class="lang-switch-container">
      <button class="lang-btn" @click="toggleLanguage">
        <Languages :size="32" />
        <span>{{ currT.lang }}</span>
      </button>
    </div>

    <div class="welcome-content" @click="simulateTap">
      <div class="rfid-animation mb-8">
        <div class="card-icon pulse-animation">
          <CreditCard :size="160" stroke-width="1.5" />
        </div>
        <div class="rfid-waves">
          <div class="wave"></div>
          <div class="wave"></div>
          <div class="wave"></div>
        </div>
      </div>

      <h1 class="mb-4">{{ currT.welcome }}</h1>
      <p class="text-muted text-center mb-12">{{ currT.sub }}</p>
      
      <div class="hint-demo">
        <MousePointer2 :size="20" />
        <span>Tap card icon for demo</span>
      </div>
    </div>

    <div class="action-footer">
      <button class="kiosk-btn btn-secondary" @click="goToManual">
        {{ currT.manual }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.welcome-view {
  justify-content: space-between;
  padding: 4rem 2rem;
}

.lang-switch-container {
  width: 100%;
  display: flex;
  justify-content: flex-end;
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

.action-footer {
  width: 100%;
  display: flex;
  justify-content: center;
}

.mb-4 { margin-bottom: 1rem; }
.mb-8 { margin-bottom: 2rem; }
.mb-12 { margin-bottom: 3rem; }
.text-muted { color: var(--text-muted); font-size: 1.75rem; }
.text-center { text-align: center; }

.hint-demo {
  margin-top: 2rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-muted);
  font-size: 1rem;
  opacity: 0.6;
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

.wave:nth-child(2) { animation-delay: 1s; }
.wave:nth-child(3) { animation-delay: 2s; }

@keyframes wave-animation {
  0% { transform: scale(0.5); opacity: 0.5; }
  100% { transform: scale(1.5); opacity: 0; }
}
</style>
