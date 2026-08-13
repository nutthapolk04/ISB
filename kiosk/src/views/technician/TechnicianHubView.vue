<script setup lang="ts">
import { useRouter } from 'vue-router';
import { Banknote, ScrollText, Settings } from 'lucide-vue-next';
import { useTechnicianI18n } from '../../lib/technicianI18n';

const router = useRouter();
const t = useTechnicianI18n();

const tiles = [
    { key: 'settings', route: '/technician/settings', icon: Settings, tone: 'tone-settings', labelKey: 'menuSettings', descKey: 'menuSettingsDesc' },
    { key: 'logs', route: '/technician/logs', icon: ScrollText, tone: 'tone-logs', labelKey: 'menuLogs', descKey: 'menuLogsDesc' },
    { key: 'cash-box', route: '/technician/cash-box', icon: Banknote, tone: 'tone-cashbox', labelKey: 'menuCashBox', descKey: 'menuCashBoxDesc' },
] as const;
</script>

<template>
    <div class="tech-hub">
        <h2 class="tech-hub-title">{{ t.hubTitle }}</h2>
        <div class="tech-menu-grid">
            <button
                v-for="tile in tiles"
                :key="tile.key"
                type="button"
                class="tech-menu-tile"
                @click="router.push(tile.route)"
            >
                <span class="tech-menu-icon" :class="tile.tone">
                    <component :is="tile.icon" :size="28" />
                </span>
                <span class="tech-menu-label">{{ t[tile.labelKey] }}</span>
                <span class="tech-menu-desc">{{ t[tile.descKey] }}</span>
            </button>
        </div>
    </div>
</template>

<style scoped src="../../styles/technician.css"></style>
