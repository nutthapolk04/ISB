<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Capacitor } from '@capacitor/core';
import { Hardware } from 'capacitor-hardware';
import { Delete } from 'lucide-vue-next';
import { kioskPasscodeLength, verifyTechnicianPassword } from '../lib/technicianPassword';
import { logKioskEvent } from '../lib/kioskLog';
import { techLogAtKiosk } from '../lib/techLogMessage';
import { useKioskStore } from '../stores/kioskStore';

const props = defineProps<{
    open: boolean;
}>();

const emit = defineEmits<{
    close: [];
}>();

const store = useKioskStore();

const pin = ref('');
const shake = ref(false);
const exiting = ref(false);
const errorMessage = ref('');

const passcodeLength = computed(() => Math.max(kioskPasscodeLength(), 1));

const t = computed(() => {
    const isTh = store.language === 'TH';
    return {
        title: isTh ? 'ใส่รหัสผ่าน' : 'Enter Passcode',
        cancel: isTh ? 'ยกเลิก' : 'Cancel',
        wrong: isTh ? 'รหัสผ่านไม่ถูกต้อง' : 'Incorrect passcode',
        failed: isTh ? 'ไม่สามารถออกจากโหมดคิออสก์ได้' : 'Could not exit kiosk mode',
    };
});

const keypadRows = [
    [{ digit: '1', letters: '' }, { digit: '2', letters: 'ABC' }, { digit: '3', letters: 'DEF' }],
    [{ digit: '4', letters: 'GHI' }, { digit: '5', letters: 'JKL' }, { digit: '6', letters: 'MNO' }],
    [{ digit: '7', letters: 'PQRS' }, { digit: '8', letters: 'TUV' }, { digit: '9', letters: 'WXYZ' }],
];

watch(() => props.open, (isOpen) => {
    if (!isOpen) {
        pin.value = '';
        shake.value = false;
        exiting.value = false;
        errorMessage.value = '';
    }
});

function close() {
    if (exiting.value) return;
    emit('close');
}

function triggerShake(message: string) {
    errorMessage.value = message;
    shake.value = true;
    pin.value = '';
    window.setTimeout(() => {
        shake.value = false;
    }, 450);
}

function appendDigit(digit: string) {
    if (exiting.value || pin.value.length >= passcodeLength.value) return;
    errorMessage.value = '';
    pin.value += digit;
    if (pin.value.length === passcodeLength.value) {
        void submitPin();
    }
}

function deleteDigit() {
    if (exiting.value) return;
    errorMessage.value = '';
    pin.value = pin.value.slice(0, -1);
}

async function submitPin() {
    if (!verifyTechnicianPassword(pin.value)) {
        logKioskEvent('system', 'warn', techLogAtKiosk('Exit passcode entered incorrectly'));
        triggerShake(t.value.wrong);
        return;
    }

    exiting.value = true;
    logKioskEvent('system', 'info', techLogAtKiosk('Exit passcode accepted'));

    if (Capacitor.getPlatform() !== 'android') {
        emit('close');
        return;
    }

    try {
        await Hardware.exitKiosk();
        logKioskEvent('system', 'info', techLogAtKiosk('Exited Android kiosk lock task'));
        emit('close');
    } catch (e) {
        const message = e instanceof Error ? e.message : t.value.failed;
        exiting.value = false;
        triggerShake(message);
    }
}
</script>

<template>
    <Teleport to="body">
        <div v-if="open" class="pin-overlay" @click.self="close">
            <div class="pin-sheet" role="dialog" aria-modal="true" :aria-label="t.title">
                <h2 class="pin-title">{{ t.title }}</h2>

                <div class="pin-dots" :class="{ shake }">
                    <span
                        v-for="i in passcodeLength"
                        :key="i"
                        class="pin-dot"
                        :class="{ filled: i <= pin.length }"
                    />
                </div>

                <p v-if="errorMessage" class="pin-error">{{ errorMessage }}</p>

                <div class="pin-keypad">
                    <div v-for="(row, rowIndex) in keypadRows" :key="rowIndex" class="pin-row">
                        <button
                            v-for="key in row"
                            :key="key.digit"
                            type="button"
                            class="pin-key"
                            :disabled="exiting"
                            @click="appendDigit(key.digit)"
                        >
                            <span class="pin-key-digit">{{ key.digit }}</span>
                            <span v-if="key.letters" class="pin-key-letters">{{ key.letters }}</span>
                        </button>
                    </div>
                    <div class="pin-row">
                        <div class="pin-key pin-key-spacer" aria-hidden="true" />
                        <button
                            type="button"
                            class="pin-key"
                            :disabled="exiting"
                            @click="appendDigit('0')"
                        >
                            <span class="pin-key-digit">0</span>
                        </button>
                        <button
                            type="button"
                            class="pin-key pin-key-delete"
                            :disabled="exiting || pin.length === 0"
                            aria-label="Delete"
                            @click="deleteDigit"
                        >
                            <Delete :size="28" stroke-width="2" />
                        </button>
                    </div>
                </div>

                <button type="button" class="pin-cancel" :disabled="exiting" @click="close">
                    {{ t.cancel }}
                </button>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
.pin-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
}

.pin-sheet {
    width: min(100%, 22rem);
    padding: 2rem 1.25rem 1.5rem;
    border-radius: 1.25rem;
    background: rgba(255, 255, 255, 0.92);
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.28);
    text-align: center;
}

.pin-title {
    margin: 0 0 1.75rem;
    font-size: 1.25rem;
    font-weight: 600;
    color: #1c1c1e;
    letter-spacing: -0.02em;
}

.pin-dots {
    display: flex;
    justify-content: center;
    gap: 1rem;
    min-height: 1rem;
    margin-bottom: 1rem;
}

.pin-dot {
    width: 0.85rem;
    height: 0.85rem;
    border-radius: 50%;
    border: 2px solid #8e8e93;
    background: transparent;
    transition: background 0.12s ease, border-color 0.12s ease;
}

.pin-dot.filled {
    border-color: #1c1c1e;
    background: #1c1c1e;
}

.pin-error {
    min-height: 1.25rem;
    margin: 0 0 0.75rem;
    font-size: 0.9rem;
    color: #ff3b30;
}

.pin-keypad {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    margin-top: 0.5rem;
}

.pin-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.65rem;
}

.pin-key {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 4.25rem;
    border: none;
    border-radius: 50%;
    background: rgba(118, 118, 128, 0.12);
    color: #1c1c1e;
    cursor: pointer;
    transition: background 0.12s ease;
    -webkit-tap-highlight-color: transparent;
}

.pin-key:active:not(:disabled) {
    background: rgba(118, 118, 128, 0.28);
}

.pin-key:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}

.pin-key-spacer {
    visibility: hidden;
    pointer-events: none;
}

.pin-key-digit {
    font-size: 1.75rem;
    font-weight: 400;
    line-height: 1;
}

.pin-key-letters {
    margin-top: 0.15rem;
    font-size: 0.55rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    color: #1c1c1e;
}

.pin-key-delete {
    background: transparent;
}

.pin-cancel {
    margin-top: 1.25rem;
    border: none;
    background: none;
    color: #007aff;
    font-size: 1.05rem;
    font-weight: 500;
    cursor: pointer;
}

.pin-cancel:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.shake {
    animation: pin-shake 0.45s ease;
}

@keyframes pin-shake {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-8px); }
    40% { transform: translateX(8px); }
    60% { transform: translateX(-6px); }
    80% { transform: translateX(6px); }
}
</style>
