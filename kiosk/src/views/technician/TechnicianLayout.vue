<script setup lang="ts">
import { onMounted, provide, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, Lock, Unlock, Wrench, XCircle } from 'lucide-vue-next';
import { realApi } from '../../api/realApi';
import { TECHNICIAN_SESSION_KEY } from '../../lib/technicianPassword';
import { useTechnicianI18n } from '../../lib/technicianI18n';
import { useKioskStore } from '../../stores/kioskStore';

const router = useRouter();
const route = useRoute();
const store = useKioskStore();
const t = useTechnicianI18n();

const unlocked = ref(false);
const password = ref('');
const unlockError = ref('');

provide('technicianUnlocked', unlocked);

onMounted(() => {
    try {
        if (sessionStorage.getItem(TECHNICIAN_SESSION_KEY) === '1') {
            unlocked.value = true;
        }
    } catch {
        /* ignore */
    }
});

function tryUnlock() {
    unlockError.value = '';
    if (realApi.verifyTechnicianPassword(password.value)) {
        unlocked.value = true;
        password.value = '';
        try {
            sessionStorage.setItem(TECHNICIAN_SESSION_KEY, '1');
        } catch {
            /* ignore */
        }
        return;
    }
    unlockError.value = t.value.wrongPassword;
}

function goBack() {
    if (route.name === 'technician-hub') {
        try {
            sessionStorage.removeItem(TECHNICIAN_SESSION_KEY);
        } catch {
            /* ignore */
        }
        unlocked.value = false;
        router.push('/');
        return;
    }
    router.push('/technician');
}
</script>

<template>
    <div class="kiosk-container tech-page">
        <div class="tech-ambient" aria-hidden="true">
            <div class="ambient-blob ambient-blob-top" />
            <div class="ambient-blob ambient-blob-bottom" />
            <div class="ambient-grid" />
        </div>

        <div class="tech-shell">
            <header class="tech-topbar">
                <div class="tech-topbar-left">
                    <button class="back-pill" type="button" @click="goBack">
                        <ArrowLeft :size="16" />
                        {{ route.name === 'technician-hub' ? t.back : t.backToHub }}
                    </button>
                    <div class="tech-heading">
                        <div class="tech-eyebrow">
                            <Wrench :size="14" />
                            {{ t.console }}
                        </div>
                        <h1 class="tech-h1">{{ t.title }}</h1>
                    </div>
                </div>
                <div v-if="store.isReady" class="online-pill">
                    <span class="online-dot-wrap">
                        <span class="online-dot-ping" />
                        <span class="online-dot" />
                    </span>
                    {{ t.online }}
                </div>
            </header>

            <div v-if="!unlocked" class="unlock-wrap">
                <div class="unlock-card">
                    <div class="unlock-icon-wrap">
                        <Lock :size="24" class="unlock-icon" />
                    </div>
                    <h2 class="unlock-title">{{ t.restricted }}</h2>
                    <p class="unlock-sub">{{ t.locked }}</p>

                    <label class="field-label">{{ t.password }}</label>
                    <input
                        v-model="password"
                        type="password"
                        class="tech-input"
                        autocomplete="off"
                        @keyup.enter="tryUnlock"
                    />
                    <p v-if="unlockError" class="error-line">
                        <XCircle :size="14" />
                        {{ unlockError }}
                    </p>
                    <button class="btn-primary-full" type="button" @click="tryUnlock">
                        <Unlock :size="16" />
                        {{ t.unlock }}
                    </button>
                </div>
            </div>

            <router-view v-else class="tech-child-view" />
        </div>
    </div>
</template>

<style scoped src="../../styles/technician.css"></style>
