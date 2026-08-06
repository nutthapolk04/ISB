<script setup lang="ts">
import { computed } from 'vue';
import { LogOut } from 'lucide-vue-next';
import { useKioskStore } from '../stores/kioskStore';

defineProps<{
    disabled?: boolean;
}>();

defineEmits<{
    click: [];
}>();

const store = useKioskStore();
const label = computed(() => (store.language === 'TH' ? 'ออกจากระบบ' : 'Logout'));
</script>

<template>
    <button
        type="button"
        class="kiosk-logout-btn"
        :disabled="disabled"
        @click.stop="$emit('click')"
    >
        <LogOut :size="22" aria-hidden="true" />
        <span>{{ label }}</span>
    </button>
</template>
