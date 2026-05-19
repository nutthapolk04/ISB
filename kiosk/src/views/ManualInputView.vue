<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { useKioskStore } from '../stores/kioskStore';
import Numpad from '../components/Numpad.vue';
import { ChevronLeft, AlertCircle, Keyboard as KeyboardIcon } from 'lucide-vue-next';

const router = useRouter();
const store = useKioskStore();
const inputVal = ref('');
const error = ref(false);
const inputRef = ref<HTMLInputElement | null>(null);
const showFullKeyboard = ref(false);
const currT = computed(() => t[store.language as 'EN' | 'TH']);

const t = {
  EN: {
    title: 'Manual Input',
    sub: 'Please enter your Employee ID or RFID Card Number',
    placeholder: 'Enter ID...',
    back: 'Back',
    submit: 'Check Balance',
    error: 'Invalid ID. Please try again.',
    useKeyboard: 'ABC',
    useNumpad: '123'
  },
  TH: {
    title: 'กรอกข้อมูลด้วยตนเอง',
    sub: 'กรุณากรอกรหัสพนักงานหรือเลขบัตร RFID',
    placeholder: 'กรอกรหัส...',
    back: 'ย้อนกลับ',
    submit: 'ตรวจสอบยอดเงิน',
    error: 'รหัสไม่ถูกต้อง กรุณาลองใหม่',
    useKeyboard: 'ABC',
    useNumpad: '123'
  }
};

const handleInput = (key: string) => {
  if (inputVal.value.length < 12) {
    inputVal.value += key;
    error.value = false;
    focusInput();
  }
};

const handleDelete = () => {
  inputVal.value = inputVal.value.slice(0, -1);
  focusInput();
};

const handleClear = () => {
  inputVal.value = '';
  focusInput();
};

const handleNativeInput = () => {
  error.value = false;
};

const focusInput = () => {
  nextTick(() => {
    inputRef.value?.focus();
  });
};

const toggleKeyboardMode = () => {
  showFullKeyboard.value = !showFullKeyboard.value;
  focusInput();
};

const goBack = () => {
  router.push('/');
};

const handleSubmit = async () => {
  if (inputVal.value.length === 0) return;
  
  const success = await store.login(inputVal.value);
  if (success) {
    router.push('/balance');
  } else {
    error.value = true;
    setTimeout(() => {
      inputVal.value = '';
      focusInput();
    }, 1000);
  }
};

// Simple A-Z Keyboard Layout
const alphaKeys = [
  'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P',
  'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L',
  'Z', 'X', 'C', 'V', 'B', 'N', 'M'
];

const isReady = computed(() => inputVal.value.length > 0 && !store.isLoading);

onMounted(() => {
  focusInput();
});
</script>

<template>
  <div class="kiosk-container manual-view">
    <div class="header-section">
      <button class="back-btn" @click="goBack">
        <ChevronLeft :size="32" />
        <span>{{ currT.back }}</span>
      </button>
      <h2>{{ currT.title }}</h2>
      <div style="width: 100px"></div>
    </div>

    <div class="content">
      <p class="sub-text mb-8">{{ currT.sub }}</p>
      
      <div class="input-wrapper" :class="{ 'error-border': error }">
        <input 
          ref="inputRef"
          v-model="inputVal"
          type="text"
          class="real-input"
          :placeholder="currT.placeholder"
          maxlength="12"
          @input="handleNativeInput"
          @keydown.enter="handleSubmit"
        />
        <AlertCircle v-if="error" class="icon-error" />
      </div>

      <div v-if="error" class="error-msg mb-4">
        {{ currT.error }}
      </div>
      
      <!-- Layout Toggle -->
      <div class="keyboard-toggle mb-4">
        <button class="toggle-btn" @click="toggleKeyboardMode">
          <KeyboardIcon :size="20" />
          <span>{{ showFullKeyboard ? currT.useNumpad : currT.useKeyboard }}</span>
        </button>
      </div>

      <!-- Numpad or Alpha Keyboard -->
      <div class="keyboard-area mb-8">
        <Numpad v-if="!showFullKeyboard" @input="handleInput" @delete="handleDelete" @clear="handleClear" />
        
        <div v-else class="alpha-keyboard">
          <div class="alpha-row">
            <button v-for="key in alphaKeys.slice(0, 10)" :key="key" class="alpha-key" @click="handleInput(key)">{{ key }}</button>
          </div>
          <div class="alpha-row">
            <button v-for="key in alphaKeys.slice(10, 19)" :key="key" class="alpha-key" @click="handleInput(key)">{{ key }}</button>
          </div>
          <div class="alpha-row">
            <button v-for="key in alphaKeys.slice(19)" :key="key" class="alpha-key" @click="handleInput(key)">{{ key }}</button>
            <button class="alpha-key action-key" @click="handleDelete">⌫</button>
          </div>
        </div>
      </div>

      <button 
        class="kiosk-btn btn-primary" 
        :disabled="!isReady" 
        @click="handleSubmit"
      >
        <span v-if="!store.isLoading">{{ currT.submit }}</span>
        <span v-else class="loading-dots">Searching...</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.manual-view {
  justify-content: flex-start;
  padding: 2rem;
}

.header-section {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 2rem;
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

.content {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
}

.sub-text {
  text-align: center;
  color: var(--text-muted);
  font-size: 1.25rem;
}

.input-wrapper {
  width: 100%;
  max-width: 450px;
  background-color: var(--card-bg);
  border: 4px solid transparent;
  padding: 0 1.5rem;
  border-radius: 1.5rem;
  box-shadow: inset 0 2px 4px rgba(0,0,0,0.05);
  margin-bottom: 1.5rem;
  display: flex;
  align-items: center;
  height: 5rem;
  position: relative;
}

.real-input {
  width: 100%;
  border: none;
  background: transparent;
  font-size: 2.5rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-align: center;
  outline: none;
  color: var(--text-color);
  height: 100%;
  font-family: inherit;
  text-transform: uppercase;
}

.real-input::placeholder {
  color: var(--text-muted);
  opacity: 0.5;
  font-size: 1.75rem;
  font-weight: 600;
  letter-spacing: normal;
}

.error-border {
  border-color: #ef4444;
}

.icon-error { 
  color: #ef4444; 
  position: absolute;
  right: 1.5rem;
}

.error-msg {
  color: #ef4444;
  font-weight: 600;
  font-size: 1.1rem;
}

.keyboard-toggle {
  display: flex;
  justify-content: center;
  width: 100%;
}

.toggle-btn {
  background: none;
  border: 1px solid var(--text-muted);
  color: var(--text-muted);
  padding: 0.5rem 1rem;
  border-radius: 2rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 600;
}

.keyboard-area {
  width: 100%;
  display: flex;
  justify-content: center;
  min-height: 320px;
}

.alpha-keyboard {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 100%;
  max-width: 600px;
}

.alpha-row {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
}

.alpha-key {
  width: 3rem;
  height: 3.5rem;
  background-color: var(--card-bg);
  border: none;
  border-radius: 0.5rem;
  font-weight: 700;
  font-size: 1.25rem;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  color: var(--text-color);
  cursor: pointer;
}

.alpha-key:active {
  background-color: var(--primary);
  color: white;
  transform: scale(0.95);
}

.action-key {
  width: 4rem;
  background-color: rgba(100, 116, 139, 0.1);
}

.mb-4 { margin-bottom: 1rem; }
.mb-8 { margin-bottom: 2rem; }
.mb-12 { margin-bottom: 3rem; }

.loading-dots:after {
  content: '.';
  animation: dots 1s steps(5, end) infinite;
}

@keyframes dots {
  0%, 20% { content: '.'; }
  40% { content: '..'; }
  60% { content: '...'; }
  80%, 100% { content: ''; }
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
