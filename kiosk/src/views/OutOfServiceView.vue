<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Wrench } from 'lucide-vue-next';
import KioskExitPinDialog from '../components/KioskExitPinDialog.vue';
import { clearPending } from '../hooks/useBillAcceptor';
import { unlockOutOfService } from '../lib/kioskOutOfService';
import { useKioskStore } from '../stores/kioskStore';

const router = useRouter();
const store = useKioskStore();

const UNLOCK_TAP_COUNT = 5;
const UNLOCK_TAP_MAX_GAP_MS = 600;

const showUnlockPin = ref(false);
let unlockTapCount = 0;
let unlockLastTapAt = 0;

const currT = computed(() => {
    const isTh = store.language === 'TH';
    return {
        title: isTh ? 'เครื่องหยุดให้บริการ' : 'Out of Service',
        message: isTh
            ? 'เครื่องนี้ไม่สามารถให้บริการได้ชั่วคราว กรุณาติดต่อเจ้าหน้าที่'
            : 'This kiosk is temporarily unavailable. Please contact a staff member.',
        unlockHint: isTh
            ? 'สำหรับเจ้าหน้าที่เท่านั้น'
            : 'For authorized staff only',
    };
});

function onCenterSecretTap() {
    const now = Date.now();
    if (now - unlockLastTapAt > UNLOCK_TAP_MAX_GAP_MS) {
        unlockTapCount = 0;
    }
    unlockLastTapAt = now;
    unlockTapCount += 1;
    if (unlockTapCount >= UNLOCK_TAP_COUNT) {
        unlockTapCount = 0;
        showUnlockPin.value = true;
    }
}

function openTechnician() {
    router.push('/technician');
}

function handleUnlockSuccess() {
    unlockOutOfService();
    clearPending();
    store.logout();
    void router.replace('/');
}
</script>

<template>
    <div class="oos-view">
        <button type="button" class="tech-entry-btn" aria-label="Technician" @click="openTechnician">
            <Wrench :size="20" />
        </button>

        <div class="oos-content" @click="onCenterSecretTap">
            <h1 class="oos-title">{{ currT.title }}</h1>
            <p class="oos-message">{{ currT.message }}</p>
            <p class="oos-hint">{{ currT.unlockHint }}</p>
        </div>

        <KioskExitPinDialog
            :open="showUnlockPin"
            mode="unlock-service"
            @close="showUnlockPin = false"
            @success="handleUnlockSuccess"
        />
    </div>
</template>

<style scoped>
.oos-view {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
    color: #f8fafc;
    position: relative;
}

.tech-entry-btn {
    position: absolute;
    top: 1rem;
    left: 1rem;
    background: none;
    border: transparent;
    color: transparent;
    padding: 0.75rem 1.25rem;
    border-radius: 3rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
}

.oos-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 2rem;
    gap: 1.25rem;
}

.oos-title {
    margin: 0;
    font-size: clamp(2rem, 5vw, 3rem);
    font-weight: 800;
    letter-spacing: -0.02em;
}

.oos-message {
    margin: 0;
    max-width: 32rem;
    font-size: 1.25rem;
    line-height: 1.5;
    color: #cbd5e1;
}

.oos-hint {
    margin: 2rem 0 0;
    font-size: 0.85rem;
    color: rgba(148, 163, 184, 0.35);
}
</style>
